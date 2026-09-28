import { artifactsFromMessages } from "@/lib/artifact-tracker";

type MessageLike = Parameters<typeof artifactsFromMessages>[0][number];

/**
 * Per message, keyed by identity. The store replaces only the message that
 * changed, so during a stream every other message hits the cache — the panel
 * used to rescan every tool call in the conversation on every token.
 */
const cache = new WeakMap<object, string[]>();

/** Same result as `artifactsFromMessages(messages)`, computed incrementally. */
export function artifactsOf(messages: readonly MessageLike[]): string[] {
  const found = new Set<string>();
  for (const m of messages) {
    if (!m.toolCalls?.length) continue;
    let paths = cache.get(m);
    if (!paths) {
      paths = artifactsFromMessages([m]);
      cache.set(m, paths);
    }
    for (const p of paths) found.add(p);
  }
  return [...found];
}
