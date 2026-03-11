/**
 * SSE (Server-Sent Events) stream parser module.
 *
 * Provides an async iterator over parsed SSE events from a fetch Response.
 * Handles data line parsing, heartbeat filtering, partial line buffering,
 * TextDecoder streaming, and [DONE] detection.
 *
 * @module sse-parser
 */

/**
 * Creates an async iterator that yields parsed SSE events from a fetch Response.
 *
 * @param {Response|{getReader: Function}} response - A fetch Response object or
 *   any object with a `getReader()` method that returns a ReadableStreamDefaultReader.
 *   In the Electron preload bridge, `response` is an object with a custom `getReader()`
 *   that returns `{ read(): Promise<{done, value}> }` where `value` is already a string.
 * @returns {AsyncGenerator<SSEEvent>} An async generator yielding parsed SSE events.
 *
 * @typedef {Object} SSEEvent
 * @property {string} type - The event type (e.g., 'text', 'tool_use', 'tool_result', 'done', 'assistant').
 * @property {*} [content] - The event content (varies by type).
 * @property {string} [name] - Tool name (for tool_use events).
 * @property {Object} [input] - Tool input (for tool_use events).
 * @property {string} [id] - Tool or event ID.
 * @property {*} [result] - Tool result (for tool_result events).
 * @property {Object} [message] - Full message object (for assistant events).
 * @property {boolean} [isReasoning] - Whether this is reasoning/thinking content.
 * @property {string} raw - The raw JSON string before parsing.
 *
 * @example
 * const response = await window.electronAPI.sendMessage(text, chatId, provider, model);
 * for await (const event of createSSEReader(response)) {
 *   if (event.type === 'text') {
 *     console.log(event.content);
 *   } else if (event.type === 'done') {
 *     break;
 *   }
 * }
 */
export async function* createSSEReader(response) {
  const reader = await response.getReader();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Process any remaining buffered data before finishing
        if (buffer.trim()) {
          const events = parseBufferedLines(buffer);
          for (const event of events) {
            yield event;
          }
        }
        return;
      }

      // value may be a string (from Electron preload bridge) or Uint8Array
      const chunk = typeof value === 'string' ? value : new TextDecoder().decode(value, { stream: true });
      buffer += chunk;

      // Split on newlines, keeping the last (possibly incomplete) line in the buffer
      const lines = buffer.split('\n');
      buffer = lines[lines.length - 1];

      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i];

        // Skip SSE comments (heartbeats)
        if (line.startsWith(':')) {
          continue;
        }

        // Skip empty lines (SSE event separators)
        if (line.trim() === '') {
          continue;
        }

        // Parse data lines
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6);

          // Handle [DONE] sentinel
          if (jsonStr.trim() === '[DONE]') {
            yield { type: 'done', raw: jsonStr };
            return;
          }

          try {
            const data = JSON.parse(jsonStr);

            // Check for done event in parsed data
            if (data.type === 'done') {
              yield { ...data, raw: jsonStr };
              return;
            }

            yield { ...data, raw: jsonStr };
          } catch (parseError) {
            // Silently skip unparseable lines - matches existing behavior.
            // This handles partial JSON or malformed server output.
          }
        }
      }
    }
  } finally {
    // Ensure the reader is released if the consumer breaks early
    if (reader.cancel) {
      try {
        await reader.cancel();
      } catch (_) {
        // Ignore cancel errors (stream may already be closed)
      }
    }
  }
}

/**
 * Parse any remaining buffered lines that did not end with a newline.
 * This handles the edge case where the stream closes mid-line.
 *
 * @param {string} buffer - Remaining buffer content.
 * @returns {SSEEvent[]} Array of parsed events (may be empty).
 * @private
 */
function parseBufferedLines(buffer) {
  const events = [];
  const lines = buffer.split('\n');

  for (const line of lines) {
    if (line.startsWith(':') || line.trim() === '') {
      continue;
    }

    if (line.startsWith('data: ')) {
      const jsonStr = line.slice(6);

      if (jsonStr.trim() === '[DONE]') {
        events.push({ type: 'done', raw: jsonStr });
        break;
      }

      try {
        const data = JSON.parse(jsonStr);
        events.push({ ...data, raw: jsonStr });
      } catch (_) {
        // Skip unparseable remnants
      }
    }
  }

  return events;
}

/**
 * Creates a heartbeat monitor that tracks the last time data was received.
 * Useful for detecting stale connections.
 *
 * @param {Object} options
 * @param {number} [options.timeout=300000] - Timeout in ms before warning (default 5 minutes).
 * @param {number} [options.checkInterval=30000] - How often to check in ms (default 30 seconds).
 * @param {Function} [options.onTimeout] - Callback invoked when timeout is exceeded.
 * @returns {{ touch: Function, start: Function, stop: Function }}
 *
 * @example
 * const heartbeat = createHeartbeatMonitor({
 *   timeout: 300000,
 *   onTimeout: () => console.warn('Connection may be lost')
 * });
 * heartbeat.start();
 * // Call heartbeat.touch() each time data arrives
 * // Call heartbeat.stop() when stream ends
 */
export function createHeartbeatMonitor({ timeout = 300000, checkInterval = 30000, onTimeout } = {}) {
  let lastHeartbeat = Date.now();
  let intervalId = null;

  return {
    /** Record that data was received. */
    touch() {
      lastHeartbeat = Date.now();
    },

    /** Start the periodic check. */
    start() {
      this.touch();
      intervalId = setInterval(() => {
        const elapsed = Date.now() - lastHeartbeat;
        if (elapsed > timeout && typeof onTimeout === 'function') {
          onTimeout(elapsed);
        }
      }, checkInterval);
    },

    /** Stop the periodic check and clean up. */
    stop() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
  };
}
