import { Client, isFullPage } from '@notionhq/client';
import type {
  BlockObjectRequest,
  CreatePageParameters,
} from '@notionhq/client/build/src/api-endpoints';
import { config } from '../config';
import type { NotionTask } from '../types';

const notion = new Client({ auth: config.NOTION_TOKEN });

/**
 * Convert a markdown string to an array of Notion block objects.
 * Handles headings, bullet lists, numbered lists, code blocks, and paragraphs.
 */
export function markdownToNotionBlocks(markdown: string): BlockObjectRequest[] {
  const blocks: BlockObjectRequest[] = [];
  const lines = markdown.split('\n');
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = '';

  for (const line of lines) {
    // Handle fenced code blocks
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = line.slice(3).trim() || 'plain text';
        codeLines = [];
      } else {
        inCodeBlock = false;
        blocks.push({
          type: 'code',
          code: {
            language: codeLang as 'plain text',
            rich_text: [{ type: 'text', text: { content: codeLines.join('\n').slice(0, 2000) } }],
          },
        });
        codeLines = [];
        codeLang = '';
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Headings
    if (line.startsWith('### ')) {
      blocks.push({
        type: 'heading_3',
        heading_3: { rich_text: [{ type: 'text', text: { content: line.slice(4) } }] },
      });
    } else if (line.startsWith('## ')) {
      blocks.push({
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: line.slice(3) } }] },
      });
    } else if (line.startsWith('# ')) {
      blocks.push({
        type: 'heading_1',
        heading_1: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] },
      });
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push({
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: line.slice(2) } }],
        },
      });
    } else if (/^\d+\.\s/.test(line)) {
      blocks.push({
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: [{ type: 'text', text: { content: line.replace(/^\d+\.\s/, '') } }],
        },
      });
    } else if (line.trim() === '' || line.trim() === '---') {
      blocks.push({ type: 'paragraph', paragraph: { rich_text: [] } });
    } else {
      blocks.push({
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: line.slice(0, 2000) } }],
        },
      });
    }
  }

  return blocks;
}

/**
 * Create a new page in a Notion database.
 * Returns the created page ID.
 */
export async function createPage(
  databaseId: string,
  title: string,
  content: string,
  metadata: Record<string, string | number | boolean | null>,
): Promise<string> {
  try {
    const blocks = markdownToNotionBlocks(content);

    const properties: CreatePageParameters['properties'] = {
      title: {
        title: [{ type: 'text', text: { content: title } }],
      },
    };

    // Map metadata to Notion properties
    for (const [key, value] of Object.entries(metadata)) {
      if (value === null) continue;
      if (typeof value === 'string') {
        properties[key] = { rich_text: [{ type: 'text', text: { content: value } }] };
      } else if (typeof value === 'number') {
        properties[key] = { number: value };
      } else if (typeof value === 'boolean') {
        properties[key] = { checkbox: value };
      }
    }

    const page = await notion.pages.create({
      parent: { database_id: databaseId },
      properties,
      children: blocks.slice(0, 100), // Notion API limit
    });

    // If content exceeds block limit, append remaining blocks
    if (blocks.length > 100) {
      await appendBlocks(page.id, blocks.slice(100));
    }

    return page.id;
  } catch (err) {
    const error = err as Error;
    throw new Error(`Failed to create Notion page "${title}": ${error.message}`);
  }
}

/**
 * Append blocks to an existing Notion page in batches.
 */
async function appendBlocks(pageId: string, blocks: BlockObjectRequest[]): Promise<void> {
  const batchSize = 100;
  for (let i = 0; i < blocks.length; i += batchSize) {
    const batch = blocks.slice(i, i + batchSize);
    await notion.blocks.children.append({
      block_id: pageId,
      children: batch,
    });
  }
}

/**
 * Update an existing Notion page's content by archiving old blocks and writing new ones.
 */
