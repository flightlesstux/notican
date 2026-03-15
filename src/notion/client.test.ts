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

const mockPagesCreate = jest.fn();
const mockPagesUpdate = jest.fn();
const mockDatabasesQuery = jest.fn();
const mockBlocksChildrenList = jest.fn();
const mockBlocksChildrenAppend = jest.fn();
const mockBlocksDelete = jest.fn();

jest.mock('@notionhq/client', () => {
  return {
    Client: jest.fn().mockImplementation(() => ({
      pages: {
        create: mockPagesCreate,
        update: mockPagesUpdate,
      },
      databases: {
        query: mockDatabasesQuery,
      },
      blocks: {
        children: {
          list: mockBlocksChildrenList,
          append: mockBlocksChildrenAppend,
        },
        delete: mockBlocksDelete,
      },
    })),
    isFullPage: jest.fn().mockReturnValue(true),
  };
});

import {
  createPage,
  findPageByExternalId,
  createOrUpdatePage,
  markTaskSynced,
  getTasksToSync,
  markdownToNotionBlocks,
} from './client';

describe('Notion client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('markdownToNotionBlocks', () => {
    it('converts a heading 1 to heading_1 block', () => {
      const blocks = markdownToNotionBlocks('# My Heading');
      expect(blocks).toContainEqual(
        expect.objectContaining({
          type: 'heading_1',
          heading_1: expect.objectContaining({
            rich_text: [{ type: 'text', text: { content: 'My Heading' } }],
          }),
        }),
      );
    });

    it('converts a heading 2 to heading_2 block', () => {
      const blocks = markdownToNotionBlocks('## Sub Heading');
      expect(blocks).toContainEqual(
        expect.objectContaining({
          type: 'heading_2',
          heading_2: expect.objectContaining({
            rich_text: [{ type: 'text', text: { content: 'Sub Heading' } }],
          }),
        }),
      );
    });

    it('converts a bullet item to bulleted_list_item block', () => {
      const blocks = markdownToNotionBlocks('- Bullet point');
      expect(blocks).toContainEqual(
        expect.objectContaining({
          type: 'bulleted_list_item',
          bulleted_list_item: expect.objectContaining({
            rich_text: [{ type: 'text', text: { content: 'Bullet point' } }],
          }),
        }),
      );
    });

    it('converts plain text to paragraph block', () => {
      const blocks = markdownToNotionBlocks('Just some text');
      expect(blocks).toContainEqual(
        expect.objectContaining({
          type: 'paragraph',
          paragraph: expect.objectContaining({
            rich_text: [{ type: 'text', text: { content: 'Just some text' } }],
          }),
        }),
      );
    });
  });

  describe('createPage', () => {
    it('calls notion.pages.create with correct args', async () => {
      mockPagesCreate.mockResolvedValue({ id: 'new-page-id' });
      mockBlocksChildrenAppend.mockResolvedValue({});

      const pageId = await createPage('db-changelog', 'My Title', '# Content', {
        github_pr_number: '42',
        author: 'octocat',
      });

      expect(mockPagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { database_id: 'db-changelog' },
          properties: expect.objectContaining({
            title: expect.any(Object),
          }),
        }),
      );
      expect(pageId).toBe('new-page-id');
    });
  });

  describe('findPageByExternalId', () => {
    it('returns page ID when a matching page is found', async () => {
      mockDatabasesQuery.mockResolvedValue({
        results: [{ id: 'found-page-id' }],
      });

      const result = await findPageByExternalId('db-changelog', '42');

      expect(mockDatabasesQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          database_id: 'db-changelog',
          filter: expect.objectContaining({
            rich_text: { equals: '42' },
          }),
        }),
      );
      expect(result).toBe('found-page-id');
    });

    it('returns null when no matching page is found', async () => {
      mockDatabasesQuery.mockResolvedValue({ results: [] });

      const result = await findPageByExternalId('db-changelog', 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('createOrUpdatePage', () => {
    it('calls updatePage when page already exists', async () => {
      mockDatabasesQuery.mockResolvedValue({ results: [{ id: 'existing-page-id' }] });
      mockBlocksChildrenList.mockResolvedValue({ results: [] });
      mockBlocksChildrenAppend.mockResolvedValue({});

      const result = await createOrUpdatePage('db-changelog', 'pr-42', 'Title', '# Content', {
        author: 'octocat',
      });

      expect(result).toBe('existing-page-id');
      expect(mockPagesCreate).not.toHaveBeenCalled();
    });

    it('calls createPage when page does not exist', async () => {
      mockDatabasesQuery.mockResolvedValue({ results: [] });
      mockPagesCreate.mockResolvedValue({ id: 'new-page-id' });
      mockBlocksChildrenAppend.mockResolvedValue({});

      const result = await createOrUpdatePage('db-changelog', 'pr-99', 'New Title', '# Content', {
        author: 'octocat',
      });

      expect(mockPagesCreate).toHaveBeenCalled();
      expect(result).toBe('new-page-id');
    });
  });

  describe('markTaskSynced', () => {
    it('calls pages.update with github_issue_number, url, and github_sync=false', async () => {
      mockPagesUpdate.mockResolvedValue({ id: 'task-page-id' });

      await markTaskSynced('task-page-id', 101, 'https://github.com/test/repo/issues/101');

      expect(mockPagesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          page_id: 'task-page-id',
          properties: expect.objectContaining({
            github_issue_number: { number: 101 },
            github_issue_url: { url: 'https://github.com/test/repo/issues/101' },
            github_sync: { checkbox: false },
          }),
        }),
      );
    });
  });

  describe('markdownToNotionBlocks additional coverage', () => {
    it('converts heading 3 to heading_3 block', () => {
      const blocks = markdownToNotionBlocks('### Section');
      expect(blocks).toContainEqual(
        expect.objectContaining({
          type: 'heading_3',
          heading_3: expect.objectContaining({
            rich_text: [{ type: 'text', text: { content: 'Section' } }],
          }),
        }),
      );
    });

    it('converts numbered list item', () => {
      const blocks = markdownToNotionBlocks('1. First item');
      expect(blocks).toContainEqual(
        expect.objectContaining({
          type: 'numbered_list_item',
          numbered_list_item: expect.objectContaining({
            rich_text: [{ type: 'text', text: { content: 'First item' } }],
          }),
        }),
      );
    });

    it('converts * bullet item to bulleted_list_item', () => {
      const blocks = markdownToNotionBlocks('* Star bullet');
      expect(blocks).toContainEqual(
        expect.objectContaining({
          type: 'bulleted_list_item',
        }),
      );
    });

    it('converts fenced code block', () => {
      const markdown = '```typescript\nconst x = 1;\n```';
      const blocks = markdownToNotionBlocks(markdown);
      expect(blocks).toContainEqual(
        expect.objectContaining({
          type: 'code',
          code: expect.objectContaining({
            language: 'typescript',
          }),
        }),
      );
    });

    it('converts code block with no language to plain text', () => {
      const markdown = '```\nsome code\n```';
      const blocks = markdownToNotionBlocks(markdown);
      expect(blocks).toContainEqual(
        expect.objectContaining({
          type: 'code',
          code: expect.objectContaining({
            language: 'plain text',
          }),
        }),
      );
    });

    it('converts empty string to array with one empty paragraph', () => {
      const blocks = markdownToNotionBlocks('');
      // ''.split('\n') yields [''], which is an empty line => 1 empty paragraph block
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({ type: 'paragraph', paragraph: { rich_text: [] } });
    });

    it('converts horizontal rule (---) to empty paragraph', () => {
      const blocks = markdownToNotionBlocks('---');
      expect(blocks).toContainEqual(
        expect.objectContaining({
          type: 'paragraph',
          paragraph: { rich_text: [] },
        }),
      );
    });

    it('converts blank line to empty paragraph', () => {
      const blocks = markdownToNotionBlocks('\n');
      const emptyParagraph = blocks.find(
        (b) => b.type === 'paragraph' && 'paragraph' in b && (b as { type: string; paragraph: { rich_text: unknown[] } }).paragraph.rich_text.length === 0,
      );
      expect(emptyParagraph).toBeDefined();
    });
  });

  describe('findPageByExternalId returns null for empty results', () => {
    it('returns null when database query returns empty results', async () => {
      mockDatabasesQuery.mockResolvedValue({ results: [] });

      const result = await findPageByExternalId('db-adr', 'nonexistent-id', 'github_pr_number');

      expect(result).toBeNull();
    });

    it('throws when database query fails', async () => {
      mockDatabasesQuery.mockRejectedValue(new Error('Notion API error'));

      await expect(findPageByExternalId('db-changelog', '42')).rejects.toThrow(
        'Failed to find page by external ID',
      );
    });
  });

  describe('createOrUpdatePage when findPageByExternalId returns null', () => {
    it('creates a new page when none exists', async () => {
      mockDatabasesQuery.mockResolvedValue({ results: [] });
      mockPagesCreate.mockResolvedValue({ id: 'created-page-id' });
      mockBlocksChildrenAppend.mockResolvedValue({});

      const result = await createOrUpdatePage('db-adr', 'adr-123', 'New ADR', '# ADR', {
        author: 'dev',
      });

      expect(mockPagesCreate).toHaveBeenCalled();
      expect(result).toBe('created-page-id');
    });
  });

  describe('markTaskSynced calls pages.update correctly', () => {
    it('sets github_issue_number and github_issue_url', async () => {
      mockPagesUpdate.mockResolvedValue({ id: 'task-123' });

      await markTaskSynced('task-123', 42, 'https://github.com/test/issues/42');

      expect(mockPagesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          page_id: 'task-123',
          properties: expect.objectContaining({
            github_issue_number: { number: 42 },
            github_issue_url: { url: 'https://github.com/test/issues/42' },
            github_sync: { checkbox: false },
          }),
        }),
      );
    });

    it('throws when pages.update fails', async () => {
      mockPagesUpdate.mockRejectedValue(new Error('Notion update failed'));

      await expect(markTaskSynced('task-xyz', 1, 'http://url')).rejects.toThrow(
        'Failed to mark task task-xyz as synced',
      );
    });
  });

  describe('getTasksToSync', () => {
    it('queries tasks database and returns mapped NotionTask array', async () => {
      const mockPage = {
        id: 'notion-page-id-abc',
        properties: {
          title: {
            type: 'title',
            title: [{ plain_text: 'My Task' }],
          },
          body: {
            type: 'rich_text',
            rich_text: [{ plain_text: 'Task body description' }],
          },
          labels: {
            type: 'multi_select',
            multi_select: [{ name: 'bug' }, { name: 'backend' }],
          },
          assignees: {
            type: 'multi_select',
            multi_select: [{ name: 'octocat' }],
          },
        },
      };
      mockDatabasesQuery.mockResolvedValue({ results: [mockPage] });

      const tasks = await getTasksToSync();

      expect(mockDatabasesQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          database_id: 'db-tasks',
          filter: expect.objectContaining({ and: expect.any(Array) }),
        }),
      );
      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        id: 'notion-page-id-abc',
        title: 'My Task',
        githubSync: true,
      });
    });

    it('returns empty array when no tasks need syncing', async () => {
      mockDatabasesQuery.mockResolvedValue({ results: [] });

      const tasks = await getTasksToSync();

      expect(tasks).toEqual([]);
    });

    it('throws when database query fails', async () => {
      mockDatabasesQuery.mockRejectedValue(new Error('DB error'));

      await expect(getTasksToSync()).rejects.toThrow('Failed to query tasks to sync');
    });

    it('uses "Untitled" when title property is missing', async () => {
      const mockPageNoTitle = {
        id: 'page-no-title',
        properties: {
          Name: { type: 'rich_text', rich_text: [] }, // wrong type for title
        },
      };
      mockDatabasesQuery.mockResolvedValue({ results: [mockPageNoTitle] });

      const tasks = await getTasksToSync();

      expect(tasks[0].title).toBe('Untitled');
    });
  });

  describe('createPage', () => {
    it('handles number and boolean metadata values', async () => {
      mockPagesCreate.mockResolvedValue({ id: 'page-meta' });
      mockBlocksChildrenAppend.mockResolvedValue({});

      await createPage('db-tasks', 'Task', 'content', {
        count: 5,
        active: true,
        nullable: null,
      });

      const call = mockPagesCreate.mock.calls[0][0];
      expect(call.properties.count).toEqual({ number: 5 });
      expect(call.properties.active).toEqual({ checkbox: true });
      expect(call.properties.nullable).toBeUndefined();
    });

    it('throws when pages.create fails', async () => {
      mockPagesCreate.mockRejectedValue(new Error('Create failed'));

      await expect(createPage('db-adr', 'Title', '# Content', {})).rejects.toThrow(
        'Failed to create Notion page "Title"',
      );
    });
  });
});
