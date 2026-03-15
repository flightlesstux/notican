import type { IssueEvent } from '../types';
import { config } from '../config';
import { createPage, findPageByExternalId, notion } from '../notion/client';

/**
 * Handle GitHub issue events.
 */
export async function handleIssueEvent(payload: IssueEvent): Promise<void> {
  const { action, issue } = payload;

  console.log(`[Issue Handler] action=${action} issue=#${issue.number} "${issue.title}"`);

  if (action === 'opened') {
    await handleIssueOpened(payload);
  } else if (action === 'closed') {
    await handleIssueClosed(payload);
  } else if (action === 'reopened') {
    await handleIssueReopened(payload);
  } else {
    console.log(`[Issue Handler] Ignoring action: ${action}`);
  }
}

/**
 * When a GitHub issue is opened: create a linked task in Notion Tasks database.
 */
async function handleIssueOpened(payload: IssueEvent): Promise<void> {
  const { issue, repository } = payload;

  const labels = issue.labels.map((l) => l.name);
  const assignees = issue.assignees.map((a) => a.login);

  const content = [
    `## GitHub Issue #${issue.number}`,
    `**URL:** ${issue.html_url}`,
    `**Author:** ${issue.user.login}`,
    `**Repository:** ${repository.full_name}`,
    `**Labels:** ${labels.length > 0 ? labels.join(', ') : 'none'}`,
    `**Assignees:** ${assignees.length > 0 ? assignees.join(', ') : 'unassigned'}`,
    '',
    '---',
    '',
    '## Description',
    '',
    issue.body ?? '*(no description provided)*',
  ].join('\n');

  try {
    const pageId = await createPage(
      config.NOTION_DATABASE_TASKS,
      issue.title,
      content,
      {
        github_issue_number: issue.number,
        github_issue_url: issue.html_url,
        github_repo: repository.full_name,
        github_sync: false, // Already synced — this came FROM GitHub
        status: 'Open',
        author: issue.user.login,
        labels: labels.join(', '),
      },
    );

    console.log(`[Issue Handler] Notion task created for issue #${issue.number}: page ${pageId}`);
  } catch (err) {
    const error = err as Error;
    throw new Error(`Failed to create Notion task for issue #${issue.number}: ${error.message}`);
  }
}

/**
 * When a GitHub issue is closed: update the linked Notion task status to Done.
 */
async function handleIssueClosed(payload: IssueEvent): Promise<void> {
  const { issue } = payload;

  try {
    const pageId = await findPageByExternalId(
      config.NOTION_DATABASE_TASKS,
      String(issue.number),
      'github_issue_number',
    );

    if (!pageId) {
      console.warn(
        `[Issue Handler] No Notion task found for issue #${issue.number} — skipping update`,
      );
      return;
    }

    await notion.pages.update({
      page_id: pageId,
      properties: {
        status: { select: { name: 'Done' } },
        closed_at: {
          date: { start: new Date().toISOString() },
        },
      },
    });

    console.log(
      `[Issue Handler] Notion task ${pageId} marked as Done for issue #${issue.number}`,
    );
  } catch (err) {
    const error = err as Error;
    throw new Error(
      `Failed to update Notion task for closed issue #${issue.number}: ${error.message}`,
    );
  }
}

/**
 * When a GitHub issue is reopened: update the linked Notion task status back to Open.
 */
async function handleIssueReopened(payload: IssueEvent): Promise<void> {
  const { issue } = payload;

  try {
    const pageId = await findPageByExternalId(
      config.NOTION_DATABASE_TASKS,
      String(issue.number),
      'github_issue_number',
    );

    if (!pageId) {
      console.warn(
        `[Issue Handler] No Notion task found for issue #${issue.number} — skipping update`,
      );
      return;
    }

    await notion.pages.update({
      page_id: pageId,
      properties: {
        status: { select: { name: 'In Progress' } },
      },
    });

    console.log(
      `[Issue Handler] Notion task ${pageId} marked as In Progress for issue #${issue.number}`,
    );
  } catch (err) {
    const error = err as Error;
    throw new Error(
      `Failed to update Notion task for reopened issue #${issue.number}: ${error.message}`,
    );
  }
}
