import request from 'supertest';
import crypto from 'crypto';

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

jest.mock('../handlers', () => ({
  routeEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@octokit/webhooks', () => {
  return {
    Webhooks: jest.fn().mockImplementation(() => ({
      verify: jest.fn().mockImplementation((_body: string, signature: string) => {
        // Replicate real HMAC verification using the test secret
        const crypto = require('crypto');
        const hmac = crypto.createHmac('sha256', 'test-secret');
        hmac.update(_body);
        const expected = `sha256=${hmac.digest('hex')}`;
        return Promise.resolve(signature === expected);
      }),
    })),
  };
});

import { app, startServer } from './index';
import { routeEvent } from '../handlers';

const SECRET = 'test-secret';

function signPayload(body: string): string {
  const hmac = crypto.createHmac('sha256', SECRET);
  hmac.update(body);
  return `sha256=${hmac.digest('hex')}`;
}

describe('Express webhook server', () => {
  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok' });
    });
  });

  describe('POST /webhooks/github', () => {
    const payload = JSON.stringify({ action: 'opened', ref: 'refs/heads/main' });

    it('returns 202 and calls routeEvent when HMAC signature is valid', async () => {
      const signature = signPayload(payload);

      const res = await request(app)
        .post('/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', signature)
        .set('x-github-event', 'push')
        .set('x-github-delivery', 'delivery-1')
        .send(payload);

      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ accepted: true });

      // Allow async routeEvent to be called
      await new Promise((r) => setTimeout(r, 50));
      expect(routeEvent).toHaveBeenCalledWith('push', expect.any(Object));
    });

    it('returns 401 when HMAC signature is invalid', async () => {
      const res = await request(app)
        .post('/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', 'sha256=invalidsignature')
        .set('x-github-event', 'push')
        .set('x-github-delivery', 'delivery-2')
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: 'Invalid signature' });
    });

    it('returns 401 when signature header is missing', async () => {
      const res = await request(app)
        .post('/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-github-event', 'push')
        .set('x-github-delivery', 'delivery-3')
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ error: 'Missing signature header' });
    });

    it('returns 202 for unknown event type without crashing', async () => {
      const signature = signPayload(payload);

      const res = await request(app)
        .post('/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', signature)
        .set('x-github-event', 'unknown_event_xyz')
        .set('x-github-delivery', 'delivery-4')
        .send(payload);

      expect(res.status).toBe(202);
    });

    it('returns 400 when X-GitHub-Event header is missing', async () => {
      const signature = signPayload(payload);

      const res = await request(app)
        .post('/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', signature)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'Missing X-GitHub-Event header' });
    });

    it('still processes when X-GitHub-Delivery header is missing (uses undefined)', async () => {
      const signature = signPayload(payload);

      const res = await request(app)
        .post('/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', signature)
        .set('x-github-event', 'push')
        .send(payload);

      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ accepted: true });
    });

    it('routes issues event type', async () => {
      const issuesPayload = JSON.stringify({ action: 'opened', issue: { number: 1 } });
      const signature = signPayload(issuesPayload);

      const res = await request(app)
        .post('/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', signature)
        .set('x-github-event', 'issues')
        .set('x-github-delivery', 'delivery-issues')
        .send(issuesPayload);

      expect(res.status).toBe(202);
      await new Promise((r) => setTimeout(r, 50));
      expect(routeEvent).toHaveBeenCalledWith('issues', expect.any(Object));
    });

    it('routes pull_request event type', async () => {
      const prPayload = JSON.stringify({ action: 'opened', pull_request: { number: 10 } });
      const signature = signPayload(prPayload);

      const res = await request(app)
        .post('/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', signature)
        .set('x-github-event', 'pull_request')
        .set('x-github-delivery', 'delivery-pr')
        .send(prPayload);

      expect(res.status).toBe(202);
      await new Promise((r) => setTimeout(r, 50));
      expect(routeEvent).toHaveBeenCalledWith('pull_request', expect.any(Object));
    });

    it('handles routeEvent error gracefully without crashing server', async () => {
      (routeEvent as jest.Mock).mockRejectedValueOnce(new Error('handler error'));
      const signature = signPayload(payload);

      const res = await request(app)
        .post('/webhooks/github')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', signature)
        .set('x-github-event', 'push')
        .set('x-github-delivery', 'delivery-err')
        .send(payload);

      // Server responds 202 before async processing
      expect(res.status).toBe(202);
    });
  });

  describe('startServer', () => {
    it('is exported as a function', () => {
      expect(typeof startServer).toBe('function');
    });
  });
});
