import type { PullRequestEvent } from '../types';
import { NotionDocType } from '../types';
import { config } from '../config';
import { getPRDiff } from '../github/client';
import { analyzeDiff, generateChangelog, summarizePR } from '../processors/claude';
import { createOrUpdatePage, createPage } from '../notion/client';

/**
 * Handle pull_request events from GitHub.
 */
export async function handlePullRequestEvent(payload: PullRequestEvent): Promise<void> {
  const { action, pull_request: pr, repository } = payload;
  const owner = config.GITHUB_OWNER;
  const repo = config.GITHUB_REPO;

  console.log(`[PR Handler] action=${action} pr=#${pr.number} "${pr.title}"`);

  if (action === 'closed' && pr.merged && pr.base.ref === repository.default_branch) {
    await handleMergedPR(owner, repo, payload);
  } else if (action === 'opened' || action === 'ready_for_review') {
    await handleOpenedPR(owner, repo, payload);
  } else {
    console.log(`[PR Handler] Ignoring action: ${action}`);
  }
}

/**
 * When a PR is merged to the default branch:
 * 1. Fetch the full diff
 * 2. Ask Claude to analyze and determine what docs to generate
 * 3. Write docs to appropriate Notion databases
 */
async function handleMergedPR(
  owner: string,
  repo: string,
  payload: PullRequestEvent,
): Promise<void> {
  const { pull_request: pr } = payload;

  console.log(`[PR Handler] PR #${pr.number} merged — fetching diff and generating docs`);

  let diff: string;
  try {
    diff = await getPRDiff(owner, repo, pr.number);
  } catch (err) {
    const error = err as Error;
    console.error(`[PR Handler] Could not fetch diff: ${error.message}`);
    // Fall back to generating just a changelog without diff analysis
    diff = '';
  }

  // Always generate a changelog entry for merged PRs
  try {
    const changelog = await generateChangelog(payload);
    const externalId = `pr-${pr.number}`;

    await createOrUpdatePage(
      config.NOTION_DATABASE_CHANGELOG,
      externalId,
      `${pr.title} (#${pr.number})`,
      changelog,
      {
        github_pr_number: String(pr.number),
        github_pr_url: pr.html_url,
        author: pr.user.login,
        merged_at: new Date().toISOString(),
      },
    );
    console.log(`[PR Handler] Changelog created for PR #${pr.number}`);
  } catch (err) {
    const error = err as Error;
    console.error(`[PR Handler] Failed to create changelog: ${error.message}`);
  }

  // If we have a diff, do deeper AI analysis for ADRs / API Ref / Runbooks
  if (diff) {
    try {
      const docs = await analyzeDiff(diff, pr.title, pr.body ?? '');

      for (const doc of docs) {
        // Skip CHANGELOG — already handled above
        if (doc.type === NotionDocType.CHANGELOG) continue;

        const databaseId = getDatabaseForDocType(doc.type);
        if (!databaseId) {
          console.warn(`[PR Handler] No database configured for doc type: ${doc.type}`);
          continue;
        }

        const externalId = `pr-${pr.number}-${doc.type}`;
        await createOrUpdatePage(
          databaseId,
          externalId,
          doc.title,
          doc.content,
          {
            ...doc.metadata,
            github_pr_number: String(pr.number),
            github_pr_url: pr.html_url,
          },
        );
        console.log(`[PR Handler] ${doc.type} doc created: "${doc.title}"`);
      }
    } catch (err) {
      const error = err as Error;
      console.error(`[PR Handler] Failed to analyze diff for additional docs: ${error.message}`);
    }
  }
}

/**
 * When a PR is opened or marked ready for review:
 * Generate a summary page for team context.
 */
async function handleOpenedPR(
  _owner: string,
  _repo: string,
  payload: PullRequestEvent,
): Promise<void> {
  const { pull_request: pr } = payload;

  console.log(`[PR Handler] PR #${pr.number} opened — generating review summary`);

  try {
    const summary = await summarizePR(payload);

    await createPage(
      config.NOTION_DATABASE_CHANGELOG,
      `[Review] ${pr.title} (#${pr.number})`,
      summary,
      {
        github_pr_number: String(pr.number),
        github_pr_url: pr.html_url,
        author: pr.user.login,
        status: 'open',
      },
    );
    console.log(`[PR Handler] Review summary created for PR #${pr.number}`);
  } catch (err) {
    const error = err as Error;
    console.error(`[PR Handler] Failed to create review summary: ${error.message}`);
  }
}

function getDatabaseForDocType(type: NotionDocType): string | null {
  switch (type) {
    case NotionDocType.ADR:
      return config.NOTION_DATABASE_ADR;
    case NotionDocType.CHANGELOG:
      return config.NOTION_DATABASE_CHANGELOG;
    case NotionDocType.API_REF:
      return config.NOTION_DATABASE_API_REF;
    case NotionDocType.RUNBOOK:
      return config.NOTION_DATABASE_RUNBOOKS;
    default:
      return null;
  }
}
