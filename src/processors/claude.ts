import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import type {
  ProcessedDoc,
  PullRequestEvent,
  ADRContext,
  RunbookContext,
  ChangedFile,
  NotionDocType,
} from '../types';
import { NotionDocType as DocType } from '../types';

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';

/**
 * Call Claude with a system prompt and user message, returning the text response.
 */
async function callClaude(systemPrompt: string, userMessage: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude');
  }
  return content.text;
}

/**
 * Analyze a PR diff and determine which documents to generate.
 * Returns an array of ProcessedDoc ready to be written to Notion.
 */
export async function analyzeDiff(
  diff: string,
  prTitle: string,
  prBody: string,
): Promise<ProcessedDoc[]> {
  const systemPrompt = `You are an expert software engineering documentation assistant embedded in a CI/CD pipeline.
Your job is to analyze pull request diffs and determine which technical documents to generate.

You can generate the following document types:
- CHANGELOG: Always generate for merged PRs. Describes user-facing changes.
- ADR (Architecture Decision Record): Generate when the diff shows significant architectural changes,
  new patterns, technology choices, or decisions that future engineers should understand.
- API_REF: Generate when API endpoints, request/response schemas, or public interfaces are modified.
- RUNBOOK: Generate when infrastructure, deployment, or operational procedures change.

Respond with a JSON array of documents to generate. Each document should have:
{
  "type": "CHANGELOG" | "ADR" | "API_REF" | "RUNBOOK",
  "title": "descriptive title",
  "content": "full markdown content",
  "metadata": { "key": "value" }
}

Guidelines:
- Be concise but thorough. Documentation should be immediately useful.
- For CHANGELOG: follow Keep a Changelog format. Group by Added/Changed/Fixed/Removed.
- For ADR: follow the MADR (Markdown Any Decision Records) format with Context, Decision, Consequences.
- For API_REF: document endpoints, parameters, request/response examples.
- For RUNBOOK: include step-by-step operational procedures, prerequisites, and rollback steps.
- Only generate documents that are clearly warranted by the diff.`;

  const userMessage = `Analyze this pull request and generate appropriate documentation.

PR Title: ${prTitle}
PR Body: ${prBody || '(no description provided)'}

Diff:
\`\`\`diff
${diff.slice(0, 15000)}
\`\`\`

Respond with a valid JSON array of document objects.`;

  try {
    const response = await callClaude(systemPrompt, userMessage);

    // Extract JSON from response (Claude may wrap it in markdown code blocks)
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found in Claude response');
    }

    const docs = JSON.parse(jsonMatch[0]) as Array<{
      type: string;
      title: string;
      content: string;
      metadata: Record<string, string | number | boolean | null>;
    }>;

    return docs.map((doc) => ({
      type: doc.type as NotionDocType,
      title: doc.title,
      content: doc.content,
      metadata: doc.metadata ?? {},
    }));
  } catch (err) {
    const error = err as Error;
    throw new Error(`Failed to analyze diff with Claude: ${error.message}`);
  }
}

/**
 * Generate a changelog entry for a merged PR.
 */
export async function generateChangelog(pr: PullRequestEvent): Promise<string> {
  const systemPrompt = `You are a technical writer generating changelog entries for a software project.
Follow the Keep a Changelog format (https://keepachangelog.com).
Be precise, developer-friendly, and focus on user-facing impact.
Output clean Markdown suitable for inclusion in a CHANGELOG.md or a Notion page.`;

  const { pull_request: pullRequest, repository } = pr;
  const userMessage = `Generate a changelog entry for this merged pull request:

Repository: ${repository.full_name}
PR #${pullRequest.number}: ${pullRequest.title}
Author: ${pullRequest.user.login}
Branch: ${pullRequest.head.ref} → ${pullRequest.base.ref}
Files changed: ${pullRequest.changed_files}
Additions: +${pullRequest.additions} | Deletions: -${pullRequest.deletions}
URL: ${pullRequest.html_url}

PR Description:
${pullRequest.body || '(no description provided)'}

Generate a concise changelog entry with appropriate sections (Added/Changed/Fixed/Removed/Deprecated/Security).
Include the PR number as a reference link.`;

  return callClaude(systemPrompt, userMessage);
}

/**
 * Generate an Architecture Decision Record from a PR context.
 */
