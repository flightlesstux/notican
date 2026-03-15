import { Octokit } from '@octokit/rest';
import { config } from '../config';
import type { ChangedFile } from '../types';

const octokit = new Octokit({
  auth: config.GITHUB_TOKEN,
});

/**
 * Fetch the full unified diff for a pull request.
 */
export async function getPRDiff(owner: string, repo: string, prNumber: number): Promise<string> {
  try {
    const response = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: { format: 'diff' },
    });
    // The diff is returned as a string when mediaType.format is 'diff'
    return response.data as unknown as string;
  } catch (err) {
    const error = err as Error;
    throw new Error(`Failed to fetch PR diff for #${prNumber}: ${error.message}`);
  }
}

/**
 * Get the list of files changed in a specific commit or ref range.
 */
export async function getChangedFiles(owner: string, repo: string, ref: string): Promise<ChangedFile[]> {
  try {
    const response = await octokit.rest.repos.getCommit({
      owner,
      repo,
      ref,
    });

    const files = response.data.files ?? [];
    return files.map((file) => ({
      filename: file.filename,
      status: file.status as ChangedFile['status'],
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch,
    }));
  } catch (err) {
    const error = err as Error;
    throw new Error(`Failed to get changed files for ref ${ref}: ${error.message}`);
  }
}

/**
 * Get files changed in a pull request.
 */
export async function getPRChangedFiles(owner: string, repo: string, prNumber: number): Promise<ChangedFile[]> {
  try {
    const response = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });

    return response.data.map((file) => ({
      filename: file.filename,
      status: file.status as ChangedFile['status'],
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch,
    }));
  } catch (err) {
    const error = err as Error;
    throw new Error(`Failed to get PR files for #${prNumber}: ${error.message}`);
  }
}

/**
 * Create a GitHub issue.
 */
export async function createIssue(
  owner: string,
  repo: string,
  title: string,
  body: string,
  labels: string[],
): Promise<{ number: number; url: string }> {
  try {
    const response = await octokit.rest.issues.create({
      owner,
      repo,
      title,
      body,
      labels,
    });

    return {
      number: response.data.number,
      url: response.data.html_url,
    };
  } catch (err) {
    const error = err as Error;
    throw new Error(`Failed to create GitHub issue "${title}": ${error.message}`);
  }
}

/**
 * Update a GitHub issue (e.g., close it or add a comment).
 */
export async function updateIssueState(
  owner: string,
  repo: string,
  issueNumber: number,
  state: 'open' | 'closed',
): Promise<void> {
  try {
    await octokit.rest.issues.update({
      owner,
      repo,
      issue_number: issueNumber,
      state,
    });
  } catch (err) {
    const error = err as Error;
    throw new Error(`Failed to update issue #${issueNumber} state: ${error.message}`);
  }
}

export { octokit };
