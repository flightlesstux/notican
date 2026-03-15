import cron from 'node-cron';
import { config } from '../config';
import { getTasksToSync, markTaskSynced } from '../notion/client';
import { createIssue } from '../github/client';
import type { NotionTask } from '../types';

let isRunning = false;

/**
 * Start the Notion task watcher cron job.
 * Polls every POLL_INTERVAL_SECONDS seconds for new tasks to sync to GitHub.
 */
export function startWatcher(): void {
  const intervalSeconds = config.POLL_INTERVAL_SECONDS;
  // node-cron doesn't support arbitrary seconds intervals natively
  // so we build an expression based on the configured interval
  const cronExpression = buildCronExpression(intervalSeconds);

  console.log(
    `[Watcher] Starting Notion task watcher — polling every ${intervalSeconds}s (${cronExpression})`,
  );

  cron.schedule(cronExpression, async () => {
    if (isRunning) {
      console.log('[Watcher] Previous sync still in progress — skipping this tick');
      return;
    }

    isRunning = true;
    try {
      await syncPendingTasks();
    } catch (err) {
      const error = err as Error;
      console.error(`[Watcher] Sync failed: ${error.message}`);
    } finally {
      isRunning = false;
    }
  });

  // Run once immediately on startup
  syncPendingTasks().catch((err: Error) => {
    console.error(`[Watcher] Initial sync failed: ${err.message}`);
  });
}

/**
 * Find all Notion tasks marked for GitHub sync and create the corresponding issues.
 */
export async function syncPendingTasks(): Promise<void> {
  console.log('[Watcher] Checking for pending Notion tasks to sync...');

  let tasks: NotionTask[];
  try {
    tasks = await getTasksToSync();
  } catch (err) {
    const error = err as Error;
    throw new Error(`Failed to fetch pending tasks from Notion: ${error.message}`);
  }

  if (tasks.length === 0) {
    console.log('[Watcher] No pending tasks to sync');
    return;
  }

  console.log(`[Watcher] Found ${tasks.length} task(s) to sync`);

  const results = await Promise.allSettled(
    tasks.map((task) => syncTask(task)),
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  console.log(`[Watcher] Sync complete: ${succeeded} succeeded, ${failed} failed`);

  results.forEach((result, idx) => {
    if (result.status === 'rejected') {
      console.error(
        `[Watcher] Task "${tasks[idx].title}" failed: ${(result.reason as Error).message}`,
      );
    }
  });
}

/**
 * Sync a single Notion task to GitHub by creating an issue.
 */
async function syncTask(task: NotionTask): Promise<void> {
  console.log(`[Watcher] Syncing task: "${task.title}" (Notion ID: ${task.id})`);

  const issueBody = buildIssueBody(task);

  let issueNumber: number;
  let issueUrl: string;

  try {
    const result = await createIssue(
      config.GITHUB_OWNER,
      config.GITHUB_REPO,
      task.title,
      issueBody,
      task.labels.length > 0 ? task.labels : ['notion-task'],
    );
    issueNumber = result.number;
    issueUrl = result.url;
  } catch (err) {
    const error = err as Error;
    throw new Error(`GitHub issue creation failed: ${error.message}`);
  }

  try {
    await markTaskSynced(task.id, issueNumber, issueUrl);
  } catch (err) {
    const error = err as Error;
    // Issue was created but Notion update failed — log prominently
    console.error(
      `[Watcher] CRITICAL: GitHub issue #${issueNumber} created but failed to mark Notion task ${task.id} as synced: ${error.message}`,
    );
    throw error;
  }

  console.log(
    `[Watcher] Task "${task.title}" synced — GitHub issue #${issueNumber}: ${issueUrl}`,
  );
}

/**
 * Build the GitHub issue body from a Notion task.
 */
function buildIssueBody(task: NotionTask): string {
  const lines: string[] = [
    `> This issue was automatically created from a Notion task.`,
    `> **Notion Page ID:** \`${task.id}\``,
    '',
  ];

  if (task.body) {
    lines.push('## Description', '', task.body, '');
  }

  if (task.assignees.length > 0) {
    lines.push('## Assignees', '', task.assignees.map((a) => `- @${a}`).join('\n'), '');
  }

  lines.push(
    '---',
    `*Synced from Notion via [notican-mcp-challange](https://github.com/${config.GITHUB_OWNER}/${config.GITHUB_REPO})*`,
  );

  return lines.join('\n');
}

/**
 * Convert a polling interval in seconds to a cron expression.
 * Supports intervals of 30s, 60s, and any minute multiple up to 30 minutes.
 */
function buildCronExpression(intervalSeconds: number): string {
  if (intervalSeconds < 60) {
    // Run every N seconds using */N in seconds field (requires node-cron with seconds support)
    return `*/${intervalSeconds} * * * * *`;
  }

  const intervalMinutes = Math.floor(intervalSeconds / 60);
  if (intervalMinutes <= 1) return '* * * * *'; // every minute
  if (intervalMinutes <= 30) return `*/${intervalMinutes} * * * *`;
  return '*/30 * * * *'; // cap at 30 min
}
