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

const mockPullsGet = jest.fn();
const mockPullsListFiles = jest.fn();
const mockReposGetCommit = jest.fn();
const mockIssuesCreate = jest.fn();
const mockIssuesUpdate = jest.fn();

jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    rest: {
      pulls: {
        get: mockPullsGet,
        listFiles: mockPullsListFiles,
      },
      repos: {
        getCommit: mockReposGetCommit,
      },
      issues: {
        create: mockIssuesCreate,
        update: mockIssuesUpdate,
      },
    },
  })),
}));

import {
  getPRDiff,
  getPRChangedFiles,
  getChangedFiles,
  createIssue,
  updateIssueState,
} from './client';

describe('GitHub client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getPRDiff', () => {
    it('calls octokit.pulls.get and returns diff string', async () => {
      const diffContent = 'diff --git a/src/auth.ts b/src/auth.ts\n+added line';
      mockPullsGet.mockResolvedValue({ data: diffContent });

      const result = await getPRDiff('test-owner', 'test-repo', 42);

      expect(mockPullsGet).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 42,
        mediaType: { format: 'diff' },
      });
      expect(result).toBe(diffContent);
    });
  });

  describe('getPRChangedFiles', () => {
    it('calls octokit.pulls.listFiles and returns mapped array', async () => {
      mockPullsListFiles.mockResolvedValue({
        data: [
          {
            filename: 'src/auth.ts',
            status: 'added',
            additions: 45,
            deletions: 0,
            patch: '+export const router = Router();',
          },
          {
            filename: 'src/index.ts',
            status: 'modified',
            additions: 3,
            deletions: 1,
            patch: '-old line\n+new line',
          },
        ],
      });

      const result = await getPRChangedFiles('test-owner', 'test-repo', 42);

      expect(mockPullsListFiles).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 42,
        per_page: 100,
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        filename: 'src/auth.ts',
        status: 'added',
        additions: 45,
        deletions: 0,
      });
    });
  });

  describe('getChangedFiles', () => {
    it('calls octokit.repos.getCommit and returns mapped array', async () => {
      mockReposGetCommit.mockResolvedValue({
        data: {
          files: [
            {
              filename: 'Dockerfile',
              status: 'modified',
              additions: 5,
              deletions: 1,
              patch: '+RUN npm ci',
            },
          ],
        },
      });

      const result = await getChangedFiles('test-owner', 'test-repo', 'after-sha');

      expect(mockReposGetCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'test-owner',
          repo: 'test-repo',
          ref: 'after-sha',
        }),
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        filename: 'Dockerfile',
        status: 'modified',
        additions: 5,
        deletions: 1,
      });
    });

    it('returns empty array when no files in getCommit response', async () => {
      mockReposGetCommit.mockResolvedValue({ data: { files: undefined } });

      const result = await getChangedFiles('test-owner', 'test-repo', 'after-sha');

      expect(result).toEqual([]);
    });
  });

  describe('createIssue', () => {
    it('calls octokit.issues.create with title, body, labels and returns number and url', async () => {
      mockIssuesCreate.mockResolvedValue({
        data: {
          number: 101,
          html_url: 'https://github.com/test-owner/test-repo/issues/101',
        },
      });

      const result = await createIssue(
        'test-owner',
        'test-repo',
        'Bug: login fails',
        'Detailed description',
        ['bug', 'backend'],
      );

      expect(mockIssuesCreate).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        title: 'Bug: login fails',
        body: 'Detailed description',
        labels: ['bug', 'backend'],
      });
      expect(result).toEqual({
        number: 101,
        url: 'https://github.com/test-owner/test-repo/issues/101',
      });
    });
  });

  describe('updateIssueState', () => {
    it('calls octokit.issues.update with the issue number and state', async () => {
      mockIssuesUpdate.mockResolvedValue({ data: { number: 101, state: 'closed' } });

      await updateIssueState('test-owner', 'test-repo', 101, 'closed');

      expect(mockIssuesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'test-owner',
          repo: 'test-repo',
          issue_number: 101,
          state: 'closed',
        }),
      );
    });

    it('can set issue state to open', async () => {
      mockIssuesUpdate.mockResolvedValue({ data: { number: 101, state: 'open' } });

      await updateIssueState('test-owner', 'test-repo', 101, 'open');

      expect(mockIssuesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'open' }),
      );
    });

    it('throws when octokit.issues.update fails', async () => {
      mockIssuesUpdate.mockRejectedValue(new Error('GitHub API error'));

      await expect(updateIssueState('test-owner', 'test-repo', 101, 'closed')).rejects.toThrow(
        'Failed to update issue #101 state',
      );
    });
  });

  describe('getPRDiff error handling', () => {
    it('throws when octokit throws', async () => {
      mockPullsGet.mockRejectedValue(new Error('Not found'));

      await expect(getPRDiff('test-owner', 'test-repo', 999)).rejects.toThrow(
        'Failed to fetch PR diff for #999',
      );
    });
  });

  describe('createIssue additional coverage', () => {
    it('creates issue with empty labels array', async () => {
      mockIssuesCreate.mockResolvedValue({
        data: {
          number: 200,
          html_url: 'https://github.com/test-owner/test-repo/issues/200',
        },
      });

      const result = await createIssue('test-owner', 'test-repo', 'Empty labels', 'Body', []);

      expect(mockIssuesCreate).toHaveBeenCalledWith(
        expect.objectContaining({ labels: [] }),
      );
      expect(result.number).toBe(200);
    });

    it('throws when octokit.issues.create fails', async () => {
      mockIssuesCreate.mockRejectedValue(new Error('Rate limit exceeded'));

      await expect(
        createIssue('test-owner', 'test-repo', 'Title', 'Body', ['bug']),
      ).rejects.toThrow('Failed to create GitHub issue "Title"');
    });
  });

  describe('getPRChangedFiles error handling', () => {
    it('throws when octokit.pulls.listFiles fails', async () => {
      mockPullsListFiles.mockRejectedValue(new Error('PR not found'));

      await expect(getPRChangedFiles('test-owner', 'test-repo', 999)).rejects.toThrow(
        'Failed to get PR files for #999',
      );
    });
  });

  describe('getChangedFiles error handling', () => {
    it('throws when octokit.repos.getCommit fails', async () => {
      mockReposGetCommit.mockRejectedValue(new Error('Commit not found'));

      await expect(getChangedFiles('test-owner', 'test-repo', 'bad-sha')).rejects.toThrow(
        'Failed to get changed files for ref bad-sha',
      );
    });
  });
});
