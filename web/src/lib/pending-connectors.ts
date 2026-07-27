/**
 * In-memory registry for pending connector requests (P3.3).
 *
 * When the agent finds it needs a service the user hasn't connected — it was
 * asked to send an email and there is no mail tool — it calls RequestConnector.
 * `canUseTool` registers a promise here and blocks, so the agent's turn pauses
 * mid-task rather than failing. The client renders a Connect card, the user
 * connects (or declines), and the card POSTs to /api/chat/connector-result,
 * which resolves the promise and lets the same turn carry on.
 *
 * The cross-request map is the point: `canUseTool` runs inside the SDK loop on
 * the streaming request, but the answer arrives on a different HTTP request.
 *
 * Same pattern as pending-questions.ts and pending-browser-tools.ts. The timeout
 * is longer than either because connecting involves a browser OAuth round trip
 * — signing in, possibly a 2FA prompt — which is human-paced.
 */

export interface ConnectorRequestResult {
  /** True when the service is now connected and usable. */
  connected: boolean;
  /** Why not, when connected is false — declined, cancelled, or an error. */
  reason?: string;
}

interface PendingEntry {
  resolve: (result: ConnectorRequestResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingEntry>();

/** A browser OAuth dance plus sign-in is human-paced; five minutes is realistic. */
export const CONNECTOR_REQUEST_TIMEOUT_MS = 300_000;

/**
 * Wait for the user to resolve a connector request. Resolves rather than
 * rejecting on timeout: an unanswered card means "not connected", which the
 * agent can act on, whereas a rejection would surface as a tool error.
 */
export function waitForConnector(toolUseId: string): Promise<ConnectorRequestResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.has(toolUseId)) {
        pending.delete(toolUseId);
        resolve({ connected: false, reason: 'No response — the request timed out.' });
      }
    }, CONNECTOR_REQUEST_TIMEOUT_MS);

    pending.set(toolUseId, { resolve, reject, timer });
  });
}

/**
 * Resolve a pending connector request. Returns false when there is no matching
 * request, so the route can 404 instead of silently accepting.
 */
export function resolveConnectorRequest(
  toolUseId: string,
  result: ConnectorRequestResult,
): boolean {
  const entry = pending.get(toolUseId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(toolUseId);
  entry.resolve(result);
  return true;
}

/** Test/observability helper — how many requests are awaiting an answer. */
export function pendingConnectorCount(): number {
  return pending.size;
}
