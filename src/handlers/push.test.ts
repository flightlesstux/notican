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

jest.mock('../processors/claude', () => ({
  analyzeDiff: jest.fn().mockResolvedValue([]),
  generateChangelog: jest.fn().mockResolvedValue('## Changelog'),
  generateADR: jest.fn().mockResolvedValue('ADR content'),
  generateAPIRefUpdate: jest.fn().mockResolvedValue('API Ref content'),
  generateRunbook: jest.fn().mockResolvedValue('Runbook content'),
  summarizePR: jest.fn().mockResolvedValue('Summary'),
}));

jest.mock('../notion/client', () => ({
  createOrUpdatePage: jest.fn().mockResolvedValue('notion-page-id-123'),
  createPage: jest.fn().mockResolvedValue('notion-page-id-123'),
  findPageByExternalId: jest.fn().mockResolvedValue(null),
  updatePage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../github/client', () => ({
  getChangedFiles: jest.fn().mockResolvedValue([]),
  getPRDiff: jest.fn().mockResolvedValue(''),
  getPRChangedFiles: jest.fn().mockResolvedValue([]),
}));

import { handlePushEvent } from './push';
import { pushToMain, pushWithApiChanges, pushWithInfraChanges } from '../__fixtures__';
import { generateAPIRefUpdate, generateRunbook, generateADR } from '../processors/claude';
import { createOrUpdatePage } from '../notion/client';
import { getChangedFiles } from '../github/client';
import type { PushEvent, ChangedFile } from '../types';

