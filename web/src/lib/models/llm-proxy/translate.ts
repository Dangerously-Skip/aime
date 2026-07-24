/**
 * Anthropic ↔ OpenAI request/response translation for the openai-compat shim
 * (DR-11). Pure functions — no I/O — so the tricky mapping is unit-testable.
 * The streaming translation lives in ./stream.
 */

// ── Anthropic Messages API (what the Agent SDK sends) ──────────────────────

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string | Array<{ type: string; text?: string }>;
      is_error?: boolean;
    };

export interface AnthropicMessagesRequest {
  model: string;
  max_tokens?: number;
  system?: string | Array<{ type: string; text?: string }>;
  messages: Array<{ role: 'user' | 'assistant'; content: string | AnthropicContentBlock[] }>;
  tools?: Array<{ name: string; description?: string; input_schema: Record<string, unknown> }>;
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
}

// ── OpenAI Chat Completions ────────────────────────────────────────────────

type OpenAITextPart = { type: 'text'; text: string };
type OpenAIImagePart = { type: 'image_url'; image_url: { url: string } };
export type OpenAIToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | Array<OpenAITextPart | OpenAIImagePart> }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  tools?: Array<{ type: 'function'; function: { name: string; description?: string; parameters: Record<string, unknown> } }>;
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
}

// ── System + tool-result flattening ────────────────────────────────────────

function systemToText(system: AnthropicMessagesRequest['system']): string | undefined {
  if (!system) return undefined;
  if (typeof system === 'string') return system;
  return system
    .map((b) => (typeof b.text === 'string' ? b.text : ''))
    .filter(Boolean)
    .join('\n\n') || undefined;
}

/** Anthropic tool_result content (string | blocks) → an OpenAI tool string. */
function toolResultToText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') return content;
  const text = content
    .map((b) => (typeof b.text === 'string' ? b.text : ''))
    .filter(Boolean)
    .join('\n');
  return text || JSON.stringify(content);
}

/**
 * Map Anthropic messages to OpenAI messages. The awkward part: Anthropic
 * carries tool results inside a *user* message, while OpenAI needs them as
 * distinct `tool`-role messages that reference the assistant's tool_call ids.
 */
function mapMessages(messages: AnthropicMessagesRequest['messages']): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      out.push({ role: msg.role, content: msg.content } as OpenAIMessage);
      continue;
    }

    if (msg.role === 'assistant') {
      let text = '';
      const toolCalls: OpenAIToolCall[] = [];
      for (const block of msg.content) {
        if (block.type === 'text') text += block.text;
        else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
          });
        }
      }
      const m: OpenAIMessage = { role: 'assistant', content: text || null };
      if (toolCalls.length) (m as { tool_calls?: OpenAIToolCall[] }).tool_calls = toolCalls;
      out.push(m);
      continue;
    }

    // user message: split tool_result blocks (→ tool messages) from text/image.
    const parts: Array<OpenAITextPart | OpenAIImagePart> = [];
    for (const block of msg.content) {
      if (block.type === 'tool_result') {
        out.push({ role: 'tool', tool_call_id: block.tool_use_id, content: toolResultToText(block.content) });
      } else if (block.type === 'text') {
        parts.push({ type: 'text', text: block.text });
      } else if (block.type === 'image') {
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
        });
      }
    }
    if (parts.length === 1 && parts[0].type === 'text') {
      out.push({ role: 'user', content: parts[0].text });
    } else if (parts.length) {
      out.push({ role: 'user', content: parts });
    }
  }

  return out;
}

function mapToolChoice(tc: AnthropicMessagesRequest['tool_choice']): OpenAIChatRequest['tool_choice'] {
  if (!tc) return undefined;
  if (tc.type === 'auto') return 'auto';
  if (tc.type === 'any') return 'required';
  if (tc.type === 'tool' && tc.name) return { type: 'function', function: { name: tc.name } };
  return undefined;
}

/**
 * Translate an Anthropic Messages request into an OpenAI Chat Completions
 * request. `model` is the upstream (OpenAI-side) model id to target.
 */
export function anthropicToOpenAI(req: AnthropicMessagesRequest, model: string): OpenAIChatRequest {
  const messages: OpenAIMessage[] = [];
  const sys = systemToText(req.system);
  if (sys) messages.push({ role: 'system', content: sys });
  messages.push(...mapMessages(req.messages));

  const out: OpenAIChatRequest = { model, messages };
  if (typeof req.max_tokens === 'number') out.max_tokens = req.max_tokens;
  if (typeof req.temperature === 'number') out.temperature = req.temperature;
  if (typeof req.top_p === 'number') out.top_p = req.top_p;
  if (req.stop_sequences?.length) out.stop = req.stop_sequences;
  if (req.stream) {
    out.stream = true;
    out.stream_options = { include_usage: true };
  }
  if (req.tools?.length) {
    out.tools = req.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
  }
  const tc = mapToolChoice(req.tool_choice);
  if (tc) out.tool_choice = tc;
  return out;
}

// ── Response translation (non-streaming) ───────────────────────────────────

export type AnthropicStopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';

/** OpenAI finish_reason → Anthropic stop_reason. */
export function mapFinishReason(reason: string | null | undefined): AnthropicStopReason {
  switch (reason) {
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'stop':
    default:
      return 'end_turn';
  }
}

interface OpenAIChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: OpenAIToolCall[] };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface AnthropicMessageResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
  >;
  stop_reason: AnthropicStopReason;
  stop_sequence: null;
  usage: { input_tokens: number; output_tokens: number };
}

/** Parse a tool call's `arguments` JSON, tolerating malformed/empty strings. */
export function parseToolArguments(raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Translate a non-streaming OpenAI response into an Anthropic message.
 * `anthropicModel` is echoed back as the message model (the SDK reads it).
 */
export function openAIToAnthropic(resp: OpenAIChatResponse, anthropicModel: string): AnthropicMessageResponse {
  const choice = resp.choices?.[0];
  const msg = choice?.message ?? {};
  const content: AnthropicMessageResponse['content'] = [];

  if (typeof msg.content === 'string' && msg.content.length) {
    content.push({ type: 'text', text: msg.content });
  }
  for (const tc of msg.tool_calls ?? []) {
    content.push({
      type: 'tool_use',
      id: tc.id,
      name: tc.function.name,
      input: parseToolArguments(tc.function.arguments),
    });
  }
  // Anthropic requires at least one block.
  if (content.length === 0) content.push({ type: 'text', text: '' });

  const hasToolCall = (msg.tool_calls?.length ?? 0) > 0;
  return {
    id: resp.id || 'msg_shim',
    type: 'message',
    role: 'assistant',
    model: anthropicModel,
    content,
    stop_reason: hasToolCall ? 'tool_use' : mapFinishReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: resp.usage?.prompt_tokens ?? 0,
      output_tokens: resp.usage?.completion_tokens ?? 0,
    },
  };
}
