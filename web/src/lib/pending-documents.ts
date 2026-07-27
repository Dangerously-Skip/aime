/**
 * Cross-request bridge for pending document prints (P4.2b).
 *
 * The main-side `documents:print-pdf` handler owns Chromium, but the Next server
 * is a CHILD PROCESS of Electron and cannot call `ipcMain` — so the server cannot
 * reach it directly. The hop is: server emits an SSE event → the client calls
 * `electronAPI.printDocumentPdf` → the client POSTs the result back → this bridge
 * settles and the tool returns.
 *
 * Chosen over having main open a loopback HTTP listener: that would add an
 * inbound socket to a local-first app for one feature, whereas this reuses the
 * cross-request rendezvous already proven by the question, browser-tool and
 * connector bridges (see rendezvous.ts).
 *
 * The cost is real and worth stating: printing needs a client that is actually
 * ACTING on the stream. A scheduled run, or an HTTP caller that never reads the
 * response body, has none — which is why `unclaimed` exists below.
 */
import { createRendezvous, type WaitOptions } from './rendezvous';

export interface DocumentPrintResult {
  ok: boolean;
  bytes?: number;
  /** Why not, when not ok. */
  error?: string;
  /**
   * Nobody answered at all — no client is acting on this stream.
   *
   * This is NOT the same fact as `ok: false` with an error, and the tool tells the
   * user different things about them: "PDF rendering needs the desktop app, so
   * only the HTML was written" versus "PDF rendering failed: <reason>". Before
   * this flag existed the two were indistinguishable, so every unconsumed stream
   * — the webhook path, notably — reported the invented failure "PDF rendering
   * timed out." to the model.
   */
  unclaimed?: true;
}

/**
 * Rendering is machine-paced, not human-paced — a long document is seconds, not
 * minutes — so this is far shorter than the connector bridge's five minutes.
 */
export const DOCUMENT_PRINT_TIMEOUT_MS = 60_000;

const documents = createRendezvous<DocumentPrintResult>({
  label: 'pending-documents',
  timeoutMs: DOCUMENT_PRINT_TIMEOUT_MS,
  onTimeout: { resolve: { ok: false, unclaimed: true } },
  onAbort: { resolve: { ok: false, error: 'The user stopped the turn before the PDF was rendered.' } },
});

/**
 * Wait for the client to print. RESOLVES on timeout and on abort rather than
 * rejecting: no PDF is something the tool reports alongside the HTML it already
 * wrote, whereas a rejection would surface as a tool error and lose that.
 */
export function waitForDocumentPrint(
  toolUseId: string,
  options?: WaitOptions,
): Promise<DocumentPrintResult> {
  return documents.wait(toolUseId, options);
}

/** Returns false when nothing is waiting, so the route can 404. */
export function resolveDocumentPrint(toolUseId: string, result: DocumentPrintResult): boolean {
  return documents.settle(toolUseId, result);
}

/** Test/observability helper. */
export function pendingDocumentCount(): number {
  return documents.size();
}
