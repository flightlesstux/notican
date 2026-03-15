# DEVELOPMENT_RULES.md

Rules and approach for building the Autonomous Engineering Intelligence Hub.

---

## Core Philosophy

This project has one job: **be a reliable bridge between GitHub activity and Notion documentation**. Every design decision must serve that. Do not add abstraction, generality, or features that aren't directly needed right now.

---

## Layer Responsibilities

Each layer has a strict boundary. Do not cross it.

| Layer | Responsibility | Must NOT |
|---|---|---|
| `src/server/` | Receive and verify GitHub webhooks | Parse or interpret event payloads |
| `src/handlers/` | Parse events, decide what processing to trigger | Call Claude or Notion directly |
| `src/processors/` | Call Claude AI, return structured `ProcessedDoc` | Know anything about Notion or GitHub APIs |
| `src/notion/` | Read/write Notion — nothing else | Know about GitHub or Claude |
| `src/github/` | Read GitHub diffs/files, create issues — nothing else | Know about Notion or Claude |
| `src/watcher/` | Poll Notion, trigger GitHub issue creation | Contain business logic |
| `src/types/` | Shared interfaces only | Contain logic or imports from other layers |

If you find yourself importing from two different domain layers in one file (e.g., `notion/client` and `github/client` both imported in `processors/claude.ts`), that is a boundary violation — move the orchestration to a handler.

---

## Development Approach

### 1. Start from the event, work inward

When implementing a new feature, always start at the entry point and work toward the implementation:

```
GitHub event → handler → processor → notion write
```

Never start by writing a Notion utility and hoping a handler will use it later.

### 2. Implement one event type end-to-end before moving to the next

Order of implementation:
1. `pull_request` (merged to main → changelog)
2. `push` (API file changes → API reference update)
3. `push` (infra file changes → runbook update)
4. `pull_request` (significant diff → ADR)
5. `issues` (opened → Notion task)
6. Notion watcher (task with `github_sync=true` → GitHub issue)

Get each working and manually tested before touching the next.

### 3. Test with real webhooks early

Use `ngrok http 4000` to expose the local server and configure a real GitHub repo's webhook to point at it. Do this from day one — do not mock webhooks until the real flow works.

---

## Claude AI Usage Rules

### Model
Always use `claude-sonnet-4-6`. Never downgrade to Haiku for cost — quality of generated documentation is the product.

### Prompt structure
Every Claude call must follow this structure:
```
System: role + output format contract (what the response must look like)
User: the actual data (diff, PR body, changed files, etc.)
```

Never mix role instructions and data in the same message.

### Output contract
Every Claude function in `processors/claude.ts` must return a plain string (Markdown). The handler is responsible for deciding what to do with it. Claude functions must not return Notion block objects or make decisions about database IDs.

### Token efficiency
- Pass only the relevant portion of a diff, not the entire raw diff
- Strip binary files, lock files (`package-lock.json`, `yarn.lock`, `*.lock`), and generated files from diffs before sending to Claude
- Truncate individual file diffs at 200 lines — Claude does not need line 201 of a migration file

### Prompt quality bar
Each Claude prompt must produce output that is immediately publishable as documentation — not a draft. If the output needs human editing to be useful, the prompt is not good enough. Iterate on prompts before moving on.

---

## Notion Writing Rules

### Idempotency is non-negotiable
Every write to Notion must use `createOrUpdatePage()` with an `externalId` (e.g., `github_pr_number`, `github_commit_sha`, `github_issue_number`). Never use `createPage()` directly for event-driven writes — duplicate pages are a hard failure mode.

### Markdown → Notion blocks
Use the `markdownToNotionBlocks()` utility in `src/notion/client.ts` for all content. Never manually construct Notion block objects in handlers or processors.

### Database properties
Each database has a fixed schema defined at setup time (`scripts/setup-notion.ts`). Do not add properties dynamically at runtime. If a new property is needed, add it to the setup script and document it here.

