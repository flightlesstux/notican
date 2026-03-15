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

jest.mock('../processors/claude', () => ({
  analyzeDiff: jest.fn().mockResolvedValue([]),
  generateChangelog: jest.fn().mockResolvedValue('## Changelog\n- feat: add auth'),
  summarizePR: jest.fn().mockResolvedValue('PR Summary content'),
  generateADR: jest.fn().mockResolvedValue('ADR content'),
  generateAPIRefUpdate: jest.fn().mockResolvedValue('API Ref content'),
  generateRunbook: jest.fn().mockResolvedValue('Runbook content'),
}));

jest.mock('../notion/client', () => ({
  createPage: jest.fn().mockResolvedValue('notion-page-id-123'),
  createOrUpdatePage: jest.fn().mockResolvedValue('notion-page-id-123'),
  findPageByExternalId: jest.fn().mockResolvedValue(null),
  updatePage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../github/client', () => ({
  getPRDiff: jest.fn().mockResolvedValue('diff --git a/src/auth.ts b/src/auth.ts\n+added line'),
  getPRChangedFiles: jest.fn().mockResolvedValue([]),
}));

import { handlePullRequestEvent } from './pr';
import { prMergedToMain, prOpened } from '../__fixtures__';
import { analyzeDiff, generateChangelog, summarizePR } from '../processors/claude';
import { createOrUpdatePage, createPage } from '../notion/client';
import { getPRDiff } from '../github/client';
import type { PullRequestEvent } from '../types';

