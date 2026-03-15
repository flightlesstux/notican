import type { PullRequestEvent, PushEvent, IssueEvent } from '../types';
import { handlePullRequestEvent } from './pr';
import { handlePushEvent } from './push';
import { handleIssueEvent } from './issue';

/**
 * Route a GitHub webhook event to the appropriate handler.
 * @param eventType - Value of the X-GitHub-Event header
 * @param payload   - Parsed JSON payload from the webhook body
 */
export async function routeEvent(eventType: string, payload: unknown): Promise<void> {
  console.log(`[Router] Routing event: ${eventType}`);

  switch (eventType) {
    case 'pull_request':
      await handlePullRequestEvent(payload as PullRequestEvent);
      break;

    case 'push':
      await handlePushEvent(payload as PushEvent);
      break;

    case 'issues':
      await handleIssueEvent(payload as IssueEvent);
      break;

    case 'ping':
      console.log('[Router] GitHub ping received — webhook configured successfully');
      break;

    default:
      console.log(`[Router] Unhandled event type: ${eventType}`);
  }
}

export { handlePullRequestEvent, handlePushEvent, handleIssueEvent };
