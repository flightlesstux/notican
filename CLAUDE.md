# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Autonomous Engineering Intelligence Hub

A bidirectional GitHub ↔ Notion sync system powered by Claude AI. GitHub activity (PRs, commits, issues) automatically generates and updates living documentation in Notion. Notion tasks auto-create GitHub issues.

**Challenge:** Notion MCP Challenge — judged on Originality, Technical Complexity, Practical Implementation.

## How It Works

```
GitHub Events (webhooks)
        ↓
  Webhook Server (Express)
        ↓
  Event Processor
        ↓
  Claude AI (diff analysis, doc generation)
        ↓
  Notion MCP Client → writes to Notion workspace

Notion Watcher (polling)
        ↓
  Detects new tasks tagged "create-github-issue"
        ↓
  GitHub API → creates issue
```

## Notion Workspace Structure

Four auto-maintained databases:
- **Architecture Decisions** — ADRs generated from significant PRs
- **API Reference** — Updated when API files change
- **Runbooks** — Generated/updated from infrastructure changes
- **Changelog** — Auto-populated on every merge to main
- **Tasks** — Bidirectional sync with GitHub Issues

## Tech Stack

- **Runtime:** Node.js + TypeScript
- **Webhook server:** Express.js
- **AI:** Claude API (`claude-sonnet-4-6`) for diff analysis and doc generation
- **Notion:** Notion MCP via `@notionhq/client` + MCP protocol
- **GitHub:** Octokit for GitHub API (issue creation), webhooks via `@octokit/webhooks`

## Project Structure

```
src/
  server/           # Express webhook server
  handlers/         # GitHub event handlers (pr, push, issue)
  processors/       # AI-powered analysis (diff, doc generation)
  notion/           # Notion MCP client wrappers
  github/           # GitHub API client (issue creation)
  watcher/          # Notion task watcher (polling loop)
  types/            # Shared TypeScript types
  __fixtures__/     # Shared test fixtures (GitHub events, Notion responses)
scripts/
  setup-notion.ts   # One-time Notion workspace setup
landing/
  index.html        # Standalone marketing page
```

## Commands

```bash
# Install dependencies
npm install

# Development (with hot reload)
npm run dev

# Build
npm run build

# Run production
npm start

# Setup Notion workspace (first time)
npm run setup:notion

# Run all tests
npm test

# Run tests in watch mode (during development)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run a single test file
npx jest src/handlers/pr.test.ts

# Lint
npm run lint
```

## Environment Variables

```
GITHUB_WEBHOOK_SECRET=     # GitHub webhook secret
GITHUB_TOKEN=              # GitHub PAT for creating issues
GITHUB_OWNER=              # GitHub org or username
GITHUB_REPO=               # GitHub repo name
NOTION_TOKEN=              # Notion integration token
NOTION_PARENT_PAGE_ID=     # Parent page ID for setup:notion (from Notion page URL)
NOTION_DATABASE_ADR=       # Notion database ID for Architecture Decisions
NOTION_DATABASE_CHANGELOG= # Notion database ID for Changelog
NOTION_DATABASE_API_REF=   # Notion database ID for API Reference
NOTION_DATABASE_RUNBOOKS=  # Notion database ID for Runbooks
NOTION_DATABASE_TASKS=     # Notion database ID for Tasks
ANTHROPIC_API_KEY=         # Claude API key
PORT=4000
POLL_INTERVAL_SECONDS=60
```

## Docker & Ports

```bash
# Build and run with Docker Compose
docker compose up -d

# Build image only
docker compose build

# Stop (this project only — never touch other projects)
docker compose down

# View logs
docker compose logs -f notican-webhook
```

| Port | Container | Description |
|------|-----------|-------------|
| 4000 | notican-webhook | GitHub webhook receiver + Notion sync server |

Port 4000 is safe — orbit uses 4001/4002, pet-diabet uses 3000–3003. Next free port is 5000.

Files: `Dockerfile` (multi-stage, node:22-alpine), `docker-compose.yml`, `.dockerignore`.

## Docker Safety Rule

