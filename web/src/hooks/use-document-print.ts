"use client";

import { useCallback } from "react";

/**
 * Relay a document print from the server to Electron main (P4.2b).
 *
 * The server writes the themed HTML and asks, over the open SSE stream, for it to
 * be turned into a PDF. Only the renderer can reach `ipcMain`, so the round trip
 * lands here: print, then POST the outcome back so the waiting tool call resumes.
 *
 * A shared hook rather than per-surface code because there are two surfaces and
 * the failure mode of forgetting one is silent — the tool would simply hang until
 * its timeout and report no PDF, with nothing to indicate why.
 */

export interface DocumentPrintRequest {
  toolUseId: string;
  html: string;
  outputPath: string;
  printOptions?: Record<string, unknown>;
}

async function report(
  toolUseId: string,
  result: { ok: boolean; path?: string; bytes?: number; error?: string },
): Promise<void> {
  await fetch("/api/chat/document-result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toolUseId, ...result }),
  }).catch(() => {
    // The tool times out on its own if this never lands; there is nothing useful
    // to show the user here, since the HTML was already written.
  });
}

export function useDocumentPrint(): (request: DocumentPrintRequest) => Promise<void> {
  return useCallback(async (request: DocumentPrintRequest) => {
    const api = typeof window !== "undefined" ? window.electronAPI : undefined;

    // Outside the packaged app there is no Chromium to print with. Report it
    // rather than staying silent, so the tool answers immediately with the HTML
    // outcome instead of waiting out its timeout.
    if (!api?.printDocumentPdf) {
      await report(request.toolUseId, {
        ok: false,
        error: "PDF rendering needs the desktop app.",
      });
      return;
    }

    try {
      const result = await api.printDocumentPdf({
        html: request.html,
        outputPath: request.outputPath,
        printOptions: request.printOptions ?? {},
      });
      await report(request.toolUseId, {
        ok: !!result?.ok,
        ...(result?.path ? { path: result.path } : {}),
        ...(typeof result?.bytes === "number" ? { bytes: result.bytes } : {}),
        ...(result?.error ? { error: result.error } : {}),
      });
    } catch (err) {
      await report(request.toolUseId, {
        ok: false,
        error: err instanceof Error ? err.message : "PDF rendering failed",
      });
    }
  }, []);
}
