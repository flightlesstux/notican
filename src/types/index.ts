// GitHub event types
export type GitHubEventType = 'pull_request' | 'push' | 'issues';

export interface PullRequestEvent {
  action: string;
  number: number;
  pull_request: {
    id: number;
    number: number;
    title: string;
    body: string | null;
    state: string;
    merged: boolean;
    merge_commit_sha: string | null;
    base: {
      ref: string;
      sha: string;
    };
    head: {
      ref: string;
      sha: string;
    };
    user: {
      login: string;
    };
    html_url: string;
    diff_url: string;
    patch_url: string;
    additions: number;
    deletions: number;
    changed_files: number;
  };
  repository: GitHubRepository;
  sender: GitHubUser;
}

export interface PushEvent {
  ref: string;
  before: string;
  after: string;
  commits: GitHubCommit[];
  repository: GitHubRepository;
  pusher: {
    name: string;
    email: string;
  };
  sender: GitHubUser;
}

export interface IssueEvent {
  action: string;
  issue: {
    id: number;
    number: number;
    title: string;
    body: string | null;
    state: string;
    html_url: string;
    user: GitHubUser;
    labels: Array<{ name: string; color: string }>;
    assignees: GitHubUser[];
  };
  repository: GitHubRepository;
  sender: GitHubUser;
}

export type GitHubEvent = PullRequestEvent | PushEvent | IssueEvent;

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
}

export interface GitHubUser {
  login: string;
  avatar_url: string;
  html_url: string;
}

export interface GitHubCommit {
  id: string;
  message: string;
  timestamp: string;
  url: string;
  author: {
    name: string;
    email: string;
  };
  added: string[];
  removed: string[];
  modified: string[];
}

export interface ChangedFile {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed';
  additions: number;
  deletions: number;
  patch?: string;
}

// Notion document types
export enum NotionDocType {
  ADR = 'ADR',
  CHANGELOG = 'CHANGELOG',
  API_REF = 'API_REF',
  RUNBOOK = 'RUNBOOK',
}

export interface ProcessedDoc {
  type: NotionDocType;
  title: string;
  content: string;
  metadata: Record<string, string | number | boolean | null>;
}

// GitHub issue payload for Notion → GitHub sync
export interface GitHubIssuePayload {
  title: string;
  body: string;
  labels: string[];
  assignees?: string[];
}

// Notion task with github-issue tag
export interface NotionTask {
  id: string;
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  githubIssueNumber?: number;
  githubIssueUrl?: string;
  githubSync: boolean;
}

// ADR context for Claude
export interface ADRContext {
  prTitle: string;
  prBody: string;
  diff: string;
  changedFiles: ChangedFile[];
  prNumber: number;
  prUrl: string;
  author: string;
}

// Runbook context for Claude
export interface RunbookContext {
  changedFiles: ChangedFile[];
  commitMessages: string[];
  ref: string;
  repoName: string;
  repoUrl: string;
}
