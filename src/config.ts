import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  GITHUB_WEBHOOK_SECRET: z.string().min(1, 'GITHUB_WEBHOOK_SECRET is required'),
  GITHUB_TOKEN: z.string().min(1, 'GITHUB_TOKEN is required'),
  GITHUB_OWNER: z.string().min(1, 'GITHUB_OWNER is required'),
  GITHUB_REPO: z.string().min(1, 'GITHUB_REPO is required'),
  NOTION_TOKEN: z.string().min(1, 'NOTION_TOKEN is required'),
  NOTION_DATABASE_ADR: z.string().min(1, 'NOTION_DATABASE_ADR is required'),
  NOTION_DATABASE_CHANGELOG: z.string().min(1, 'NOTION_DATABASE_CHANGELOG is required'),
  NOTION_DATABASE_API_REF: z.string().min(1, 'NOTION_DATABASE_API_REF is required'),
  NOTION_DATABASE_RUNBOOKS: z.string().min(1, 'NOTION_DATABASE_RUNBOOKS is required'),
  NOTION_DATABASE_TASKS: z.string().min(1, 'NOTION_DATABASE_TASKS is required'),
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  PORT: z.string().default('3000').transform(Number),
  POLL_INTERVAL_SECONDS: z.string().default('60').transform(Number),
});

function validateEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:');
    result.error.issues.forEach((issue) => {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    });
    process.exit(1);
  }
  return result.data;
}

export const config = validateEnv();

export type Config = typeof config;
