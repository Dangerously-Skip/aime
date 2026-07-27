/**
 * Tell the agent what the user has connected, and what it can offer (P3.3).
 *
 * Until now the agent had no idea which services were available: the mounted MCP
 * set travelled outward to the client but was never described in the system
 * prompt. So when asked to "email Bob the summary" with no mail tool mounted, the
 * best it could do was apologise. It could not say "Gmail isn't connected — want
 * me to connect it?", because it did not know Gmail was connectable at all.
 *
 * This fragment closes that gap, and deliberately distinguishes:
 *   - connected      → just use the tools
 *   - one click      → offer immediately, it costs the user a moment
 *   - needs setup    → offer, but say it takes a few minutes
 *   - unavailable    → do NOT offer; say who can enable it
 *
 * That last distinction is the important one: offering to connect something that
 * cannot be connected in this install wastes the user's time and destroys trust
 * in every other offer.
 */
import type { ClassifiedConnector } from './connectability';

/** Server keys are prefixed per provisioning; this recovers the connector id. */
export function connectedIdsFromServerKeys(serverKeys: string[]): Set<string> {
  const ids = new Set<string>();
  for (const key of serverKeys) {
    const match = /^(?:aime|nib)-(?:connector|mcp)-(.+)$/.exec(key);
    if (match) ids.add(match[1]);
  }
  return ids;
}

const MAX_LISTED = 12;

function line(c: ClassifiedConnector): string {
  return `- ${c.name} (id: ${c.id}) — ${c.description}`;
}

/**
 * Build the fragment. Returns '' when there is nothing useful to say, so the
 * caller can append unconditionally without adding an empty heading.
 */
export function buildConnectorsPrompt(
  catalog: ClassifiedConnector[],
  connectedIds: Set<string>,
  opts: { canRequest: boolean } = { canRequest: true },
): string {
  if (catalog.length === 0) return '';

  const connected = catalog.filter((c) => connectedIds.has(c.id));
  const offerable = catalog.filter(
    (c) => !connectedIds.has(c.id) && c.available && !c.comingSoon,
  );
  const oneClick = offerable.filter((c) => c.effort === 'instant');
  const needsSetup = offerable.filter((c) => c.effort !== 'instant');
  const unavailable = catalog.filter(
    (c) => !connectedIds.has(c.id) && !c.available && !c.comingSoon,
  );

  const parts: string[] = ['## Connected services'];

  if (connected.length > 0) {
    parts.push(
      'Already connected — use their tools directly, do not ask the user to connect them again:',
      ...connected.map(line),
    );
  } else {
    parts.push('Nothing is connected yet.');
  }

  if (opts.canRequest && oneClick.length > 0) {
    parts.push(
      '',
      'Not connected, but one click away. If a task needs one of these, call the ' +
        '`RequestConnector` tool with its id and a short reason instead of ' +
        'apologising or suggesting a manual workaround — the user gets a Connect ' +
        'button and you continue the task once they accept:',
      ...oneClick.slice(0, MAX_LISTED).map(line),
    );
  }

  if (opts.canRequest && needsSetup.length > 0) {
    parts.push(
      '',
      'Connectable, but setup takes a few minutes (the user must create their own ' +
        'app credentials). Offer via `RequestConnector` only if the task genuinely ' +
        'needs it, and say it will take a moment:',
      ...needsSetup.slice(0, MAX_LISTED).map(line),
    );
  }

  if (unavailable.length > 0) {
    parts.push(
      '',
      'NOT available in this installation — never offer to connect these. If a task ' +
        'needs one, say plainly that it is not configured and who can enable it:',
      ...unavailable.slice(0, MAX_LISTED).map((c) => `- ${c.name} — ${c.detail}`),
    );
  }

  if (opts.canRequest) {
    parts.push(
      '',
      'Rules for `RequestConnector`: request at most one service per turn; only ' +
        'when the current task actually needs it; never for something already ' +
        'connected. If the user declines, complete as much of the task as you can ' +
        'without it and say what you could not do.',
    );
  }

  return parts.join('\n');
}
