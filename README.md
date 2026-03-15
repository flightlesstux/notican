# Notican — Autonomous Engineering Intelligence Hub

> **Notion MCP Challenge Entry** — Bidirectional GitHub ↔ Notion sync powered by Claude AI.

Every PR, commit, and issue automatically becomes living documentation in Notion. Zero manual work.

---

## How It Works

```
GitHub Events (webhook)
        ↓
  Express Server (port 4000)
        ↓
  Event Handlers (pr / push / issues)
        ↓
  Claude Sonnet 4.6 (diff analysis + doc generation)
        ↓
  Notion MCP → 5 auto-maintained databases

Notion Watcher (polls every 60s)
        ↓
  Tasks tagged github_sync=true
        ↓
  GitHub Issues API → creates issue, marks task synced
```

## What Gets Generated

| GitHub Event | Notion Output |
|---|---|
| PR merged to `main` | Changelog entry + ADR (if architecture change) |
| Push with API file changes | API Reference update |
| Push with infra changes (Dockerfile, k8s, Terraform) | Runbook create/update |
| Issue opened | Task created in Notion Tasks database |
| Issue closed/reopened | Task status synced |
| Notion task with `github_sync=true` | GitHub Issue created |

## Notion Workspace

Five databases — created automatically by `npm run setup:notion`:

| Database | Auto-maintained from |
|---|---|
| 📐 Architecture Decisions | Significant PRs |
| 📋 Changelog | Every merge to main |
| 📡 API Reference | API/route file changes |
| 📖 Runbooks | Infrastructure changes |
| ✅ Tasks | GitHub Issues (bidirectional) |

## Setup

### 1. Prerequisites

- Node.js 22+
- A GitHub repo with webhook access
- A Notion workspace with an integration token
- An Anthropic API key

### 2. Install

```bash
git clone https://github.com/your-org/notican-mcp-challange
cd notican-mcp-challange
npm install
```

### 3. Configure

```bash
cp .env.example .env
# Fill in your tokens — see .env.example for all required vars
```

### 4. Create Notion workspace structure

```bash
# Add NOTION_TOKEN and NOTION_PARENT_PAGE_ID to .env first
npm run setup:notion
# Prints 5 database IDs — paste them back into .env
```

### 5. Configure GitHub webhook

- Go to your repo → Settings → Webhooks → Add webhook
- Payload URL: `https://your-domain/webhooks/github` (use `ngrok http 4000` for local dev)
- Content type: `application/json`
- Secret: your `GITHUB_WEBHOOK_SECRET`
- Events: Pull requests, Pushes, Issues

### 6. Start

```bash
npm run dev    # development with hot reload
npm start      # production
```

Server starts on port 4000. Webhook endpoint: `POST /webhooks/github`. Health check: `GET /health`.

## Development

```bash
npm test                          # run all tests
npm run test:watch                # watch mode
npm run test:coverage             # with coverage report
npm run build                     # TypeScript compile
npm run lint                      # ESLint
npx jest src/handlers/pr.test.ts  # single test file
```

**Coverage thresholds:** 80% minimum on statements, branches, functions, lines (currently ~94%).

See [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md) for layer boundaries, TDD approach, and Claude prompt rules.

## Architecture

```
src/
  server/       Express webhook server — HMAC verification, routing
  handlers/     Parse GitHub events, decide what to generate
  processors/   Claude AI — diff analysis, doc generation
  notion/       Notion API client — idempotent read/write
  github/       Octokit — diffs, changed files, issue creation
  watcher/      Cron polling — Notion tasks → GitHub Issues
  types/        Shared TypeScript interfaces
  __fixtures__/ Test fixtures — GitHub event payloads, Notion responses
scripts/
  setup-notion.ts  One-time Notion workspace creation
landing/
  index.html    Standalone marketing page (open in browser)
```

**Key design decisions:**
- Webhook server always returns `200` to GitHub — no retries, no duplicates
- All Notion writes use `createOrUpdatePage()` keyed by GitHub external ID — fully idempotent
- Claude receives only relevant diff portions (lock files stripped, 200-line file cap)
- Notion watcher uses `Promise.allSettled()` — one failing task never stops the batch

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 + TypeScript |
| Web server | Express.js |
| AI | Claude Sonnet 4.6 (`@anthropic-ai/sdk`) |
| GitHub | Octokit REST + `@octokit/webhooks` |
| Notion | `@notionhq/client` |
| Testing | Jest + ts-jest + supertest |
| CI/CD | GitHub Actions |

## Environment Variables

See [`.env.example`](.env.example) for the full list. Required:

```
GITHUB_WEBHOOK_SECRET   Webhook HMAC secret
GITHUB_TOKEN            Personal access token (repo scope)
GITHUB_OWNER            Org or username
GITHUB_REPO             Repository name
NOTION_TOKEN            Notion integration token
NOTION_DATABASE_*       5 database IDs (output of setup:notion)
ANTHROPIC_API_KEY       Claude API key
PORT                    Default: 4000
```

## Landing Page

Open `landing/index.html` directly in a browser — no server needed.

Dark + neon design, fully responsive (desktop + mobile). Sections: hero with live pipeline diagram, stats, how it works, features, terminal setup, architecture, Notion databases, CTA.

---

Built with [Claude Sonnet 4.6](https://anthropic.com) + [Notion MCP](https://developers.notion.com) · Notion MCP Challenge 2026
