// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useDocumentPrint } from './use-document-print';

/**
 * The contract: this ALWAYS reports back. If it ever fails to, the waiting
 * DocumentCreate tool sits blocked until its timeout and the user gets no PDF and
 * no explanation — so every exit path is asserted, including the ones that look
 * like dead ends.
 */

const fetchMock = vi.fn();
const printDocumentPdf = vi.fn();

const reports = () =>
  fetchMock.mock.calls
    .filter((c) => String(c[0]).includes('/api/chat/document-result'))
    .map((c) => JSON.parse((c[1] as RequestInit).body as string));

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  printDocumentPdf.mockResolvedValue({ ok: true, path: '/o/r.pdf', bytes: 2048 });
  (window as unknown as { electronAPI?: unknown }).electronAPI = { printDocumentPdf };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

const request = {
  toolUseId: 'doc_1',
  html: '<!DOCTYPE html><html><body>x</body></html>',
  outputPath: '/o/r.pdf',
  printOptions: { pageSize: 'A4' },
};

const run = async (over: Partial<typeof request> = {}) => {
  const { result } = renderHook(() => useDocumentPrint());
  await result.current({ ...request, ...over });
};

describe('useDocumentPrint', () => {
  it('prints through Electron and reports success', async () => {
    await run();

    expect(printDocumentPdf).toHaveBeenCalledWith({
      html: request.html,
      outputPath: '/o/r.pdf',
      printOptions: { pageSize: 'A4' },
    });
    // No `path`: the server already knows where it asked for the PDF, and the
    // route it reports to authenticates nothing — a client-supplied path was only
    // ever a way to make the model name a file of the caller's choosing.
    expect(reports()).toEqual([{ toolUseId: 'doc_1', ok: true, bytes: 2048 }]);
  });

  it('reports immediately outside the desktop app, rather than letting the tool hang', async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    await run();

    expect(printDocumentPdf).not.toHaveBeenCalled();
    expect(reports()[0]).toMatchObject({ ok: false });
    expect(reports()[0].error).toMatch(/desktop app/);
  });

  it('reports a print failure with its reason', async () => {
    printDocumentPdf.mockResolvedValue({ ok: false, error: 'Could not render the PDF' });
    await run();
    expect(reports()[0]).toMatchObject({ ok: false, error: 'Could not render the PDF' });
  });

  it('reports a thrown error rather than swallowing it', async () => {
    printDocumentPdf.mockRejectedValue(new Error('window destroyed'));
    await run();
    expect(reports()[0]).toMatchObject({ ok: false, error: 'window destroyed' });
  });

  it('reports not-ok when Electron returns something malformed', async () => {
    printDocumentPdf.mockResolvedValue(undefined);
    await run();
    expect(reports()[0]).toMatchObject({ ok: false });
  });

  it('omits path and bytes when they were not returned', async () => {
    printDocumentPdf.mockResolvedValue({ ok: true });
    await run();
    expect('path' in reports()[0]).toBe(false);
    expect('bytes' in reports()[0]).toBe(false);
  });

  it('defaults printOptions rather than sending undefined', async () => {
    await run({ printOptions: undefined });
    expect(printDocumentPdf.mock.calls[0][0].printOptions).toEqual({});
  });

  it('does not throw when reporting itself fails', async () => {
    // The tool times out on its own; crashing the surface would be worse.
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(run()).resolves.toBeUndefined();
  });
});
