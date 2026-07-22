import { describe, it, expect, beforeEach } from 'vitest';
import { useCoworkStore } from './cowork-store';
import { cleanStaleStreamingFlags, type Message, type ToolCall } from './chat-store';

let seq = 0;
const message = (overrides: Partial<Message> = {}): Message => ({
  id: `m${++seq}`,
  role: 'assistant',
  content: '',
  timestamp: Date.now(),
  ...overrides,
});

const toolCall = (overrides: Partial<ToolCall> = {}): ToolCall => ({
  id: `t${++seq}`,
  name: 'Read',
  input: {},
  status: 'running',
  startTime: Date.now(),
  ...overrides,
});

beforeEach(() => {
  useCoworkStore.setState({
    messages: {},
    currentChatId: null,
    model: 'opus',
    isStreaming: false,
    streamError: null,
    folderByChat: {},
    contextFiles: {},
    artifactFiles: {},
    canvasArtifacts: {},
    planContent: {},
    planOpen: false,
    sessionControls: {},
    lastActivityAt: {},
    searchGroups: {},
  });
});

const store = () => useCoworkStore.getState();

describe('messages', () => {
  it('appends messages per chat', () => {
    store().addMessage('chat1', message({ role: 'user', content: 'hi' }));
    store().addMessage('chat2', message({ role: 'user', content: 'other' }));
    expect(store().messages['chat1']).toHaveLength(1);
    expect(store().messages['chat2']).toHaveLength(1);
  });

  it('appendToLastAssistant concatenates content and thinking', () => {
    store().addMessage('c', message({ content: 'Hello', thinking: 'hm', isLoading: true }));
    store().appendToLastAssistant('c', ' world', ' more');

    const [msg] = store().messages['c'];
    expect(msg.content).toBe('Hello world');
    expect(msg.thinking).toBe('hm more');
    expect(msg.isLoading).toBe(false);
  });

  it('appendToLastAssistant is a no-op when the last message is not from the assistant', () => {
    store().addMessage('c', message({ role: 'user', content: 'question' }));
    store().appendToLastAssistant('c', 'should not attach');
    expect(store().messages['c'][0].content).toBe('question');
  });

  it('clearMessages removes only that chat', () => {
    store().addMessage('a', message());
    store().addMessage('b', message());
    store().clearMessages('a');
    expect(store().messages['a']).toBeUndefined();
    expect(store().messages['b']).toHaveLength(1);
  });
});

describe('tool calls', () => {
  it('attaches tool calls to the last assistant message', () => {
    store().addMessage('c', message());
    store().addToolCall('c', toolCall({ name: 'Grep' }));
    expect(store().messages['c'][0].toolCalls).toHaveLength(1);
  });

  it('updateToolResult sets output, status and endTime', () => {
    store().addMessage('c', message());
    const tc = toolCall();
    store().addToolCall('c', tc);

    store().updateToolResult('c', tc.id, 'file contents');
    const updated = store().messages['c'][0].toolCalls![0];
    expect(updated.output).toBe('file contents');
    expect(updated.status).toBe('complete');
    expect(updated.endTime).toBeGreaterThan(0);

    store().updateToolResult('c', tc.id, 'boom', true);
    expect(store().messages['c'][0].toolCalls![0].status).toBe('error');
  });

  it('completeRunningTools finishes only running tools', () => {
    store().addMessage('c', message());
    const running = toolCall({ status: 'running' });
    const done = toolCall({ status: 'error' });
    store().addToolCall('c', running);
    store().addToolCall('c', done);

    store().completeRunningTools('c');
    const calls = store().messages['c'][0].toolCalls!;
    expect(calls.find((t) => t.id === running.id)?.status).toBe('complete');
    expect(calls.find((t) => t.id === done.id)?.status).toBe('error');
  });
});

describe('streaming lifecycle', () => {
  it('stopStreaming clears flags on the last message', () => {
    store().addMessage('c', message({ isStreaming: true, isLoading: true }));
    store().startStreaming('c');
    expect(store().isStreaming).toBe(true);
    expect(store().currentChatId).toBe('c');

    store().stopStreaming('c');
    expect(store().isStreaming).toBe(false);
    const [msg] = store().messages['c'];
    expect(msg.isStreaming).toBe(false);
    expect(msg.isLoading).toBe(false);
  });
});

describe('model validation', () => {
  it('accepts only known models', () => {
    store().setModel('haiku');
    expect(store().model).toBe('haiku');
    store().setModel('gpt-4');
    expect(store().model).toBe('haiku');
  });
});

describe('sidebar files', () => {
  it('deduplicates context and artifact files per chat', () => {
    store().addContextFile('c', '/a.md');
    store().addContextFile('c', '/a.md');
    store().addArtifactFile('c', '/out.txt');
    store().addArtifactFile('c', '/out.txt');
    expect(store().contextFiles['c']).toEqual(['/a.md']);
    expect(store().artifactFiles['c']).toEqual(['/out.txt']);
  });

  it('removes individual files', () => {
    store().addContextFile('c', '/a.md');
    store().removeContextFile('c', '/a.md');
    expect(store().contextFiles['c']).toEqual([]);
  });

  it('clearSidebarFiles wipes context, artifacts and canvases for the chat', () => {
    store().addContextFile('c', '/a.md');
    store().addArtifactFile('c', '/out.txt');
    store().addContextFile('other', '/keep.md');

    store().clearSidebarFiles('c');
    expect(store().contextFiles['c']).toBeUndefined();
    expect(store().artifactFiles['c']).toBeUndefined();
    expect(store().contextFiles['other']).toEqual(['/keep.md']);
  });
});

describe('search groups', () => {
  it('accumulates search groups per chat and clears them', () => {
    const group = { query: 'weather', results: [{ title: 't', url: 'u', snippet: 's' }] };
    store().addSearchGroup('c', group);
    store().addSearchGroup('c', group);
    expect(store().searchGroups['c']).toHaveLength(2);

    store().clearSearchGroups('c');
    expect(store().searchGroups['c']).toEqual([]);
  });
});

describe('cleanStaleStreamingFlags', () => {
  it('clears stale streaming/loading flags across chats', () => {
    const cleaned = cleanStaleStreamingFlags({
      a: [message({ isStreaming: true }), message({ isLoading: true })],
      b: [message()],
    });
    expect(cleaned['a'].every((m) => !m.isStreaming && !m.isLoading)).toBe(true);
  });

  it('returns the same reference when nothing changed', () => {
    const input = { a: [message()] };
    expect(cleanStaleStreamingFlags(input)).toBe(input);
  });
});
