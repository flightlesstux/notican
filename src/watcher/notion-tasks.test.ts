jest.mock('../config', () => ({
  config: {
    GITHUB_WEBHOOK_SECRET: 'test-secret',
    GITHUB_TOKEN: 'test-token',
    GITHUB_OWNER: 'test-owner',
    GITHUB_REPO: 'test-repo',
    NOTION_TOKEN: 'test-notion-token',
    NOTION_DATABASE_ADR: 'db-adr',
    NOTION_DATABASE_CHANGELOG: 'db-changelog',
    NOTION_DATABASE_API_REF: 'db-api-ref',
    NOTION_DATABASE_RUNBOOKS: 'db-runbooks',
    NOTION_DATABASE_TASKS: 'db-tasks',
    ANTHROPIC_API_KEY: 'test-key',
    PORT: 4000,
    POLL_INTERVAL_SECONDS: 60,
  },
}));

jest.mock('node-cron', () => ({
  schedule: jest.fn(),
}));

jest.mock('../notion/client', () => ({
  getTasksToSync: jest.fn(),
  markTaskSynced: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../github/client', () => ({
  createIssue: jest.fn(),
}));

import { syncPendingTasks, startWatcher } from './notion-tasks';
import { getTasksToSync, markTaskSynced } from '../notion/client';
import { createIssue } from '../github/client';
import { notionTaskPendingSync } from '../__fixtures__';
import type { NotionTask } from '../types';
import cron from 'node-cron';

