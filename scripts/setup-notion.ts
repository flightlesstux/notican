/**
 * One-time setup script to create the required Notion databases.
 * Run: npm run setup:notion
 *
 * Prerequisites:
 * 1. Create a Notion integration at https://www.notion.so/my-integrations
 * 2. Copy the integration token into NOTION_TOKEN in your .env
 * 3. Create a parent page in Notion and share it with your integration
 * 4. Set NOTION_PARENT_PAGE_ID in your .env (the page ID from the URL)
 */

import 'dotenv/config';
import { Client } from '@notionhq/client';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_PARENT_PAGE_ID = process.env.NOTION_PARENT_PAGE_ID;

if (!NOTION_TOKEN) {
  console.error('ERROR: NOTION_TOKEN environment variable is required');
  process.exit(1);
}

if (!NOTION_PARENT_PAGE_ID) {
  console.error('ERROR: NOTION_PARENT_PAGE_ID environment variable is required');
  console.error('  Set this to the ID of the Notion page where databases will be created.');
  console.error('  You can find the page ID in the Notion page URL:');
  console.error('  https://notion.so/Your-Page-<PAGE_ID>');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

interface DatabaseSpec {
  name: string;
  envKey: string;
  icon: string;
  description: string;
  properties: Record<string, unknown>;
}

const databases: DatabaseSpec[] = [
  {
    name: 'ADR — Architecture Decision Records',
    envKey: 'NOTION_DATABASE_ADR',
    icon: '🏛️',
    description: 'Architectural decisions made during development',
    properties: {
      title: { title: {} },
      github_pr_number: { rich_text: {} },
      github_pr_url: { url: {} },
      author: { rich_text: {} },
      status: {
        select: {
          options: [
            { name: 'Proposed', color: 'yellow' },
            { name: 'Accepted', color: 'green' },
            { name: 'Deprecated', color: 'red' },
            { name: 'Superseded', color: 'gray' },
          ],
        },
      },
      created_at: { date: {} },
    },
  },
  {
    name: 'Changelog',
    envKey: 'NOTION_DATABASE_CHANGELOG',
    icon: '📋',
    description: 'History of changes per PR/release',
    properties: {
      title: { title: {} },
      github_pr_number: { rich_text: {} },
      github_pr_url: { url: {} },
      author: { rich_text: {} },
      status: {
        select: {
          options: [
            { name: 'open', color: 'blue' },
            { name: 'merged', color: 'green' },
          ],
        },
      },
      merged_at: { date: {} },
    },
  },
  {
    name: 'API Reference',
    envKey: 'NOTION_DATABASE_API_REF',
    icon: '📡',
    description: 'Auto-generated API documentation',
    properties: {
      title: { title: {} },
      github_pr_number: { rich_text: {} },
      github_pr_url: { url: {} },
      last_updated: { date: {} },
      changed_files: { rich_text: {} },
      github_ref: { rich_text: {} },
    },
  },
  {
    name: 'Runbooks',
    envKey: 'NOTION_DATABASE_RUNBOOKS',
    icon: '📖',
    description: 'Operational runbooks for infrastructure and deployments',
    properties: {
      title: { title: {} },
      github_ref: { rich_text: {} },
      changed_files: { rich_text: {} },
      created_at: { date: {} },
      status: {
        select: {
          options: [
            { name: 'Active', color: 'green' },
            { name: 'Outdated', color: 'red' },
            { name: 'Draft', color: 'yellow' },
          ],
        },
      },
    },
  },
  {
    name: 'Tasks',
    envKey: 'NOTION_DATABASE_TASKS',
    icon: '✅',
    description: 'Engineering tasks synced bidirectionally with GitHub Issues',
    properties: {
      title: { title: {} },
      github_issue_number: { number: {} },
      github_issue_url: { url: {} },
      github_sync: { checkbox: {} },
      github_repo: { rich_text: {} },
      status: {
        select: {
          options: [
            { name: 'Open', color: 'blue' },
            { name: 'In Progress', color: 'yellow' },
            { name: 'Done', color: 'green' },
            { name: 'Cancelled', color: 'gray' },
          ],
        },
      },
      body: { rich_text: {} },
      labels: { multi_select: { options: [] } },
      assignees: { rich_text: {} },
      author: { rich_text: {} },
      closed_at: { date: {} },
    },
  },
];

async function createDatabase(spec: DatabaseSpec): Promise<string> {
  const response = await notion.databases.create({
    parent: { page_id: NOTION_PARENT_PAGE_ID! },
    icon: { type: 'emoji', emoji: spec.icon as never },
    title: [{ type: 'text', text: { content: spec.name } }],
    properties: spec.properties as never,
  });

  return response.id;
}

async function main() {
  console.log('');
  console.log('='.repeat(60));
  console.log('  Notion Database Setup — Engineering Intelligence Hub');
  console.log('='.repeat(60));
  console.log(`  Parent page: ${NOTION_PARENT_PAGE_ID}`);
  console.log('');

  const results: Record<string, string> = {};

  for (const spec of databases) {
    process.stdout.write(`  Creating "${spec.name}"...`);
    try {
      const id = await createDatabase(spec);
      results[spec.envKey] = id;
      console.log(` ✓ ${id}`);
    } catch (err) {
      const error = err as Error;
      console.error(` ✗ FAILED: ${error.message}`);
      console.error('');
      console.error('  Common causes:');
      console.error('  - The parent page is not shared with your integration');
      console.error('  - Share the page: click "..." → "Add connections" → select your integration');
      process.exit(1);
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('  SUCCESS! Copy these values into your .env file:');
  console.log('='.repeat(60));
  console.log('');

  for (const [key, value] of Object.entries(results)) {
    console.log(`${key}=${value}`);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('  Next steps:');
  console.log('  1. Copy the values above into your .env file');
  console.log('  2. Configure your GitHub webhook:');
  console.log('     - URL: https://your-server.com/webhooks/github');
  console.log('     - Content type: application/json');
  console.log('     - Events: Pull requests, Pushes, Issues');
  console.log('     - Secret: same as GITHUB_WEBHOOK_SECRET in .env');
  console.log('  3. Start the server: npm run dev');
  console.log('='.repeat(60));
  console.log('');
}

main().catch((err) => {
  console.error('Setup failed:', (err as Error).message);
  process.exit(1);
});
