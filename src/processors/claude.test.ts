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

const mockMessagesCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: mockMessagesCreate,
      },
    })),
  };
});

import {
  analyzeDiff,
  generateChangelog,
  generateADR,
  generateAPIRefUpdate,
  generateRunbook,
  summarizePR,
} from './claude';
import { prMergedToMain, sampleDiff } from '../__fixtures__';
import { NotionDocType } from '../types';
import type { ADRContext, RunbookContext, ChangedFile } from '../types';

const MOCK_TEXT = 'mock output';

function mockClaudeResponse(text: string = MOCK_TEXT) {
  mockMessagesCreate.mockResolvedValue({
    content: [{ type: 'text', text }],
  });
}

const sampleChangedFile: ChangedFile = {
  filename: 'src/routes/auth.ts',
  status: 'added',
  additions: 45,
  deletions: 0,
  patch: '+export const router = Router();',
};

const adrContext: ADRContext = {
  prTitle: 'feat: add authentication',
  prBody: 'Implements JWT auth',
  diff: sampleDiff,
  changedFiles: [sampleChangedFile],
  prNumber: 42,
  prUrl: 'https://github.com/test-owner/test-repo/pull/42',
  author: 'octocat',
};

const runbookContext: RunbookContext = {
  changedFiles: [{ filename: 'Dockerfile', status: 'modified', additions: 5, deletions: 1 }],
  commitMessages: ['chore: update Dockerfile'],
  ref: 'refs/heads/main',
  repoName: 'test-owner/test-repo',
  repoUrl: 'https://github.com/test-owner/test-repo',
};