export async function generateADR(context: ADRContext): Promise<string> {
  const systemPrompt = `You are a principal engineer writing Architecture Decision Records (ADRs) using the MADR format.
ADRs capture important architectural decisions made during development.
Format: Use clear Markdown with these sections:
# ADR-XXXX: [Title]
## Status
## Context
## Decision
## Consequences
## Alternatives Considered

Be thorough but concise. Focus on the "why" not just the "what".`;

  const userMessage = `Generate an ADR for this pull request that introduces architectural changes:

PR #${context.prNumber}: ${context.prTitle}
Author: ${context.author}
URL: ${context.prUrl}

PR Description:
${context.prBody || '(no description provided)'}

Changed files (${context.changedFiles.length} total):
${context.changedFiles.map((f) => `  ${f.status}: ${f.filename}`).join('\n')}

Relevant diff excerpt:
\`\`\`diff
${context.diff.slice(0, 8000)}
\`\`\`

Write a complete ADR that future engineers will find valuable when understanding why this decision was made.`;

  return callClaude(systemPrompt, userMessage);
}

/**
 * Generate API Reference documentation update from changed files.
 */
export async function generateAPIRefUpdate(files: ChangedFile[]): Promise<string> {
  const systemPrompt = `You are a technical writer specializing in API documentation.
Generate clear, accurate API reference documentation in Markdown format.
Include: endpoint descriptions, HTTP methods, request parameters, request/response schemas,
authentication requirements, error codes, and usage examples.
Format for Notion pages with clear headings and code blocks.`;

  const changedContent = files
    .filter((f) => f.patch)
    .map((f) => `### ${f.filename}\n\`\`\`diff\n${f.patch?.slice(0, 2000) ?? ''}\n\`\`\``)
    .join('\n\n');

  const userMessage = `Generate API reference documentation for these API-related file changes:

Changed API files:
${files.map((f) => `- ${f.status}: ${f.filename} (+${f.additions}/-${f.deletions})`).join('\n')}

File changes:
${changedContent}

Generate comprehensive API documentation covering all changed endpoints and interfaces.
Format as a Notion-friendly Markdown document with clear sections.`;

  return callClaude(systemPrompt, userMessage);
}

/**
 * Generate a Runbook for infrastructure or operational changes.
 */
export async function generateRunbook(context: RunbookContext): Promise<string> {
  const systemPrompt = `You are a senior DevOps/SRE engineer writing operational runbooks.
Runbooks provide step-by-step instructions for deploying, operating, and troubleshooting systems.
Format: Clear numbered steps, prerequisites, verification steps, rollback procedures.
Be specific, actionable, and assume the reader has intermediate DevOps knowledge.`;

  const userMessage = `Generate a runbook for these infrastructure/deployment changes:

Repository: ${context.repoName}
Branch/ref: ${context.ref}
URL: ${context.repoUrl}

Changed files:
${context.changedFiles.map((f) => `- ${f.status}: ${f.filename}`).join('\n')}

Recent commit messages:
${context.commitMessages.map((m) => `- ${m}`).join('\n')}

File changes:
${context.changedFiles
  .filter((f) => f.patch)
  .map((f) => `### ${f.filename}\n\`\`\`diff\n${f.patch?.slice(0, 1500) ?? ''}\n\`\`\``)
  .join('\n\n')}

Write a complete runbook including:
1. Overview of what changed
2. Prerequisites
3. Deployment steps
4. Verification steps
5. Rollback procedure
6. Troubleshooting tips`;

  return callClaude(systemPrompt, userMessage);
}

/**
 * Generate a brief PR summary for team review context.
 */
export async function summarizePR(pr: PullRequestEvent): Promise<string> {
  const systemPrompt = `You are a helpful engineering assistant that writes concise PR summaries for team review.
Your summary helps reviewers quickly understand: what changed, why it changed, what to focus on,
and any risks or concerns. Keep it brief (under 300 words) but informative.
Format in Markdown with clear sections.`;

  const { pull_request: pullRequest, repository } = pr;
  const userMessage = `Summarize this pull request for team review:

Repository: ${repository.full_name}
PR #${pullRequest.number}: ${pullRequest.title}
Author: ${pullRequest.user.login}
From: ${pullRequest.head.ref} → ${pullRequest.base.ref}
Stats: ${pullRequest.changed_files} files | +${pullRequest.additions} / -${pullRequest.deletions}
URL: ${pullRequest.html_url}

Description:
${pullRequest.body || '(no description provided)'}

Write a team-friendly summary covering:
- What this PR does (1-2 sentences)
- Key changes to review
- Potential risks or areas of concern
- Testing considerations`;

  return callClaude(systemPrompt, userMessage);
}

export { DocType };
