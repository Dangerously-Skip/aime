import { createDefaultRegistry, resolveRoute } from '../models/registry';
import { toApiModelId } from '../models/api-model-id';

/**
 * Which model memory extraction runs on.
 *
 * Extraction is a background summary of one turn — the CHEAP tier's job. It
 * used to run on the turn's own model, so every Opus turn paid for a second
 * Opus call, and on the built-in path it sent the bare SDK alias (`sonnet`) to
 * the raw Messages API, which rejects it.
 *
 * - Built-in path: the `chat` capability's cheap tier, resolved through the
 *   registry like every other built-in turn, then translated to an API id.
 *   Only Anthropic counts as available: the extractor is an Anthropic HTTP
 *   client and cannot sign Bedrock requests.
 * - A user-added provider: the turn's model. The user's tier grid lives in the
 *   renderer and the server cannot see which of that provider's models is
 *   "cheap"; the turn's model is the one model known to be served there.
 *
 * Returns null when nothing resolves, which the extractor treats as "skip".
 */
export function resolveExtractionModel(opts: {
  /** Set when the turn ran on a user-added provider. */
  onUserProvider: boolean;
  /** The model the turn ran on. */
  turnModel: string | null | undefined;
}): string | null {
  if (opts.onUserProvider) return opts.turnModel || null;
  const resolved = resolveRoute(createDefaultRegistry(), 'chat', 'cheap', (p) => p.id === 'anthropic', {
    allowTierDegrade: false,
  });
  return resolved ? toApiModelId(resolved.model.driverModel) : null;
}
