import type { PullRequestEvent, PushEvent, IssueEvent, NotionTask } from '../types';

// ── Pull Request Fixtures ────────────────────────────────────────────────────

export const prMergedToMain: PullRequestEvent = {
  action: 'closed',
  number: 42,
  pull_request: {
    id: 1001,
    number: 42,
    title: 'feat: add user authentication with JWT',
    body: 'Implements JWT-based auth. Adds /auth/login and /auth/refresh endpoints.',
    state: 'closed',
    merged: true,
    merge_commit_sha: 'abc123def456',
    base: { ref: 'main', sha: 'base-sha-123' },
    head: { ref: 'feat/jwt-auth', sha: 'head-sha-456' },
    user: { login: 'octocat' },
    html_url: 'https://github.com/test-owner/test-repo/pull/42',
    diff_url: 'https://github.com/test-owner/test-repo/pull/42.diff',
    patch_url: 'https://github.com/test-owner/test-repo/pull/42.patch',
    additions: 312,
    deletions: 45,
    changed_files: 8,
  },
  repository: {
    id: 9001,
    name: 'test-repo',
    full_name: 'test-owner/test-repo',
    html_url: 'https://github.com/test-owner/test-repo',
    default_branch: 'main',
  },
  sender: {
    login: 'octocat',
    avatar_url: 'https://github.com/octocat.png',
    html_url: 'https://github.com/octocat',
  },
};

export const prOpened: PullRequestEvent = {
  ...prMergedToMain,
  action: 'opened',
  pull_request: {
    ...prMergedToMain.pull_request,
    state: 'open',
    merged: false,
    merge_commit_sha: null,
  },
};

// ── Push Fixtures ────────────────────────────────────────────────────────────

export const pushToMain: PushEvent = {
  ref: 'refs/heads/main',
  before: 'before-sha-111',
  after: 'after-sha-222',
  commits: [
    {
      id: 'after-sha-222',
      message: 'feat: add authentication endpoints',
      timestamp: '2026-03-15T10:00:00Z',
      url: 'https://github.com/test-owner/test-repo/commit/after-sha-222',
      author: { name: 'Octocat', email: 'octocat@github.com' },
      added: ['src/routes/auth.ts'],
      removed: [],
      modified: ['src/index.ts'],
    },
  ],
  repository: {
    id: 9001,
    name: 'test-repo',
    full_name: 'test-owner/test-repo',
    html_url: 'https://github.com/test-owner/test-repo',
    default_branch: 'main',
  },
  pusher: { name: 'octocat', email: 'octocat@github.com' },
  sender: {
    login: 'octocat',
    avatar_url: 'https://github.com/octocat.png',
    html_url: 'https://github.com/octocat',
  },
};

export const pushWithApiChanges: PushEvent = {
  ...pushToMain,
  commits: [
    {
      ...pushToMain.commits[0],
      added: ['src/routes/users.ts'],
      modified: ['src/routes/auth.ts', 'swagger.yaml'],
    },
  ],
};

export const pushWithInfraChanges: PushEvent = {
  ...pushToMain,
  commits: [
    {
      ...pushToMain.commits[0],
      message: 'chore: update Dockerfile and k8s deployment',
      added: ['k8s/deployment.yaml'],
      modified: ['Dockerfile'],
    },
  ],
};

// ── Issue Fixtures ───────────────────────────────────────────────────────────

export const issueOpened: IssueEvent = {
  action: 'opened',
  issue: {
    id: 2001,
    number: 15,
    title: 'Bug: login fails with special characters in password',
    body: 'When the password contains special characters like @#$, login returns 500.',
    state: 'open',
    html_url: 'https://github.com/test-owner/test-repo/issues/15',
    user: { login: 'octocat', avatar_url: '', html_url: '' },
    labels: [{ name: 'bug', color: 'd73a4a' }],
    assignees: [],
  },
  repository: {
    id: 9001,
    name: 'test-repo',
    full_name: 'test-owner/test-repo',
    html_url: 'https://github.com/test-owner/test-repo',
    default_branch: 'main',
  },
  sender: { login: 'octocat', avatar_url: '', html_url: '' },
};

export const issueClosed: IssueEvent = {
  ...issueOpened,
  action: 'closed',
  issue: { ...issueOpened.issue, state: 'closed' },
};

// ── Notion Task Fixtures ─────────────────────────────────────────────────────

export const notionTaskPendingSync: NotionTask = {
  id: 'notion-page-id-abc123',
  title: 'Implement rate limiting on API endpoints',
  body: 'We need to add rate limiting to prevent abuse. Use express-rate-limit.',
  labels: ['enhancement', 'backend'],
  assignees: ['octocat'],
  githubSync: true,
};

// ── GitHub API Response Fixtures ─────────────────────────────────────────────

export const sampleDiff = `
diff --git a/src/routes/auth.ts b/src/routes/auth.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/routes/auth.ts
@@ -0,0 +1,45 @@
+import { Router } from 'express';
+import jwt from 'jsonwebtoken';
+
+const router = Router();
+
+router.post('/login', async (req, res) => {
+  const { email, password } = req.body;
+  // authenticate user
+  const token = jwt.sign({ email }, process.env.JWT_SECRET!, { expiresIn: '1h' });
+  res.json({ token });
+});
+
+export default router;
`.trim();
