import type { ScannedModel } from './providers';

/** The shape this needs off a stored provider; narrower than the store's. */
export interface DedupableProvider {
  id: string;
  presetId: string;
  models?: ScannedModel[];
  hasCredentials?: boolean;
  createdAt?: number;
  enabled?: boolean;
}

/**
 * Collapse repeated rows for the same provider preset.
 *
 * WHY THIS EXISTS. `providerIdForPreset` mints a uuid for a non-singleton
 * preset and reuses the existing id when the preset is already configured — so
 * re-entering an OpenRouter key updates one row. That reuse was ADDED; before
 * it, every save minted a fresh uuid, and re-entering a key (after a typo, a
 * rotation, or just to check it) appended another row. One install accumulated
 * thirteen OpenRouter entries, each with its own credential in the keychain.
 *
 * Fixing the mint stopped new duplicates and did nothing about existing ones,
 * which is why this is separate: it is a DATA repair, and the data predates the
 * fix.
 *
 * ## Which row wins
 *
 * The id is the credential's key, so picking the wrong row silently drops the
 * user's API key. In order:
 *
 *   1. a row with credentials beats one without — the others' keys may have
 *      been swept as orphans, and a row whose key is gone is dead weight;
 *   2. then the NEWEST, since a re-entered key is the one the user meant;
 *   3. then the first seen, so the result is stable rather than
 *      implementation-defined.
 *
 * Models are unioned across the collapsed rows: each row was scanned
 * separately, and a model the user enabled on one of them is a choice they made
 * once and should not have to make again.
 *
 * SINGLETON presets (`anthropic`) already use the preset id as the provider id,
 * so they cannot duplicate this way — but they are run through the same rule
 * rather than special-cased, because a payload written before THAT fix can
 * still hold two of them.
 */
export function dedupeProviders<T extends DedupableProvider>(providers: readonly T[]): T[] {
  if (!Array.isArray(providers)) return [];

  const byPreset = new Map<string, T[]>();
  const order: string[] = [];
  for (const p of providers) {
    if (!p || typeof p.presetId !== 'string' || typeof p.id !== 'string') continue;
    if (!byPreset.has(p.presetId)) {
      byPreset.set(p.presetId, []);
      order.push(p.presetId);
    }
    byPreset.get(p.presetId)!.push(p);
  }

  return order.map((presetId) => {
    const rows = byPreset.get(presetId)!;
    if (rows.length === 1) return rows[0];

    const winner = rows.reduce((best, row) => {
      const bestHasKey = best.hasCredentials === true;
      const rowHasKey = row.hasCredentials === true;
      if (rowHasKey !== bestHasKey) return rowHasKey ? row : best;
      return (row.createdAt ?? 0) > (best.createdAt ?? 0) ? row : best;
    }, rows[0]);

    // Union the scanned models, keeping each model's first-seen definition.
    const models: ScannedModel[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      for (const m of row.models ?? []) {
        if (!m || typeof m.id !== 'string' || seen.has(m.id)) continue;
        seen.add(m.id);
        models.push(m);
      }
    }

    return { ...winner, models };
  });
}

/** How many rows `dedupeProviders` would remove — for logging a repair once. */
export function duplicateProviderCount(providers: readonly DedupableProvider[]): number {
  if (!Array.isArray(providers)) return 0;
  return providers.length - dedupeProviders(providers).length;
}