⚠️ **NEVER kill, stop, restart, or interfere with Docker containers or processes belonging to other projects.**
Other projects (pet-diabet, orbit, aws-monthly, ercanermis.com) are live services. Downtime is not acceptable.

- Only manage containers/processes for **this project** (notican-mcp-challange)
- If a port conflict arises, resolve it by changing **this project's** port — never touching the other project
- Never run: `docker stop`, `docker kill`, `docker rm`, `docker-compose down` unless it is explicitly for a notican container
- Never kill PIDs that belong to other projects' processes
- The full port registry is at `~/claude-docker-ports/docker_ports_information.txt`

## TDD Approach

This project follows strict Test-Driven Development. **Write the test first, then the implementation.**

### Cycle for every feature
1. Write a failing test that defines the expected behavior
2. Run `npm run test:watch` — confirm it fails for the right reason
3. Write the minimum code to make it pass
4. Refactor if needed — tests must still pass
5. Move to the next test

### Test file location
Co-locate tests next to the source file:
```
src/handlers/pr.ts
src/handlers/pr.test.ts

src/processors/claude.ts
src/processors/claude.test.ts
```

### What to test (by layer)

| Layer | Test focus | External calls |
|---|---|---|
| `handlers/` | Correct routing logic, right processor called with right args | Mock `processors/`, `notion/`, `github/` |
| `processors/claude.ts` | Prompt construction, output parsing, correct `ProcessedDoc` returned | Mock `Anthropic` client |
| `notion/client.ts` | Correct Notion API calls, idempotency logic, markdown→blocks conversion | Mock `@notionhq/client` |
| `github/client.ts` | Correct Octokit calls, parameter mapping | Mock `@octokit/rest` |
| `watcher/` | Task detection, GitHub issue creation, mark-synced logic | Mock `notion/`, `github/` |
| `server/` | HMAC verification, routing to correct handler, always returns 200 | Mock handlers |

### Mocking rules
- Use `jest.mock()` at the module level for all external SDK clients (`@notionhq/client`, `@anthropic-ai/sdk`, `@octokit/rest`)
- Never mock internal modules (e.g., don't mock `src/notion/client` inside a `notion/client.test.ts`)
- Use `jest.spyOn()` for internal calls where you need to verify arguments
- Test fixtures live in `src/__fixtures__/` — shared GitHub event payloads, Notion responses, etc.

### Coverage thresholds
CI enforces minimum 80% coverage on branches, functions, lines, statements. Run `npm run test:coverage` to check locally before committing.

### CI/CD
GitHub Actions runs on every push and PR:
- `npm run lint` — must pass
- `npm run build` — must pass
- `npm test -- --coverage` — must pass with coverage thresholds

Pipeline defined in `.github/workflows/ci.yml`. Do not push to GitHub until explicitly told to — file exists locally only.

## Key Design Decisions

- **Claude analyzes diffs** to decide what kind of doc to generate (ADR vs changelog vs API ref update)
- **Notion MCP** is used for all Notion writes — not the raw REST API
- **Idempotent writes** — each PR/commit maps to a stable Notion page ID to avoid duplicates
- **Notion task watcher** polls every 60s for tasks tagged `github-issue`, creates issues, removes tag

## Landing Page

Standalone HTML file at `landing/index.html`. Open directly in browser — no server needed.

- **Style:** Dark + Neon (bg `#0a0a0f`, accent `#6366f1` indigo / `#06b6d4` cyan)
- **Fonts:** Inter (UI) + JetBrains Mono (code/terminal blocks) via Google Fonts CDN
- **Sections:** Hero with animated flow diagram → Stats bar → How it works → Features → Terminal setup → Architecture diagram → Notion databases → CTA
- **Animations:** Scroll-reveal (IntersectionObserver), ambient blob glow, staggered grid entrance, pulsing flow arrows
- **No build step** — single self-contained HTML file, zero dependencies beyond Google Fonts CDN
- **Mobile compatible** — responsive breakpoints at 640px; flow diagram stacks vertically on mobile

To preview: `open landing/index.html`

## Key Resources

- Notion MCP docs: https://developers.notion.com/llms.txt
- MCP protocol: https://modelcontextprotocol.io/introduction
- Notion API: https://developers.notion.com/reference/intro
