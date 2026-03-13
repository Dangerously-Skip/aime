import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createSSEStream } from '@/lib/sse';

export const runtime = 'nodejs';

const MODEL_MAP: Record<string, string> = {
  sonnet: 'claude-sonnet-4-20250514',
  opus: 'claude-opus-4-20250514',
  haiku: 'claude-haiku-4-5-20251001',
};

/**
 * Single-turn streaming endpoint for the browser agent.
 *
 * Unlike the main /api/chat/[surfaceId] which runs a full agentic loop server-side,
 * this returns after ONE model turn. When the response includes tool_use blocks,
 * the client executes them in the webview and calls again with the results.
 *
 * POST /api/chat/browser-turn
 * Body: { messages, model, tools, system }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    messages,
    model = 'sonnet',
    tools,
    system,
  } = body as {
    messages: Anthropic.MessageParam[];
    model?: string;
    tools?: Anthropic.Tool[];
    system?: string;
  };

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'messages array is required' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  const resolvedModel = MODEL_MAP[model] || model;
  const client = new Anthropic({ apiKey });
  const sse = createSSEStream();

  (async () => {
    const heartbeat = setInterval(() => sse.writeHeartbeat(), 15000);

    try {
      const streamParams: Anthropic.MessageCreateParams = {
        model: resolvedModel,
        max_tokens: 4096,
        messages,
        stream: true,
      };

      if (system) {
        streamParams.system = system;
      }
      if (tools && tools.length > 0) {
        streamParams.tools = tools;
      }

      const stream = client.messages.stream(streamParams);

      let currentToolUseId = '';
      let currentToolName = '';
      let toolInputJson = '';

      stream.on('text', (text) => {
        sse.writeEvent({ type: 'text', content: text });
      });

      stream.on('inputJson', (_delta, snapshot) => {
        toolInputJson = snapshot as string;
      });

      stream.on('contentBlock', (block) => {
        if (block.type === 'tool_use') {
          currentToolUseId = block.id;
          currentToolName = block.name;
          let parsedInput = {};
          try {
            parsedInput = JSON.parse(toolInputJson);
          } catch {
            // Input may have been accumulated differently
            parsedInput = block.input as Record<string, unknown>;
          }
          sse.writeEvent({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: parsedInput,
          });
          // Reset for next tool
          toolInputJson = '';
        }
      });

      const finalMessage = await stream.finalMessage();

      // Send stop reason so client knows whether to continue the loop
      await sse.writeEvent({
        type: 'turn_complete',
        stop_reason: finalMessage.stop_reason,
        usage: finalMessage.usage,
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[BROWSER-TURN] Error:', msg);
      await sse.writeEvent({ type: 'error', message: msg });
    } finally {
      clearInterval(heartbeat);
      await sse.close();
    }
  })();

  return sse.toResponse();
}
