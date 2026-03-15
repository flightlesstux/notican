import express, { Request, Response, NextFunction } from 'express';
import { Webhooks } from '@octokit/webhooks';
import { config } from '../config';
import { routeEvent } from '../handlers';

const app = express();

const webhooks = new Webhooks({
  secret: config.GITHUB_WEBHOOK_SECRET,
});

// Raw body parser for webhook signature verification
app.use('/webhooks/github', express.raw({ type: 'application/json' }));
app.use(express.json());

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'notican-mcp-challange',
  });
});

// GitHub webhook endpoint
app.post('/webhooks/github', async (req: Request, res: Response) => {
  const signature = req.headers['x-hub-signature-256'] as string;
  const eventType = req.headers['x-github-event'] as string;
  const deliveryId = req.headers['x-github-delivery'] as string;

  if (!signature) {
    res.status(401).json({ error: 'Missing signature header' });
    return;
  }

  if (!eventType) {
    res.status(400).json({ error: 'Missing X-GitHub-Event header' });
    return;
  }

  const body = req.body as Buffer;
  const rawBody = body.toString('utf-8');

  // Verify HMAC signature
  const isValid = await webhooks.verify(rawBody, signature);
  if (!isValid) {
    console.error(`[Webhook] Invalid signature for delivery ${deliveryId}`);
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch (_err) {
    res.status(400).json({ error: 'Invalid JSON payload' });
    return;
  }

  // Acknowledge immediately — GitHub expects < 10s response
  res.status(202).json({ accepted: true, deliveryId });

  // Process asynchronously
  routeEvent(eventType, payload).catch((err: Error) => {
    console.error(`[Webhook] Error processing ${eventType} event (delivery: ${deliveryId}):`, err.message);
  });
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

export function startServer(): void {
  app.listen(config.PORT, () => {
    console.log(`[Server] Listening on port ${config.PORT}`);
    console.log(`[Server] Webhook endpoint: POST http://localhost:${config.PORT}/webhooks/github`);
    console.log(`[Server] Health check:     GET  http://localhost:${config.PORT}/health`);
  });
}

export { app };
