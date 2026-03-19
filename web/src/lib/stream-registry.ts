/**
 * Module-level AbortController registry keyed by chatId.
 * Allows active SSE streams to survive surface switches, since
 * the registry lives outside of any React component lifecycle.
 */
const controllers = new Map<string, AbortController>();

export const streamRegistry = {
  set: (chatId: string, c: AbortController) => controllers.set(chatId, c),
  abort: (chatId: string) => {
    controllers.get(chatId)?.abort();
    controllers.delete(chatId);
  },
  clear: (chatId: string) => controllers.delete(chatId),
  has: (chatId: string) => controllers.has(chatId),
};
