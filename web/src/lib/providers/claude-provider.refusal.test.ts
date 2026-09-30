import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as os from 'os';
import { create } from 'zustand';
import type { QueryParams, StreamChunk } from './base-provider';
import { createTranscriptSlice, type TranscriptSlice } from '@/stores/slices/transcript-slice';
import { handleCoreChunk, resetTextBoundary } from '@/lib/sse/core-chunks';

/**
 * A refused reply, re-run on a fallback model (Agent SDK 0.3), end to end:
 * the SDK's messages → the real provider → the real shared chunk handler → a
 * real transcript store.
 *
 * Before this the refused partial stayed on screen above the fallback's answer
 * — the assistant appearing to start one thing and say another — and went back
 * to the model as history. The SDK names what to evict; nothing listened.
 *
 * Two orders are covered because the SDK documents both signals without
 * pinning their timing: the `model_refusal_fallback` notice (listing the
 * retracted uuids) and `supersedes` on the replacement's first frame, which
 * arrives AFTER that frame's text has already streamed.
 */

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: unknown) => queryMock(args),
  tool: (name: string, description: string, schema: unknown, handler: unknown) => ({ name, description, schema, handler }),
  createSdkMcpServer: (config: unknown) => config,
}));

vi.mock('../security/settings', async (orig) => ({
  ...(await orig<typeof import('../security/settings')>()),
  loadSecuritySettings: async () => ({
    blockDangerousCommands: false,
    blockNetworkCommands: false,
    restrictToProjectFolder: false,
    disableBashTool: false,
  }),
}));

const start = (id: string) => ({ type: 'stream_event', event: { type: 'message_start', message: { id } } });
const delta = (text: string) => ({
  type: 'stream_event',
  event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
});
const frame = (uuid: string, id: string, block: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: 'assistant',
  uuid,
  message: { id, content: [block] },
  ...extra,
});
const result = (uuid: string, toolUseId: string, content: string) => ({
  type: 'user',
  uuid,
  message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content }] },
});

/** A kept response that reads a file, then a refused one that calls Bash. */
const BEFORE_REFUSAL = [
  start('m_ok'),
  delta('Let me check. '),
  frame('u_ok', 'm_ok', { type: 'text', text: 'Let me check. ' }),
  frame('u_ok2', 'm_ok', { type: 'tool_use', name: 'Read', input: { file_path: '/a' }, id: 'tu_ok' }),
  result('u_res', 'tu_ok', 'data'),
  start('m_ref'),
  delta('REFUSED '),
  delta('partial'),
  frame('u_ref1', 'm_ref', { type: 'text', text: 'REFUSED partial' }),
  frame('u_ref2', 'm_ref', { type: 'tool_use', name: 'Bash', input: { command: 'x' }, id: 'tu_ref' }),
  result('u_tomb', 'tu_ref', 'Not run: the response that made this tool call was stopped by a safety classifier.'),
];

const NOTICE = {
  type: 'system',
  subtype: 'model_refusal_fallback',
  trigger: 'refusal',
  direction: 'retry',
  original_model: 'claude-opus-4-5',
  fallback_model: 'claude-sonnet-4-5',
  retracted_message_uuids: ['u_ref1', 'u_ref2', 'u_tomb'],
};

const FALLBACK = [
  start('m_fb'),
  delta('FALLBACK answer'),
  frame('u_fb', 'm_fb', { type: 'text', text: 'FALLBACK answer' }, { supersedes: ['u_ref1', 'u_ref2'] }),
];

/** Notice first, then the replacement streams. */
const NOTICE_FIRST = [...BEFORE_REFUSAL, NOTICE, ...FALLBACK];
/** No notice: only `supersedes`, after the replacement's text is already out. */
const SUPERSEDES_ONLY = [...BEFORE_REFUSAL, ...FALLBACK];

async function providerChunks(script: unknown[]): Promise<StreamChunk[]> {
  queryMock.mockImplementation(async function* () {
    for (const c of script) yield c;
  });
  const { ClaudeProvider } = await import('./claude-provider');
  const out: StreamChunk[] = [];
  for await (const c of new ClaudeProvider().query({ prompt: 'go', chatId: 'refusal-chat', cwd: os.tmpdir() } as QueryParams)) out.push(c);
  return out;
}

