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

jest.mock('./pr', () => ({
  handlePullRequestEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./push', () => ({
  handlePushEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./issue', () => ({
  handleIssueEvent: jest.fn().mockResolvedValue(undefined),
}));

import { routeEvent } from './index';
import { handlePullRequestEvent } from './pr';
import { handlePushEvent } from './push';
import { handleIssueEvent } from './issue';

describe('routeEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes pull_request event to handlePullRequestEvent', async () => {
    const payload = { action: 'opened', pull_request: { number: 1 } };

    await routeEvent('pull_request', payload);

    expect(handlePullRequestEvent).toHaveBeenCalledWith(payload);
    expect(handlePushEvent).not.toHaveBeenCalled();
    expect(handleIssueEvent).not.toHaveBeenCalled();
  });

  it('routes push event to handlePushEvent', async () => {
    const payload = { ref: 'refs/heads/main', commits: [] };

    await routeEvent('push', payload);

    expect(handlePushEvent).toHaveBeenCalledWith(payload);
    expect(handlePullRequestEvent).not.toHaveBeenCalled();
  });

  it('routes issues event to handleIssueEvent', async () => {
    const payload = { action: 'opened', issue: { number: 5 } };

    await routeEvent('issues', payload);

    expect(handleIssueEvent).toHaveBeenCalledWith(payload);
    expect(handlePullRequestEvent).not.toHaveBeenCalled();
  });

  it('handles ping event without calling any handler', async () => {
    await routeEvent('ping', {});

    expect(handlePullRequestEvent).not.toHaveBeenCalled();
    expect(handlePushEvent).not.toHaveBeenCalled();
    expect(handleIssueEvent).not.toHaveBeenCalled();
  });

  it('handles unknown event type without throwing', async () => {
    await expect(routeEvent('star', {})).resolves.not.toThrow();

    expect(handlePullRequestEvent).not.toHaveBeenCalled();
    expect(handlePushEvent).not.toHaveBeenCalled();
    expect(handleIssueEvent).not.toHaveBeenCalled();
  });
});