describe('Claude processors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('analyzeDiff', () => {
    it('returns an array of ProcessedDoc with correct types', async () => {
      const jsonResponse = JSON.stringify([
        {
          type: 'CHANGELOG',
          title: 'feat: add auth',
          content: '## Changelog\n- Added JWT auth',
          metadata: { author: 'octocat' },
        },
        {
          type: 'ADR',
          title: 'ADR: Use JWT for auth',
          content: '# ADR\n## Decision\nUse JWT',
          metadata: {},
        },
      ]);
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: jsonResponse }],
      });

      const result = await analyzeDiff(sampleDiff, 'feat: add auth', 'Body text');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        type: NotionDocType.CHANGELOG,
        title: 'feat: add auth',
        content: expect.stringContaining('Changelog'),
      });
      expect(result[1]).toMatchObject({
        type: NotionDocType.ADR,
        title: expect.stringContaining('ADR'),
      });
    });

    it('calls Anthropic client with claude-sonnet-4-6 model', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: '[]' }],
      });

      await analyzeDiff(sampleDiff, 'feat: test', 'body');

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-4-6' }),
      );
    });
  });

  describe('generateChangelog', () => {
    it('returns a string containing the PR title', async () => {
      mockClaudeResponse(`## Changelog\n- ${prMergedToMain.pull_request.title}`);

      const result = await generateChangelog(prMergedToMain);

      expect(typeof result).toBe('string');
      expect(result).toContain(prMergedToMain.pull_request.title);
    });

    it('calls Anthropic client with claude-sonnet-4-6 model', async () => {
      mockClaudeResponse('## Changelog');

      await generateChangelog(prMergedToMain);

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-4-6' }),
      );
    });
  });

  describe('generateADR', () => {
    it('returns a string containing "Architecture Decision"', async () => {
      mockClaudeResponse('# Architecture Decision Record\n## Status\nAccepted');

      const result = await generateADR(adrContext);

      expect(typeof result).toBe('string');
      expect(result).toContain('Architecture Decision');
    });

    it('calls Anthropic client with claude-sonnet-4-6 model', async () => {
      mockClaudeResponse('# Architecture Decision');

      await generateADR(adrContext);

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-4-6' }),
      );
    });
  });

  describe('generateAPIRefUpdate', () => {
    it('returns a string', async () => {
      mockClaudeResponse('## API Reference\n### POST /auth/login');

      const result = await generateAPIRefUpdate([sampleChangedFile]);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('calls Anthropic client with claude-sonnet-4-6 model', async () => {
      mockClaudeResponse('## API Reference');

      await generateAPIRefUpdate([sampleChangedFile]);

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-4-6' }),
      );
    });
  });

  describe('generateRunbook', () => {
    it('returns a string', async () => {
      mockClaudeResponse('## Runbook\n### Prerequisites\n1. Docker installed');

      const result = await generateRunbook(runbookContext);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('calls Anthropic client with claude-sonnet-4-6 model', async () => {
      mockClaudeResponse('## Runbook');

      await generateRunbook(runbookContext);

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-4-6' }),
      );
    });
  });

  describe('summarizePR', () => {
    it('returns a string', async () => {
      mockClaudeResponse('This PR adds JWT authentication to the API.');

      const result = await summarizePR(prMergedToMain);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('calls Anthropic client with claude-sonnet-4-6 model', async () => {
      mockClaudeResponse('PR summary text');

      await summarizePR(prMergedToMain);

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-4-6' }),
      );
    });
  });

  describe('analyzeDiff branch coverage', () => {
    it('returns RUNBOOK type from diff', async () => {
      const jsonResponse = JSON.stringify([
        { type: 'RUNBOOK', title: 'Deploy runbook', content: '# Steps\n1. Deploy', metadata: {} },
      ]);
      mockMessagesCreate.mockResolvedValue({ content: [{ type: 'text', text: jsonResponse }] });

      const result = await analyzeDiff('diff --git Dockerfile', 'chore: update infra', '');

      expect(result[0].type).toBe('RUNBOOK');
    });

    it('returns API_REF type from diff', async () => {
      const jsonResponse = JSON.stringify([
        { type: 'API_REF', title: 'API reference', content: '# API\nGET /users', metadata: {} },
      ]);
      mockMessagesCreate.mockResolvedValue({ content: [{ type: 'text', text: jsonResponse }] });

      const result = await analyzeDiff('diff --git src/routes/users.ts', 'feat: add users route', '');

      expect(result[0].type).toBe('API_REF');
    });

    it('returns ADR type from diff', async () => {
      const jsonResponse = JSON.stringify([
        { type: 'ADR', title: 'ADR: switch to postgres', content: '# ADR\n## Decision', metadata: { key: 'val' } },
      ]);
      mockMessagesCreate.mockResolvedValue({ content: [{ type: 'text', text: jsonResponse }] });

      const result = await analyzeDiff('diff --git tsconfig.json', 'feat: migrate db', '');

      expect(result[0].type).toBe('ADR');
      expect(result[0].metadata).toEqual({ key: 'val' });
    });

    it('handles null metadata in response (defaults to empty object)', async () => {
      const jsonResponse = JSON.stringify([
        { type: 'CHANGELOG', title: 'Changelog', content: '# CL', metadata: null },
      ]);
      mockMessagesCreate.mockResolvedValue({ content: [{ type: 'text', text: jsonResponse }] });

      const result = await analyzeDiff(sampleDiff, 'feat: test', '');

      expect(result[0].metadata).toEqual({});
    });

    it('throws when Anthropic API errors', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('Anthropic API error'));

      await expect(analyzeDiff(sampleDiff, 'feat: test', 'body')).rejects.toThrow(
        'Failed to analyze diff with Claude',
      );
    });

    it('throws when Claude returns non-text content type', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'tool1', name: 'foo', input: {} }],
      });

      await expect(analyzeDiff(sampleDiff, 'feat: test', 'body')).rejects.toThrow(
        'Failed to analyze diff with Claude',
      );
    });

    it('throws when no JSON array in response', async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Here is some text with no JSON array' }],
      });

      await expect(analyzeDiff(sampleDiff, 'feat: test', 'body')).rejects.toThrow(
        'Failed to analyze diff with Claude',
      );
    });
  });

  describe('generateChangelog with null PR body', () => {
    it('handles null body gracefully', async () => {
      mockClaudeResponse('## Changelog\n- feat: something');

      const prWithNullBody = {
        ...prMergedToMain,
        pull_request: { ...prMergedToMain.pull_request, body: null },
      };

      const result = await generateChangelog(prWithNullBody);

      expect(typeof result).toBe('string');
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining('(no description provided)'),
            }),
          ]),
        }),
      );
    });
  });

  describe('generateADR with real ADRContext', () => {
    it('passes ADR context fields to Claude', async () => {
      mockClaudeResponse('# ADR-0001: Use JWT\n## Status\nAccepted');

      await generateADR(adrContext);

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining(String(adrContext.prNumber)),
            }),
          ]),
        }),
      );
    });

    it('throws when Anthropic errors', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('Rate limited'));

      await expect(generateADR(adrContext)).rejects.toThrow('Rate limited');
    });
  });

  describe('generateRunbook with real RunbookContext', () => {
    it('passes runbook context fields to Claude', async () => {
      mockClaudeResponse('## Runbook\n1. Pull image\n2. Deploy');

      await generateRunbook(runbookContext);

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining(runbookContext.repoName),
            }),
          ]),
        }),
      );
    });

    it('throws when Anthropic errors', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('Server error'));

      await expect(generateRunbook(runbookContext)).rejects.toThrow('Server error');
    });
  });

  describe('generateAPIRefUpdate error propagation', () => {
    it('throws when Anthropic errors', async () => {
      mockMessagesCreate.mockRejectedValue(new Error('Timeout'));

      await expect(generateAPIRefUpdate([sampleChangedFile])).rejects.toThrow('Timeout');
    });
  });
});
