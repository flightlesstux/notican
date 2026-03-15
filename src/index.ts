import 'dotenv/config';
// config import triggers env validation at startup — fail fast before anything else
import { config } from './config';
import { startServer } from './server';
import { startWatcher } from './watcher/notion-tasks';

console.log('='.repeat(60));
console.log(' Autonomous Engineering Intelligence Hub');
console.log(' GitHub ↔ Notion Bidirectional Sync');
console.log('='.repeat(60));
console.log(`[Main] Environment: ${process.env.NODE_ENV ?? 'development'}`);
console.log(`[Main] GitHub: ${config.GITHUB_OWNER}/${config.GITHUB_REPO}`);
console.log(`[Main] Poll interval: ${config.POLL_INTERVAL_SECONDS}s`);

// Start the Express webhook server
startServer();

// Start the Notion task watcher cron job
startWatcher();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Main] SIGTERM received — shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Main] SIGINT received — shutting down gracefully');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('[Main] Uncaught exception:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled promise rejection:', reason);
  process.exit(1);
});
