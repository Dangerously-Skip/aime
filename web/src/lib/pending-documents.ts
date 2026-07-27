/**
 * In-memory registry for pending document prints (P4.2b).
 *
 * The main-side `documents:print-pdf` handler owns Chromium, but the Next server
 * is a CHILD PROCESS of Electron and cannot call `ipcMain` — so the server cannot
 * reach it directly. The hop is: server emits an SSE event → the client calls
 * `electronAPI.printDocumentPdf` → the client POSTs the result back → this bridge
 * resolves and the tool returns.
 *
 * Chosen over having main open a loopback HTTP listener: that would add an
 * inbound socket to a local-first app for one feature, whereas this reuses the
 * cross-request rendezvous already proven by pending-questions,
 * pending-browser-tools and pending-connectors.
 *
 * The cost is real and worth stating: printing needs a connected client, so a
 * SCHEDULED run with no window open cannot produce a PDF. It still writes themed
 * HTML, which is why that fallback exists.
 */

export interface DocumentPrintResult {
  ok: boolean;
  /** Where the PDF landed, when ok. */
  path?: string;
  bytes?: number;
  /** Why not, when not ok. */
  error?: string;
}

interface PendingEntry {
  resolve: (result: DocumentPrintResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingEntry>();

/**
 * Rendering is machine-paced, not human-paced — a long document is seconds, not
 * minutes — so this is far shorter than the connector bridge's five minutes.
 */
export const DOCUMENT_PRINT_TIMEOUT_MS = 60_000;

/**
 * Wait for the client to print. RESOLVES on timeout rather than rejecting: a
 * timeout means "no PDF", which the tool reports alongside the HTML it already
 * wrote, whereas a rejection would surface as a tool error and lose that.
 */
export function waitForDocumentPrint(toolUseId: string): Promise<DocumentPrintResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pending.has(toolUseId)) {
        pending.delete(toolUseId);
        resolve({ ok: false, error: 'PDF rendering timed out.' });
      }
    }, DOCUMENT_PRINT_TIMEOUT_MS);

    pending.set(toolUseId, { resolve, timer });
  });
}

/** Returns false when nothing is waiting, so the route can 404. */
export function resolveDocumentPrint(toolUseId: string, result: DocumentPrintResult): boolean {
  const entry = pending.get(toolUseId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(toolUseId);
  entry.resolve(result);
  return true;
}

/** Test/observability helper. */
export function pendingDocumentCount(): number {
  return pending.size;
}
