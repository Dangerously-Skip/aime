/**
 * Cross-request bridge for pending connector requests (P3.3).
 *
 * When the agent finds it needs a service the user hasn't connected — it was
 * asked to send an email and there is no mail tool — it calls RequestConnector.
 * `canUseTool` parks a promise here and blocks, so the agent's turn pauses
 * mid-task rather than failing. The client renders a Connect card, the user
 * connects (or declines), and the card POSTs to /api/chat/connector-result,
 * which settles the promise and lets the same turn carry on.
 *
 * The cross-request bridge is the point: `canUseTool` runs inside the SDK loop on
 * the streaming request, but the answer arrives on a different HTTP request.
 *
 * Mechanics in rendezvous.ts. What is specific here: the budget is the longest of
 * the four because connecting involves a browser OAuth round trip — signing in,
 * possibly a 2FA prompt — which is human-paced; and silence RESOLVES rather than
 * rejecting, because "not connected" is something the agent can act on whereas a
 * rejection would surface as a tool error.
 *
 * (The previous hand-rolled version also stored a `reject` callback that nothing
 * ever called — copied from pending-questions, where a timeout does reject.)
 */
import { createRendezvous, type WaitOptions } from './rendezvous';

export interface ConnectorRequestResult {
  /** True when the service is now connected and usable. */
  connected: boolean;
  /** Why not, when connected is false — declined, cancelled, or an error. */
  reason?: string;
}

/** A browser OAuth dance plus sign-in is human-paced; five minutes is realistic. */
export const CONNECTOR_REQUEST_TIMEOUT_MS = 300_000;

const connectors = createRendezvous<ConnectorRequestResult>({
  label: 'pending-connectors',
  timeoutMs: CONNECTOR_REQUEST_TIMEOUT_MS,
  onTimeout: { resolve: { connected: false, reason: 'No response — the request timed out.' } },
  onAbort: { resolve: { connected: false, reason: 'The user stopped the turn before answering.' } },
});

/**
 * Wait for the user to resolve a connector request. Resolves rather than
 * rejecting on timeout or abort: an unanswered card means "not connected", which
 * the agent can act on, whereas a rejection would surface as a tool error.
 */
export function waitForConnector(
  toolUseId: string,
  options?: WaitOptions,
): Promise<ConnectorRequestResult> {
  return connectors.wait(toolUseId, options);
}

/**
 * Resolve a pending connector request. Returns false when there is no matching
 * request, so the route can 404 instead of silently accepting.
 */
export function resolveConnectorRequest(
  toolUseId: string,
  result: ConnectorRequestResult,
): boolean {
  return connectors.settle(toolUseId, result);
}

/** Test/observability helper — how many requests are awaiting an answer. */
export function pendingConnectorCount(): number {
  return connectors.size();
}
