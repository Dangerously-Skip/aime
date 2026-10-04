/**
 * SDK model aliases → concrete Messages API model ids.
 *
 * The Agent SDK resolves `opus`/`sonnet`/`haiku` itself; the raw Messages API
 * does not accept an alias, so every in-process HTTP caller (the browser turn,
 * memory extraction) has to translate. The registry cannot answer: its
 * `driverModel` IS the alias, and its `id` is a registry-internal key
 * (`claude-opus`). Neither is an API model id.
 *
 * One map, shared, because the first copy lived inside the browser-turn route
 * and memory extraction then sent the bare alias — a 400 on every turn.
 */
const ALIAS_TO_MODEL_ID: Record<string, string> = {
  fable: 'claude-fable-5',
  opus: 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
};

/** An alias resolves; anything else is assumed to be a concrete id already. */
export function toApiModelId(model: string): string {
  return ALIAS_TO_MODEL_ID[model] ?? model;
}