export async function updatePage(pageId: string, content: string): Promise<void> {
  try {
    // Retrieve existing children blocks and delete them
    const existingBlocks = await notion.blocks.children.list({ block_id: pageId });
    for (const block of existingBlocks.results) {
      await notion.blocks.delete({ block_id: block.id });
    }

    // Append new content
    const blocks = markdownToNotionBlocks(content);
    await appendBlocks(pageId, blocks);
  } catch (err) {
    const error = err as Error;
    throw new Error(`Failed to update Notion page ${pageId}: ${error.message}`);
  }
}

/**
 * Find a Notion page in a database by a rich_text property matching an external ID.
 * Returns the page ID if found, null otherwise.
 */
export async function findPageByExternalId(
  databaseId: string,
  externalId: string,
  propertyName = 'github_pr_number',
): Promise<string | null> {
  try {
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: {
        property: propertyName,
        rich_text: { equals: externalId },
      },
    });

    if (response.results.length === 0) return null;
    return response.results[0].id;
  } catch (err) {
    const error = err as Error;
    throw new Error(`Failed to find page by external ID "${externalId}": ${error.message}`);
  }
}

/**
 * Idempotent create-or-update: finds an existing page by externalId or creates a new one.
 * Returns the page ID.
 */
export async function createOrUpdatePage(
  databaseId: string,
  externalId: string,
  title: string,
  content: string,
  metadata: Record<string, string | number | boolean | null>,
): Promise<string> {
  const existingId = await findPageByExternalId(databaseId, externalId);

  if (existingId) {
    await updatePage(existingId, content);
    return existingId;
  }

  return createPage(databaseId, title, content, { ...metadata, github_pr_number: externalId });
}

/**
 * Query the Tasks database for pages where github_sync checkbox is true
 * and github_issue_number is not yet set.
 */
export async function getTasksToSync(): Promise<NotionTask[]> {
  try {
    const response = await notion.databases.query({
      database_id: config.NOTION_DATABASE_TASKS,
      filter: {
        and: [
          {
            property: 'github_sync',
            checkbox: { equals: true },
          },
          {
            property: 'github_issue_number',
            number: { is_empty: true },
          },
        ],
      },
    });

    return response.results
      .filter(isFullPage)
      .map((page): NotionTask => {
        const props = page.properties;

        const titleProp = props['title'] ?? props['Name'];
        const title =
          titleProp?.type === 'title'
            ? titleProp.title.map((t) => t.plain_text).join('')
            : 'Untitled';

        const bodyProp = props['body'] ?? props['Description'];
        const body =
          bodyProp?.type === 'rich_text'
            ? bodyProp.rich_text.map((t) => t.plain_text).join('')
            : '';

        const labelsProp = props['labels'];
        const labels =
          labelsProp?.type === 'multi_select'
            ? labelsProp.multi_select.map((s) => s.name)
            : [];

        const assigneesProp = props['assignees'];
        const assignees =
          assigneesProp?.type === 'rich_text'
            ? assigneesProp.rich_text.map((t) => t.plain_text)
            : [];

        return {
          id: page.id,
          title,
          body,
          labels,
          assignees,
          githubSync: true,
        };
      });
  } catch (err) {
    const error = err as Error;
    throw new Error(`Failed to query tasks to sync: ${error.message}`);
  }
}

/**
 * Mark a Notion task as synced by setting the github_issue_number and
 * unchecking github_sync.
 */
export async function markTaskSynced(
  pageId: string,
  issueNumber: number,
  issueUrl: string,
): Promise<void> {
  try {
    await notion.pages.update({
      page_id: pageId,
      properties: {
        github_issue_number: { number: issueNumber },
        github_issue_url: {
          url: issueUrl,
        },
        github_sync: { checkbox: false },
        status: {
          select: { name: 'In Progress' },
        },
      },
    });
  } catch (err) {
    const error = err as Error;
    throw new Error(`Failed to mark task ${pageId} as synced: ${error.message}`);
  }
}

export { notion };
