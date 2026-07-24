import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST } from './route';

const enc = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const UPSTREAM = 'https://api.example.com/v1';

/** POST to the shim with the given anthropic body + path tail. */
function call(body: unknown, tail: string[] = ['v1', 'messages'], headers: Record<string, string> = {}) {
  const slug = ['prov-1', enc(UPSTREAM), ...tail];
  const req = new Request('http://127.0.0.1:3100/api/llm-proxy/' + slug.join('/'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ slug }) });
}

function sseBody(...frames: string[]): ReadableStream<Uint8Array> {
  const e = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(e.encode(f));
      controller.close();
    },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('llm-proxy shim — non-streaming', () => {
  it('translates the request to OpenAI, forwards with the key, and maps the response back', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'cmpl_9',
          choices: [{ message: { content: 'hi from upstream' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const res = await call(
      { model: 'gpt-4o', system: 'be nice', messages: [{ role: 'user', content: 'hey' }] },
      ['v1', 'messages'],
      { 'x-api-key': 'sk-secret' },
    );
    const json = await res.json();

    // forwarded to <upstream>/chat/completions with a Bearer key
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-secret');
    const sent = JSON.parse(init.body as string);
    expect(sent.messages[0]).toEqual({ role: 'system', content: 'be nice' });
    expect(sent.model).toBe('gpt-4o');

    // response mapped to Anthropic shape
    expect(json.type).toBe('message');
    expect(json.model).toBe('gpt-4o');
    expect(json.content).toEqual([{ type: 'text', text: 'hi from upstream' }]);
    expect(json.usage).toEqual({ input_tokens: 3, output_tokens: 4 });
  });

  it('surfaces a 401 from the upstream as an Anthropic error', async () => {
    fetchMock.mockResolvedValue(new Response('bad key', { status: 401 }));
    const res = await call({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.type).toBe('error');
  });
});

describe('llm-proxy shim — streaming', () => {
  it('translates an OpenAI SSE stream into an Anthropic event stream', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        sseBody(
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    );

    const res = await call({ model: 'llama3', stream: true, messages: [{ role: 'user', content: 'hi' }] });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('event: message_start');
    expect(text).toContain('"text_delta"');
    expect(text).toContain('Hello'.slice(0, 3)); // 'Hel'
    expect(text).toContain('event: message_stop');
  });
});

describe('llm-proxy shim — count_tokens & validation', () => {
  it('estimates count_tokens without hitting the upstream', async () => {
    const res = await call({ model: 'm', messages: [{ role: 'user', content: 'hello world' }] }, ['v1', 'messages', 'count_tokens']);
    const json = await res.json();
    expect(typeof json.input_tokens).toBe('number');
    expect(json.input_tokens).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-http upstream target', async () => {
    const slug = ['prov-1', enc('file:///etc/passwd'), 'v1', 'messages'];
    const req = new Request('http://127.0.0.1:3100/api/llm-proxy/' + slug.join('/'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'm', messages: [] }),
    });
    const res = await POST(req, { params: Promise.resolve({ slug }) });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('404s an unrecognized shim path', async () => {
    const slug = ['prov-1'];
    const req = new Request('http://127.0.0.1:3100/api/llm-proxy/prov-1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'm', messages: [] }),
    });
    const res = await POST(req, { params: Promise.resolve({ slug }) });
    expect(res.status).toBe(404);
  });
});
