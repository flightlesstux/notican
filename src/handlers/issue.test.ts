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

jest.mock('../notion/client', () => ({
  createPage: jest.fn().mockResolvedValue('notion-page-id-issue-15'),
  findPageByExternalId: jest.fn().mockResolvedValue('notion-page-id-issue-15'),
  createOrUpdatePage: jest.fn().mockResolvedValue('notion-page-id-issue-15'),
  updatePage: jest.fn().mockResolvedValue(undefined),
  notion: {
    pages: {
      update: jest.fn().mockResolvedValue({ id: 'notion-page-id-issue-15' }),
    },
  },
}));

import { handleIssueEvent } from './issue';
import { issueOpened, issueClosed } from '../__fixtures__';
import { createPage, findPageByExternalId } from '../notion/client';
import { notion } from '../notion/client';
import type { IssueEvent } from '../types';

describe('handleIssueEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('issue opened', () => {
    it('creates a Notion task page when an issue is opened', async () => {
      await handleIssueEvent(issueOpened);

      expect(createPage).toHaveBeenCalledWith(
        'db-tasks',
        issueOpened.issue.title,
        expect.any(String),
        expect.objectContaining({
          github_issue_number: issueOpened.issue.number,
          github_issue_url: issueOpened.issue.html_url,
        }),
      );
    });

    it('includes issue body content in the Notion page', async () => {
      await handleIssueEvent(issueOpened);

      const [, , content] = (createPage as jest.Mock).mock.calls[0];
      expect(content).toContain(issueOpened.issue.body ?? '');
    });
  });

  describe('issue closed', () => {
    it('updates Notion task status to Done when issue is closed', async () => {
      (findPageByExternalId as jest.Mock).mockResolvedValue('notion-page-id-issue-15');

      await handleIssueEvent(issueClosed);

      expect(findPageByExternalId).toHaveBeenCalledWith(
        'db-tasks',
        String(issueClosed.issue.number),
        'github_issue_number',
      );
      expect(notion.pages.update).toHaveBeenCalledWith(
        expect.objectContaining({
          page_id: 'notion-page-id-issue-15',
          properties: expect.objectContaining({
            status: { select: { name: 'Done' } },
          }),
        }),
      );
    });

    it('does not throw when no Notion task is found for closed issue', async () => {
      (findPageByExternalId as jest.Mock).mockResolvedValue(null);

      await expect(handleIssueEvent(issueClosed)).resolves.not.toThrow();
      expect(notion.pages.update).not.toHaveBeenCalled();
    });
  });

  describe('issue reopened', () => {
    it('updates Notion task status when issue is reopened', async () => {
      const issueReopened: IssueEvent = {
        ...issueClosed,
        action: 'reopened',
        issue: { ...issueClosed.issue, state: 'open' },
      };
      (findPageByExternalId as jest.Mock).mockResolvedValue('notion-page-id-issue-15');

      await handleIssueEvent(issueReopened);

      expect(findPageByExternalId).toHaveBeenCalledWith(
        'db-tasks',
        String(issueReopened.issue.number),
        'github_issue_number',
      );
      expect(notion.pages.update).toHaveBeenCalledWith(
        expect.objectContaining({
          page_id: 'notion-page-id-issue-15',
        }),
      );
    });

    it('does not throw when no Notion task found for reopened issue', async () => {
      const issueReopened: IssueEvent = {
        ...issueClosed,
        action: 'reopened',
        issue: { ...issueClosed.issue, state: 'open' },
      };
      (findPageByExternalId as jest.Mock).mockResolvedValue(null);

      await expect(handleIssueEvent(issueReopened)).resolves.not.toThrow();
      expect(notion.pages.update).not.toHaveBeenCalled();
    });
  });

  describe('issue labeled action', () => {
    it('does nothing for labeled action', async () => {
      const issueLabeled: IssueEvent = {
        ...issueOpened,
        action: 'labeled',
      };

      await handleIssueEvent(issueLabeled);

      expect(createPage).not.toHaveBeenCalled();
      expect(findPageByExternalId).not.toHaveBeenCalled();
      expect(notion.pages.update).not.toHaveBeenCalled();
    });
  });

  describe('issue assigned action', () => {
    it('does nothing for assigned action', async () => {
      const issueAssigned: IssueEvent = {
        ...issueOpened,
        action: 'assigned',
      };

      await handleIssueEvent(issueAssigned);

      expect(createPage).not.toHaveBeenCalled();
      expect(notion.pages.update).not.toHaveBeenCalled();
    });
  });

  describe('createOrUpdatePage called with correct externalId', () => {
    it('createPage called with github_issue_number as property', async () => {
      await handleIssueEvent(issueOpened);

      const [dbId, title, , metadata] = (createPage as jest.Mock).mock.calls[0];
      expect(dbId).toBe('db-tasks');
      expect(title).toBe(issueOpened.issue.title);
      expect(metadata).toMatchObject({
        github_issue_number: issueOpened.issue.number,
        github_issue_url: issueOpened.issue.html_url,
      });
    });
  });

  describe('error propagation', () => {
    it('throws when createPage fails for opened issue', async () => {
      (createPage as jest.Mock).mockRejectedValue(new Error('Notion down'));

      await expect(handleIssueEvent(issueOpened)).rejects.toThrow(
        'Failed to create Notion task for issue',
      );
    });

    it('throws when notion.pages.update fails for closed issue', async () => {
      (findPageByExternalId as jest.Mock).mockResolvedValue('notion-page-id-issue-15');
      (notion.pages.update as jest.Mock).mockRejectedValue(new Error('Notion update failed'));

      await expect(handleIssueEvent(issueClosed)).rejects.toThrow(
        'Failed to update Notion task for closed issue',
      );
    });

    it('throws when notion.pages.update fails for reopened issue', async () => {
      const issueReopened: IssueEvent = {
        ...issueClosed,
        action: 'reopened',
        issue: { ...issueClosed.issue, state: 'open' },
      };
      (findPageByExternalId as jest.Mock).mockResolvedValue('notion-page-id-issue-15');
      (notion.pages.update as jest.Mock).mockRejectedValue(new Error('Notion update failed'));

      await expect(handleIssueEvent(issueReopened)).rejects.toThrow(
        'Failed to update Notion task for reopened issue',
      );
    });
  });
});