describe('handlePushEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Push with API files', () => {
    it('triggers generateAPIRefUpdate when routes/ files are changed', async () => {
      const apiFile: ChangedFile = {
        filename: 'src/routes/auth.ts',
        status: 'added',
        additions: 50,
        deletions: 0,
        patch: '+export const router = Router();',
      };
      (getChangedFiles as jest.Mock).mockResolvedValue([apiFile]);

      await handlePushEvent(pushWithApiChanges);

      expect(generateAPIRefUpdate).toHaveBeenCalledWith([apiFile]);
      expect(createOrUpdatePage).toHaveBeenCalledWith(
        'db-api-ref',
        expect.stringContaining('api-ref'),
        expect.any(String),
        'API Ref content',
        expect.any(Object),
      );
    });

    it('triggers generateAPIRefUpdate when swagger files are changed', async () => {
      const swaggerFile: ChangedFile = {
        filename: 'docs/swagger.yaml',
        status: 'modified',
        additions: 10,
        deletions: 2,
        patch: '+  /new-endpoint:',
      };
      (getChangedFiles as jest.Mock).mockResolvedValue([swaggerFile]);

      const pushWithSwagger: PushEvent = {
        ...pushToMain,
        commits: [
          {
            ...pushToMain.commits[0],
            added: ['docs/swagger.yaml'],
            modified: [],
          },
        ],
      };

      await handlePushEvent(pushWithSwagger);

      expect(generateAPIRefUpdate).toHaveBeenCalledWith([swaggerFile]);
    });
  });

  describe('Push with infra files', () => {
    it('triggers generateRunbook when Dockerfile is changed', async () => {
      const infraFile: ChangedFile = {
        filename: 'Dockerfile',
        status: 'modified',
        additions: 5,
        deletions: 1,
        patch: '+RUN npm ci',
      };
      (getChangedFiles as jest.Mock).mockResolvedValue([infraFile]);

      await handlePushEvent(pushWithInfraChanges);

      expect(generateRunbook).toHaveBeenCalledWith(
        expect.objectContaining({
          changedFiles: [infraFile],
        }),
      );
      expect(createOrUpdatePage).toHaveBeenCalledWith(
        'db-runbooks',
        expect.any(String),
        expect.any(String),
        'Runbook content',
        expect.any(Object),
      );
    });

    it('triggers generateRunbook when k8s/ files are changed', async () => {
      const k8sFile: ChangedFile = {
        filename: 'k8s/deployment.yaml',
        status: 'modified',
        additions: 3,
        deletions: 1,
        patch: '+  replicas: 3',
      };
      (getChangedFiles as jest.Mock).mockResolvedValue([k8sFile]);

      await handlePushEvent(pushWithInfraChanges);

      expect(generateRunbook).toHaveBeenCalled();
    });
  });

  describe('Push to non-main branch', () => {
    it('does nothing when push is not to the default branch', async () => {
      const pushToFeature: PushEvent = {
        ...pushToMain,
        ref: 'refs/heads/feature/my-feature',
      };

      await handlePushEvent(pushToFeature);

      expect(getChangedFiles).not.toHaveBeenCalled();
      expect(generateAPIRefUpdate).not.toHaveBeenCalled();
      expect(generateRunbook).not.toHaveBeenCalled();
    });
  });

  describe('Push with no relevant files', () => {
    it('does nothing when changed files match no patterns', async () => {
      const unrelatedFile: ChangedFile = {
        filename: 'README.md',
        status: 'modified',
        additions: 2,
        deletions: 1,
        patch: '+Updated README',
      };
      (getChangedFiles as jest.Mock).mockResolvedValue([unrelatedFile]);

      await handlePushEvent(pushToMain);

      expect(generateAPIRefUpdate).not.toHaveBeenCalled();
      expect(generateRunbook).not.toHaveBeenCalled();
      expect(createOrUpdatePage).not.toHaveBeenCalled();
    });

    it('does nothing when only ignored files changed (*.lock)', async () => {
      const lockFile: ChangedFile = {
        filename: 'package-lock.json',
        status: 'modified',
        additions: 100,
        deletions: 50,
        patch: undefined,
      };
      (getChangedFiles as jest.Mock).mockResolvedValue([lockFile]);

      await handlePushEvent(pushToMain);

      expect(generateAPIRefUpdate).not.toHaveBeenCalled();
      expect(generateRunbook).not.toHaveBeenCalled();
      expect(createOrUpdatePage).not.toHaveBeenCalled();
    });
  });

  describe('Push to develop branch', () => {
    it('does nothing when push is to refs/heads/develop', async () => {
      const pushToDevelop: PushEvent = {
        ...pushToMain,
        ref: 'refs/heads/develop',
      };

      await handlePushEvent(pushToDevelop);

      expect(getChangedFiles).not.toHaveBeenCalled();
    });
  });

  describe('Push with mixed file types', () => {
    it('triggers both API ref and runbook updates when both API and infra files changed', async () => {
      const apiFile: ChangedFile = {
        filename: 'src/routes/users.ts',
        status: 'modified',
        additions: 10,
        deletions: 2,
        patch: '+router.get("/users")',
      };
      const infraFile: ChangedFile = {
        filename: 'Dockerfile',
        status: 'modified',
        additions: 3,
        deletions: 1,
        patch: '+RUN npm ci',
      };
      (getChangedFiles as jest.Mock).mockResolvedValue([apiFile, infraFile]);

      await handlePushEvent(pushToMain);

      expect(generateAPIRefUpdate).toHaveBeenCalledWith([apiFile]);
      expect(generateRunbook).toHaveBeenCalled();
    });
  });

  describe('Push with empty commits array', () => {
    it('still processes when commits array is empty', async () => {
      const pushWithNoCommits: PushEvent = {
        ...pushToMain,
        commits: [],
      };
      const apiFile: ChangedFile = {
        filename: 'src/api/auth.ts',
        status: 'added',
        additions: 20,
        deletions: 0,
        patch: '+export const auth = () => {}',
      };
      (getChangedFiles as jest.Mock).mockResolvedValue([apiFile]);

      await handlePushEvent(pushWithNoCommits);

      expect(generateAPIRefUpdate).toHaveBeenCalled();
    });
  });

  describe('Push branch deletion', () => {
    it('does nothing when after is all zeros (branch deletion)', async () => {
      const pushDeletion: PushEvent = {
        ...pushToMain,
        after: '0000000000000000000000000000000000000000',
      };

      await handlePushEvent(pushDeletion);

      expect(getChangedFiles).not.toHaveBeenCalled();
    });
  });

  describe('Push with arch files triggering ADR', () => {
    it('triggers ADR generation when 3+ architecture files changed', async () => {
      const archFiles: ChangedFile[] = [
        { filename: 'package.json', status: 'modified', additions: 5, deletions: 2, patch: '+jest' },
        { filename: 'tsconfig.json', status: 'modified', additions: 3, deletions: 1, patch: '+strict' },
        { filename: 'webpack.config.js', status: 'modified', additions: 10, deletions: 5, patch: '+entry' },
      ];
      (getChangedFiles as jest.Mock).mockResolvedValue(archFiles);

      await handlePushEvent(pushToMain);

      expect(generateADR).toHaveBeenCalled();
      expect(createOrUpdatePage).toHaveBeenCalledWith(
        'db-adr',
        expect.stringContaining('adr-push-'),
        expect.any(String),
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  describe('getChangedFiles throws', () => {
    it('returns gracefully when getChangedFiles throws', async () => {
      (getChangedFiles as jest.Mock).mockRejectedValue(new Error('API failure'));

      await expect(handlePushEvent(pushToMain)).resolves.not.toThrow();

      expect(generateAPIRefUpdate).not.toHaveBeenCalled();
    });
  });
});