describe('handlePullRequestEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PR merged to main', () => {
    it('calls getPRDiff and analyzeDiff with the diff content', async () => {
      const mockDiff = 'diff --git a/src/auth.ts b/src/auth.ts\n+added line';
      (getPRDiff as jest.Mock).mockResolvedValue(mockDiff);
      (generateChangelog as jest.Mock).mockResolvedValue('## Changelog');
      (analyzeDiff as jest.Mock).mockResolvedValue([]);

      await handlePullRequestEvent(prMergedToMain);

      expect(getPRDiff).toHaveBeenCalledWith('test-owner', 'test-repo', 42);
      expect(analyzeDiff).toHaveBeenCalledWith(
        mockDiff,
        prMergedToMain.pull_request.title,
        prMergedToMain.pull_request.body ?? '',
      );
    });

    it('creates a changelog entry in Notion for merged PR', async () => {
      (generateChangelog as jest.Mock).mockResolvedValue('## Changelog\n- feat: add auth');

      await handlePullRequestEvent(prMergedToMain);

      expect(generateChangelog).toHaveBeenCalledWith(prMergedToMain);
      expect(createOrUpdatePage).toHaveBeenCalledWith(
        'db-changelog',
        'pr-42',
        expect.stringContaining('#42'),
        '## Changelog\n- feat: add auth',
        expect.any(Object),
      );
    });
  });

  describe('PR merged to non-main branch', () => {
    it('does nothing when PR is merged but base branch is not default', async () => {
      const prToFeature: PullRequestEvent = {
        ...prMergedToMain,
        pull_request: {
          ...prMergedToMain.pull_request,
          merged: true,
          base: { ref: 'develop', sha: 'base-sha' },
        },
      };

      await handlePullRequestEvent(prToFeature);

      // The handler checks if base.ref === default_branch (main)
      // Since the repository.default_branch is 'main' but base is 'develop', it should skip
      expect(analyzeDiff).not.toHaveBeenCalled();
    });
  });

  describe('PR opened', () => {
    it('calls summarizePR and creates a page in Notion', async () => {
      (summarizePR as jest.Mock).mockResolvedValue('This PR adds authentication.');

      await handlePullRequestEvent(prOpened);

      expect(summarizePR).toHaveBeenCalledWith(prOpened);
      expect(createPage).toHaveBeenCalledWith(
        'db-changelog',
        expect.stringContaining('#42'),
        'This PR adds authentication.',
        expect.any(Object),
      );
    });
  });

  describe('PR closed but not merged', () => {
    it('does nothing when action is closed but merged is false', async () => {
      const prClosedNotMerged: PullRequestEvent = {
        ...prMergedToMain,
        action: 'closed',
        pull_request: {
          ...prMergedToMain.pull_request,
          merged: false,
          merge_commit_sha: null,
        },
      };

      await handlePullRequestEvent(prClosedNotMerged);

      expect(analyzeDiff).not.toHaveBeenCalled();
      expect(generateChangelog).not.toHaveBeenCalled();
      expect(summarizePR).not.toHaveBeenCalled();
    });
  });

  describe('PR action synchronize', () => {
    it('does nothing for synchronize action', async () => {
      const prSynchronize: PullRequestEvent = {
        ...prMergedToMain,
        action: 'synchronize',
      };

      await handlePullRequestEvent(prSynchronize);

      expect(analyzeDiff).not.toHaveBeenCalled();
      expect(generateChangelog).not.toHaveBeenCalled();
      expect(summarizePR).not.toHaveBeenCalled();
    });
  });

  describe('analyzeDiff returns empty array', () => {
    it('does not write extra docs when analyzeDiff returns empty', async () => {
      (analyzeDiff as jest.Mock).mockResolvedValue([]);

      await handlePullRequestEvent(prMergedToMain);

      // createOrUpdatePage called only once for changelog
      const calls = (createOrUpdatePage as jest.Mock).mock.calls;
      const nonChangelog = calls.filter((c) => c[0] !== 'db-changelog');
      expect(nonChangelog).toHaveLength(0);
    });
  });

  describe('getPRDiff throws', () => {
    it('still creates changelog when getPRDiff fails', async () => {
      (getPRDiff as jest.Mock).mockRejectedValue(new Error('network error'));

      await handlePullRequestEvent(prMergedToMain);

      // Changelog still written, no crash
      expect(generateChangelog).toHaveBeenCalled();
      expect(createOrUpdatePage).toHaveBeenCalledWith(
        'db-changelog',
        'pr-42',
        expect.any(String),
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  describe('analyzeDiff returns all NotionDocTypes', () => {
    it('writes ADR doc to db-adr', async () => {
      (getPRDiff as jest.Mock).mockResolvedValue('diff content for adr');
      (analyzeDiff as jest.Mock).mockResolvedValue([
        { type: 'ADR', title: 'ADR: test', content: '# ADR', metadata: {} },
      ]);

      await handlePullRequestEvent(prMergedToMain);

      expect(createOrUpdatePage).toHaveBeenCalledWith(
        'db-adr',
        'pr-42-ADR',
        'ADR: test',
        '# ADR',
        expect.any(Object),
      );
    });

    it('writes API_REF doc to db-api-ref', async () => {
      (getPRDiff as jest.Mock).mockResolvedValue('diff content for api_ref');
      (analyzeDiff as jest.Mock).mockResolvedValue([
        { type: 'API_REF', title: 'API Ref', content: '# API', metadata: {} },
      ]);

      await handlePullRequestEvent(prMergedToMain);

      expect(createOrUpdatePage).toHaveBeenCalledWith(
        'db-api-ref',
        'pr-42-API_REF',
        'API Ref',
        '# API',
        expect.any(Object),
      );
    });

    it('writes RUNBOOK doc to db-runbooks', async () => {
      (getPRDiff as jest.Mock).mockResolvedValue('diff content for runbook');
      (analyzeDiff as jest.Mock).mockResolvedValue([
        { type: 'RUNBOOK', title: 'Runbook', content: '# Runbook', metadata: {} },
      ]);

      await handlePullRequestEvent(prMergedToMain);

      expect(createOrUpdatePage).toHaveBeenCalledWith(
        'db-runbooks',
        'pr-42-RUNBOOK',
        'Runbook',
        '# Runbook',
        expect.any(Object),
      );
    });

    it('skips CHANGELOG doc type from analyzeDiff (already handled)', async () => {
      (getPRDiff as jest.Mock).mockResolvedValue('diff content');
      (analyzeDiff as jest.Mock).mockResolvedValue([
        { type: 'CHANGELOG', title: 'Changelog', content: '# CL', metadata: {} },
      ]);

      await handlePullRequestEvent(prMergedToMain);

      // createOrUpdatePage only called once for the main changelog (not a second time for doc type)
      const calls = (createOrUpdatePage as jest.Mock).mock.calls;
      expect(calls.filter((c) => c[1] === 'pr-42-CHANGELOG')).toHaveLength(0);
    });

    it('handles unknown doc type gracefully (no crash, no write)', async () => {
      (getPRDiff as jest.Mock).mockResolvedValue('diff content');
      (analyzeDiff as jest.Mock).mockResolvedValue([
        { type: 'UNKNOWN_TYPE', title: 'Unknown', content: '# Unknown', metadata: {} },
      ]);

      await expect(handlePullRequestEvent(prMergedToMain)).resolves.not.toThrow();
    });
  });

  describe('PR ready_for_review', () => {
    it('calls summarizePR for ready_for_review action', async () => {
      const prReadyForReview: PullRequestEvent = {
        ...prOpened,
        action: 'ready_for_review',
      };

      await handlePullRequestEvent(prReadyForReview);

      expect(summarizePR).toHaveBeenCalledWith(prReadyForReview);
    });
  });

  describe('generateChangelog throws', () => {
    it('logs error but does not throw when generateChangelog fails', async () => {
      (generateChangelog as jest.Mock).mockRejectedValue(new Error('Claude timeout'));

      await expect(handlePullRequestEvent(prMergedToMain)).resolves.not.toThrow();
    });
  });

  describe('PR merged but base.ref is not main', () => {
    it('does nothing when merged but base branch is not default_branch', async () => {
      const prToNonMain: PullRequestEvent = {
        ...prMergedToMain,
        pull_request: {
          ...prMergedToMain.pull_request,
          merged: true,
          base: { ref: 'staging', sha: 'abc123' },
        },
      };

      await handlePullRequestEvent(prToNonMain);

      expect(analyzeDiff).not.toHaveBeenCalled();
      expect(generateChangelog).not.toHaveBeenCalled();
    });
  });
});