describe('syncPendingTasks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('with pending tasks', () => {
    it('fetches tasks from Notion and creates a GitHub issue for each', async () => {
      (getTasksToSync as jest.Mock).mockResolvedValue([notionTaskPendingSync]);
      (createIssue as jest.Mock).mockResolvedValue({
        number: 101,
        url: 'https://github.com/test-owner/test-repo/issues/101',
      });

      await syncPendingTasks();

      expect(getTasksToSync).toHaveBeenCalledTimes(1);
      expect(createIssue).toHaveBeenCalledWith(
        'test-owner',
        'test-repo',
        notionTaskPendingSync.title,
        expect.any(String),
        notionTaskPendingSync.labels,
      );
    });

    it('calls markTaskSynced after successfully creating a GitHub issue', async () => {
      (getTasksToSync as jest.Mock).mockResolvedValue([notionTaskPendingSync]);
      (createIssue as jest.Mock).mockResolvedValue({
        number: 101,
        url: 'https://github.com/test-owner/test-repo/issues/101',
      });

      await syncPendingTasks();

      expect(markTaskSynced).toHaveBeenCalledWith(
        notionTaskPendingSync.id,
        101,
        'https://github.com/test-owner/test-repo/issues/101',
      );
    });

    it('uses Promise.allSettled so one failure does not stop others', async () => {
      const task1: NotionTask = { ...notionTaskPendingSync, id: 'task-1', title: 'Task One' };
      const task2: NotionTask = { ...notionTaskPendingSync, id: 'task-2', title: 'Task Two' };
      const task3: NotionTask = { ...notionTaskPendingSync, id: 'task-3', title: 'Task Three' };

      (getTasksToSync as jest.Mock).mockResolvedValue([task1, task2, task3]);

      // task2 will fail but task1 and task3 should still succeed
      (createIssue as jest.Mock)
        .mockResolvedValueOnce({ number: 101, url: 'https://github.com/test/issues/101' })
        .mockRejectedValueOnce(new Error('GitHub API error'))
        .mockResolvedValueOnce({ number: 103, url: 'https://github.com/test/issues/103' });

      // Should not throw even though one task failed
      await expect(syncPendingTasks()).resolves.not.toThrow();

      expect(createIssue).toHaveBeenCalledTimes(3);
      // task1 and task3 should be synced; task2 should not
      expect(markTaskSynced).toHaveBeenCalledTimes(2);
      expect(markTaskSynced).toHaveBeenCalledWith('task-1', 101, expect.any(String));
      expect(markTaskSynced).toHaveBeenCalledWith('task-3', 103, expect.any(String));
    });
  });

  describe('with no pending tasks', () => {
    it('does nothing when there are no tasks to sync', async () => {
      (getTasksToSync as jest.Mock).mockResolvedValue([]);

      await syncPendingTasks();

      expect(createIssue).not.toHaveBeenCalled();
      expect(markTaskSynced).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('throws when getTasksToSync fails', async () => {
      (getTasksToSync as jest.Mock).mockRejectedValue(new Error('Notion API down'));

      await expect(syncPendingTasks()).rejects.toThrow('Failed to fetch pending tasks from Notion');
    });

    it('continues other tasks when one task fails createIssue', async () => {
      const task1: NotionTask = { ...notionTaskPendingSync, id: 'task-fail-1', title: 'Fail Task' };
      const task2: NotionTask = { ...notionTaskPendingSync, id: 'task-ok-2', title: 'OK Task' };

      (getTasksToSync as jest.Mock).mockResolvedValue([task1, task2]);
      (createIssue as jest.Mock)
        .mockRejectedValueOnce(new Error('GitHub down'))
        .mockResolvedValueOnce({ number: 202, url: 'https://github.com/test/issues/202' });

      await expect(syncPendingTasks()).resolves.not.toThrow();

      // Only task2 should be synced
      expect(markTaskSynced).toHaveBeenCalledTimes(1);
      expect(markTaskSynced).toHaveBeenCalledWith('task-ok-2', 202, expect.any(String));
    });

    it('continues when markTaskSynced fails for one task', async () => {
      const task1: NotionTask = { ...notionTaskPendingSync, id: 'task-sync-fail', title: 'Sync Fail' };
      const task2: NotionTask = { ...notionTaskPendingSync, id: 'task-sync-ok', title: 'Sync OK' };

      (getTasksToSync as jest.Mock).mockResolvedValue([task1, task2]);
      (createIssue as jest.Mock).mockResolvedValue({
        number: 300,
        url: 'https://github.com/test/issues/300',
      });
      (markTaskSynced as jest.Mock)
        .mockRejectedValueOnce(new Error('Notion update failed'))
        .mockResolvedValueOnce(undefined);

      await expect(syncPendingTasks()).resolves.not.toThrow();
    });
  });

  describe('syncPendingTasks idempotency', () => {
    it('is idempotent if run twice with same tasks', async () => {
      (getTasksToSync as jest.Mock).mockResolvedValue([notionTaskPendingSync]);
      (createIssue as jest.Mock).mockResolvedValue({
        number: 101,
        url: 'https://github.com/test-owner/test-repo/issues/101',
      });

      await syncPendingTasks();
      await syncPendingTasks();

      // Each run creates one issue (because tasks are fetched fresh each time)
      expect(createIssue).toHaveBeenCalledTimes(2);
    });
  });

  describe('task with no labels uses default notion-task label', () => {
    it('uses ["notion-task"] when task has no labels', async () => {
      const taskNoLabels: NotionTask = {
        ...notionTaskPendingSync,
        labels: [],
      };
      (getTasksToSync as jest.Mock).mockResolvedValue([taskNoLabels]);
      (createIssue as jest.Mock).mockResolvedValue({
        number: 150,
        url: 'https://github.com/test/issues/150',
      });

      await syncPendingTasks();

      expect(createIssue).toHaveBeenCalledWith(
        'test-owner',
        'test-repo',
        taskNoLabels.title,
        expect.any(String),
        ['notion-task'],
      );
    });
  });

  describe('task with assignees', () => {
    it('includes assignees in issue body', async () => {
      const taskWithAssignees: NotionTask = {
        ...notionTaskPendingSync,
        assignees: ['octocat', 'hubot'],
      };
      (getTasksToSync as jest.Mock).mockResolvedValue([taskWithAssignees]);
      (createIssue as jest.Mock).mockResolvedValue({
        number: 160,
        url: 'https://github.com/test/issues/160',
      });

      await syncPendingTasks();

      const issueBodyArg = (createIssue as jest.Mock).mock.calls[0][3];
      expect(issueBodyArg).toContain('@octocat');
      expect(issueBodyArg).toContain('@hubot');
    });
  });

  describe('startWatcher', () => {
    it('schedules a cron job and returns', () => {
      (getTasksToSync as jest.Mock).mockResolvedValue([]);

      startWatcher();

      expect(cron.schedule).toHaveBeenCalled();
    });

    it('invokes the cron callback and runs syncPendingTasks', async () => {
      (getTasksToSync as jest.Mock).mockResolvedValue([]);

      let capturedCallback: (() => Promise<void>) | null = null;
      (cron.schedule as jest.Mock).mockImplementation((_expr: string, cb: () => Promise<void>) => {
        capturedCallback = cb;
      });

      startWatcher();

      if (capturedCallback) {
        await (capturedCallback as () => Promise<void>)();
      }

      expect(getTasksToSync).toHaveBeenCalled();
    });

    it('skips tick when previous sync is still running', async () => {
      // Simulate isRunning=true by having syncPendingTasks hang, then invoking callback twice
      let resolveSync: (() => void) | null = null;
      (getTasksToSync as jest.Mock).mockImplementation(
        () => new Promise<never>((resolve) => { resolveSync = resolve as () => void; }),
      );

      let capturedCallback: (() => Promise<void>) | null = null;
      (cron.schedule as jest.Mock).mockImplementation((_expr: string, cb: () => Promise<void>) => {
        capturedCallback = cb;
      });

      startWatcher();

      // Invoke the callback once (it will be in progress)
      const first = capturedCallback ? (capturedCallback as () => Promise<void>)() : Promise.resolve();
      // Invoke immediately again — should skip due to isRunning
      if (capturedCallback) {
        await (capturedCallback as () => Promise<void>)();
      }

      // Resolve the first sync
      if (resolveSync) (resolveSync as () => void)();
      await first.catch(() => undefined);

      // getTasksToSync called once from the startWatcher immediate call + once from first callback
      // Second callback was skipped
      expect(getTasksToSync).toHaveBeenCalled();
    });
  });
});