/** Feed the provider's output through the shared handler into a real transcript store. */
function transcriptOf(chunks: StreamChunk[]) {
  const store = create<TranscriptSlice>()((set) => createTranscriptSlice(set));
  const chatId = 'c1';
  resetTextBoundary(chatId);
  store.getState().addMessage(chatId, { id: 'u', role: 'user', content: 'go', timestamp: 0 });
  store.getState().addMessage(chatId, { id: 'a', role: 'assistant', content: '', timestamp: 1 });
  for (const chunk of chunks) {
    const s = store.getState();
    handleCoreChunk(chunk as unknown as Record<string, unknown>, {
      chatId,
      store: {
        addMessage: s.addMessage,
        appendToLastAssistant: s.appendToLastAssistant,
        addToolCall: s.addToolCall,
        updateToolResult: s.updateToolResult,
        completeRunningTools: s.completeRunningTools,
        markSegment: s.markSegment,
        retractSegments: s.retractSegments,
      },
      printDocument: vi.fn(),
      onCanvas: vi.fn(),
    });
  }
  return store.getState().messages[chatId].at(-1)!;
}

beforeEach(() => queryMock.mockReset());

describe('the provider turns a refusal fallback into one retract event', () => {
  it.each([
    ['the notice arrives first', NOTICE_FIRST],
    ['only `supersedes` arrives', SUPERSEDES_ONLY],
  ])('%s', async (_label, script) => {
    const chunks = await providerChunks(script);
    const retracts = chunks.filter((c) => c.type === 'retract');
    expect(retracts).toHaveLength(1);

    const texts = chunks.filter((c) => c.type === 'text');
    const refusedSegment = texts.find((c) => c.content === 'REFUSED ')!.segment;
    expect(texts.find((c) => c.content === 'partial')!.segment).toBe(refusedSegment);
    expect(texts.find((c) => c.content === 'Let me check. ')!.segment).not.toBe(refusedSegment);
    expect(texts.find((c) => c.content === 'FALLBACK answer')!.segment).not.toBe(refusedSegment);

    expect(retracts[0]).toMatchObject({
      segments: [refusedSegment],
      toolUseIds: ['tu_ref'],
      texts: ['REFUSED partial'],
    });
  });

  it('retracts before the fallback streams, when the notice comes first', async () => {
    const chunks = await providerChunks(NOTICE_FIRST);
    const at = (pred: (c: StreamChunk) => boolean) => chunks.findIndex(pred);
    const retract = at((c) => c.type === 'retract');
    expect(retract).toBeGreaterThan(at((c) => c.content === 'partial'));
    expect(retract).toBeLessThan(at((c) => c.content === 'FALLBACK answer'));
  });

  it('emits nothing for a turn that was never refused', async () => {
    const chunks = await providerChunks([...BEFORE_REFUSAL.slice(0, 5)]);
    expect(chunks.some((c) => c.type === 'retract')).toBe(false);
  });

  it('tags every tool call with its segment', async () => {
    const chunks = await providerChunks(NOTICE_FIRST);
    const tools = chunks.filter((c) => c.type === 'tool_use');
    expect(tools.map((c) => typeof c.segment)).toEqual(['string', 'string']);
    expect(tools[0].segment).not.toBe(tools[1].segment);
  });
});

describe('the transcript loses exactly the refused output', () => {
  it.each([
    ['the notice arrives first', NOTICE_FIRST],
    ['only `supersedes` arrives, after the fallback text', SUPERSEDES_ONLY],
  ])('%s', async (_label, script) => {
    const reply = transcriptOf(await providerChunks(script));

    expect(reply.content).toBe('Let me check. \n\nFALLBACK answer');
    expect(reply.content).not.toContain('REFUSED');
    // The kept tool call is still there, still between the two paragraphs…
    expect(reply.toolCalls?.map((t) => t.id)).toEqual(['tu_ok']);
    expect(reply.toolCalls?.[0].textOffset).toBe('Let me check. '.length);
    // …and nothing of the refused leg is left to render.
    expect(reply.content.slice(reply.toolCalls![0].textOffset!)).toBe('\n\nFALLBACK answer');
  });

  it('leaves a reply alone when the retraction names nothing it was sent', async () => {
    const reply = transcriptOf(
      await providerChunks([...BEFORE_REFUSAL.slice(0, 5), { ...NOTICE, retracted_message_uuids: ['nobody'] }]),
    );
    expect(reply.content).toBe('Let me check. ');
    expect(reply.toolCalls?.map((t) => t.id)).toEqual(['tu_ok']);
  });
});
