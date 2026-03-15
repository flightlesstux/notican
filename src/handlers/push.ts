import type { PushEvent, ChangedFile, RunbookContext } from '../types';
import { config } from '../config';
import { getChangedFiles } from '../github/client';
import { generateAPIRefUpdate, generateRunbook, generateADR } from '../processors/claude';
import { createOrUpdatePage } from '../notion/client';

// Patterns for different file categories
const API_PATTERNS = [
  /routes?\//i,
  /api\//i,
  /controllers?\//i,
  /endpoints?\//i,
  /openapi/i,
  /swagger/i,
  /\.ya?ml$/i,
  /graphql/i,
  /schema\.(ts|js|json)$/i,
];

const INFRA_PATTERNS = [
  /Dockerfile/i,
  /docker-compose/i,
  /k8s\//i,
  /kubernetes\//i,
  /helm\//i,
  /terraform\//i,
  /\.tf$/i,
  /\.tfvars$/i,
  /\.github\/workflows/i,
  /ansible\//i,
  /nginx/i,
];

const ARCH_PATTERNS = [
  /package\.json$/i,
  /tsconfig/i,
  /webpack/i,
  /vite\.config/i,
  /babel\.config/i,
  /jest\.config/i,
  /src\/core\//i,
  /src\/lib\//i,
  /src\/shared\//i,
  /middleware\//i,
  /plugins?\//i,
];

/**
 * Handle push events from GitHub.
 * Only process pushes to the default branch.
 */
export async function handlePushEvent(payload: PushEvent): Promise<void> {
  const { ref, repository, commits } = payload;
  const defaultBranch = `refs/heads/${repository.default_branch}`;

  if (ref !== defaultBranch) {
    console.log(`[Push Handler] Ignoring push to ${ref} (not default branch)`);
    return;
  }

  if (!payload.after || payload.after === '0000000000000000000000000000000000000000') {
    console.log('[Push Handler] Ignoring branch deletion event');
    return;
  }

  console.log(`[Push Handler] Processing push to ${ref} with ${commits.length} commit(s)`);

  const owner = config.GITHUB_OWNER;
  const repo = config.GITHUB_REPO;

  let changedFiles: ChangedFile[];
  try {
    changedFiles = await getChangedFiles(owner, repo, payload.after);
  } catch (err) {
    const error = err as Error;
    console.error(`[Push Handler] Failed to fetch changed files: ${error.message}`);
    return;
  }

  const commitMessages = commits.map((c) => c.message.split('\n')[0]);

  // Check for API file changes
  const apiFiles = changedFiles.filter((f) => API_PATTERNS.some((p) => p.test(f.filename)));
  if (apiFiles.length > 0) {
    await handleAPIChanges(apiFiles, payload.after, repository.name).catch((err: Error) => {
      console.error(`[Push Handler] API ref update failed: ${err.message}`);
    });
  }

  // Check for infrastructure file changes
  const infraFiles = changedFiles.filter((f) => INFRA_PATTERNS.some((p) => p.test(f.filename)));
  if (infraFiles.length > 0) {
    const runbookContext: RunbookContext = {
      changedFiles: infraFiles,
      commitMessages,
      ref,
      repoName: repository.full_name,
      repoUrl: repository.html_url,
    };
    await handleInfraChanges(runbookContext, payload.after).catch((err: Error) => {
      console.error(`[Push Handler] Runbook update failed: ${err.message}`);
    });
  }

  // Check for architecture-level changes
  const archFiles = changedFiles.filter((f) => ARCH_PATTERNS.some((p) => p.test(f.filename)));
  if (archFiles.length >= 3) {
    // Only trigger ADR for significant arch changes (3+ files)
    await handleArchChanges(archFiles, payload, commitMessages).catch((err: Error) => {
      console.error(`[Push Handler] ADR generation failed: ${err.message}`);
    });
  }
}

async function handleAPIChanges(
  apiFiles: ChangedFile[],
  ref: string,
  repoName: string,
): Promise<void> {
  console.log(`[Push Handler] ${apiFiles.length} API file(s) changed — updating API Reference`);

  const content = await generateAPIRefUpdate(apiFiles);
  const externalId = `api-ref-${repoName}`;

  await createOrUpdatePage(
    config.NOTION_DATABASE_API_REF,
    externalId,
    `API Reference — ${repoName}`,
    content,
    {
      github_ref: ref,
      last_updated: new Date().toISOString(),
      changed_files: apiFiles.map((f) => f.filename).join(', '),
    },
  );

  console.log('[Push Handler] API Reference updated in Notion');
}

async function handleInfraChanges(context: RunbookContext, ref: string): Promise<void> {
  console.log(
    `[Push Handler] ${context.changedFiles.length} infra file(s) changed — creating/updating Runbook`,
  );

  const content = await generateRunbook(context);
  const externalId = `runbook-${ref.slice(0, 12)}`;
  const title = `Runbook: ${context.commitMessages[0] ?? 'Infrastructure Update'}`;

  await createOrUpdatePage(
    config.NOTION_DATABASE_RUNBOOKS,
    externalId,
    title,
    content,
    {
      github_ref: ref,
      created_at: new Date().toISOString(),
      changed_files: context.changedFiles.map((f) => f.filename).join(', '),
    },
  );

  console.log('[Push Handler] Runbook created/updated in Notion');
}

async function handleArchChanges(
  archFiles: ChangedFile[],
  payload: PushEvent,
  commitMessages: string[],
): Promise<void> {
  console.log(
    `[Push Handler] ${archFiles.length} architecture file(s) changed — generating ADR`,
  );

  const adrContext = {
    prTitle: commitMessages[0] ?? 'Architecture change via direct push',
    prBody: commitMessages.join('\n'),
    diff: archFiles
      .filter((f) => f.patch)
      .map((f) => `--- ${f.filename}\n${f.patch ?? ''}`)
      .join('\n\n'),
    changedFiles: archFiles,
    prNumber: 0,
    prUrl: payload.repository.html_url,
    author: payload.pusher.name,
  };

  const content = await generateADR(adrContext);
  const externalId = `adr-push-${payload.after.slice(0, 12)}`;
  const title = `ADR: ${commitMessages[0] ?? 'Architecture Decision'}`;

  await createOrUpdatePage(
    config.NOTION_DATABASE_ADR,
    externalId,
    title,
    content,
    {
      github_ref: payload.after,
      author: payload.pusher.name,
      created_at: new Date().toISOString(),
    },
  );

  console.log('[Push Handler] ADR created in Notion');
}
