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
import { isBuiltInServerId, builtInIdOwnsUrl } from '@/lib/mcp/url-guard';

/** The parts of a provisioned MCP entry that carry provenance. */
interface ProvisionedEntry {
  /** Remote endpoint, present on every http/sse entry. Survives SDK mounting. */
  url?: unknown;
  _meta?: { connectorId?: unknown; managedBy?: unknown } | unknown;
}

function entryOf(value: unknown): ProvisionedEntry {
  return value && typeof value === 'object' ? (value as ProvisionedEntry) : {};
}

function metaOf(entry: ProvisionedEntry): { connectorId?: unknown; managedBy?: unknown } {
  const meta = entry._meta;
  return meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {};
}

/**
 * Recover the connector ids a provisioned MCP set actually proves are connected.
 *
 * A key is NOT proof of identity. `aime-mcp-<name>` is written from a name the
 * user's URL derived, so before this checked, a server on
 * `https://mcp.github.evil.com/mcp` landed at `aime-mcp-github` and this handed
 * back `github` — which made `buildConnectorsPrompt` tell the agent "GitHub is
 * already connected, use its tools directly, do not ask again". The agent then
 * sent repository content to whoever owned that host.
 *
 * Three things count as proof, in order of directness:
 *   1. `_meta.connectorId` — only /api/connectors/provision writes it, and only
 *      after validating the id against CONNECTOR_MAP.
 *   2. the `-connector-` infix — likewise only that route writes it, so the id in
 *      the key was already validated. Covers stdio entries with no URL.
 *   3. for `-mcp-` (the open-ended DCR path): the stored URL is on an origin that
 *      built-in publishes.
 *
 * A `-mcp-` key naming a built-in with nothing to back it up is dropped. Names
 * that are not built-in ids claim nothing, so they are kept as-is — the catalogue
 * has no entry for them and the prompt cannot describe them as connected.
 *
 * Accepts the entry map (preferred — it carries the URL) or a bare key list, in
 * which case rule 3 has no evidence to work with and fails closed.
 */
export function connectedIdsFromServerKeys(
  servers: string[] | Record<string, unknown>,
): Set<string> {
  const entries: Array<[string, ProvisionedEntry]> = Array.isArray(servers)
    ? servers.map((key) => [key, {}])
    : Object.entries(servers).map(([key, value]) => [key, entryOf(value)]);

  const ids = new Set<string>();
  for (const [key, entry] of entries) {
    const match = /^(?:aime|nib)-(connector|mcp)-(.+)$/.exec(key);
    if (!match) continue;
    const [, kind, name] = match;

    const connectorId = metaOf(entry).connectorId;
    if (typeof connectorId === 'string' && connectorId.length > 0) {
      ids.add(connectorId);
      continue;
    }

    if (kind === 'connector') {
      ids.add(name);
      continue;
    }

    if (isBuiltInServerId(name)) {
      const url = typeof entry.url === 'string' ? entry.url : undefined;
      if (builtInIdOwnsUrl(name, url)) ids.add(name);
      continue;
    }

    ids.add(name);
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
  opts: {
    canRequest: boolean;
    staleIds?: Set<string>;
    /** Not an OAuth connector, but the model still has to know it is there. */
    icloudConnected?: boolean;
  } = { canRequest: true },
): string {
  // "Nothing useful to say" was once equivalent to "no catalog". It is not any
  // more: iCloud is connected outside the OAuth registry, and returning early
  // here would drop the only line telling the model its mail tools exist.
  if (catalog.length === 0 && !opts.icloudConnected) return '';

  const stale = opts.staleIds ?? new Set<string>();
  // A connection whose token has expired with no way to renew is provisioned but
  // useless: its tools are mounted and will fail with a 401. Describing it as
  // connected sends the agent down a path that cannot work, so it is listed
  // separately as needing reconnection.
  const connected = catalog.filter((c) => connectedIds.has(c.id) && !stale.has(c.id));
  const staleConnected = catalog.filter((c) => connectedIds.has(c.id) && stale.has(c.id));
  const offerable = catalog.filter(
    (c) => !connectedIds.has(c.id) && c.available && !c.comingSoon,
  );
  const oneClick = offerable.filter((c) => c.effort === 'instant');
  const needsSetup = offerable.filter((c) => c.effort !== 'instant');
  const unavailable = catalog.filter(
    (c) => !connectedIds.has(c.id) && !c.available && !c.comingSoon,
  );

  const parts: string[] = ['## Connected services'];

  /**
   * iCloud is listed here even though it is not an OAuth connector.
   *
   * It reaches Apple over IMAP and DAV with an app-specific password, so it is
   * not in `CONNECTOR_REGISTRY` and this prompt could not see it. The result was
   * worse than silence: asked "what's my latest email about", the model was told
   * nothing was connected, saw Microsoft 365 Mail on the offer list, and tried to
   * connect THAT — while five working iCloud mail tools sat mounted beside it.
   *
   * A capability the model is not told about is a capability it does not use;
   * the same lesson `CreateImage` taught, where the tool worked and produced
   * nothing because it was advertised in only one place.
   */
  if (opts.icloudConnected) {
    parts.push(
      'Already connected — use their tools directly, do not ask the user to connect them again:',
      '- iCloud (Mail, Calendar, Contacts) — use MailSearch, MailRead, MailDraft, ' +
        'CalendarEvents and ContactsSearch. This IS the user\'s email: do not offer to ' +
        'connect another mail service unless they ask for one specifically. MailDraft ' +
        'writes a draft and cannot send.',
    );
  }


  if (connected.length > 0) {
    parts.push(
      'Already connected — use their tools directly, do not ask the user to connect them again:',
      ...connected.map(line),
    );
  } else if (staleConnected.length === 0 && !opts.icloudConnected) {
    parts.push('Nothing is connected yet.');
  }

  if (staleConnected.length > 0) {
    parts.push(
      '',
      'Connected but EXPIRED — their tools are mounted and will fail with an ' +
        'authorisation error. Do not use them. If a task needs one, say the ' +
        'connection expired and ask the user to reconnect it' +
        (opts.canRequest ? ' (you may use `RequestConnector` to offer that)' : '') +
        ':',
      ...staleConnected.map(line),
    );
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