| Database | Key properties |
|---|---|
| ADR | `title`, `status` (Proposed/Accepted), `github_pr_number`, `github_pr_url`, `date` |
| Changelog | `title`, `version`, `github_pr_number`, `merged_at`, `author` |
| API Reference | `title`, `github_commit_sha`, `last_updated` |
| Runbooks | `title`, `category`, `github_commit_sha`, `last_updated` |
| Tasks | `title`, `github_sync` (checkbox), `github_issue_number`, `github_issue_url`, `status` |

### Rate limits
Notion API rate limit is 3 requests/second. Wrap all Notion calls with a simple delay between consecutive writes when processing batches. Do not implement a full queue — a `sleep(350)` between batch items is sufficient.

---

## Error Handling Rules

### Webhook server — never crash, never retry blindly
The webhook handler must always return `200 OK` to GitHub, even on processing errors. GitHub will retry on non-2xx responses, causing duplicate processing. Log the error and return 200.

```typescript
// Correct
res.status(200).json({ received: true });
// then process async — if it fails, log it

// Wrong
res.status(500).json({ error: 'processing failed' });
```

### External API failures — log and continue
If Claude fails, log the error and skip the Notion write. Do not throw. The webhook is already acknowledged. Missing one changelog entry is acceptable; crashing the server is not.

### Notion watcher — skip failing tasks, continue the batch
If one Notion task fails to sync to GitHub, log the error, skip that task, and continue processing the rest. Use `Promise.allSettled()` not `Promise.all()`.

---

## TypeScript Rules

### No `any`
`tsconfig.json` enforces `strict: true`. If you need to handle an unknown webhook payload shape, use `unknown` and narrow with a type guard, not `any`.

### Zod for all external data boundaries
- Environment variables: validated in `src/config.ts` at startup
- GitHub webhook payloads: validate the fields you use with Zod before passing to handlers
- Notion API responses: validate before reading nested properties

### Enums vs union types
Use `enum` for `NotionDocType` (it maps to Notion database IDs at runtime). Use string union types for everything else (e.g., event action strings).

---

## File Change Classification

This logic lives in `src/handlers/push.ts` and determines what documentation to generate. Rules:

| File pattern | Doc type generated |
|---|---|
| `routes/`, `api/`, `**/*.openapi.*`, `swagger*` | API Reference |
| `Dockerfile*`, `docker-compose*`, `k8s/`, `terraform/`, `*.tf`, `.github/workflows/` | Runbook |
| `src/`, `lib/`, `app/` (>50 lines changed) | ADR candidate (Claude decides) |
| `*.md`, `*.lock`, `*.png`, `*.svg`, `dist/`, `build/` | Ignored — no doc generated |

These patterns are the source of truth. If you change them, update this table.

---

## Docker & Process Safety

⚠️ **NEVER interfere with Docker containers or processes that belong to other projects.**

- Only stop/kill/restart containers and processes that are **explicitly part of notican-mcp-challange**
- Other projects (orbit, pet-diabet, aws-monthly, ercanermis.com) are live services — touching them causes downtime
- If a port conflict exists, change **this project's port**, never the other project's
- Forbidden unless explicitly for a notican container: `docker stop`, `docker kill`, `docker rm`, `docker compose down`, killing PIDs
- Port registry: `~/claude-docker-ports/docker_ports_information.txt`

---

## Environment & Config Rules

- All config is in `src/config.ts` via Zod. Never read `process.env` directly anywhere else.
- `.env` is gitignored. `.env.example` is the contract — keep it up to date.
- Add new env vars to: `.env.example`, `src/config.ts` schema, and this file's table if relevant.

---

## What We Are Not Building

To keep scope tight, these are explicitly out of scope for v1:

- A UI or dashboard
- Support for multiple GitHub repos simultaneously
- Slack / email notifications
- Retry queues or persistent job storage
- Authentication beyond the existing webhook HMAC and Notion OAuth token
- Any caching layer
