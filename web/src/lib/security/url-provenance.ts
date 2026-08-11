/**
 * A URL may only be fetched if it came from somewhere.
 *
 * ## The failure this replaces
 *
 * Asked to "search for the top pizza places in western Sydney" with no search
 * provider configured, the agent produced this:
 *
 *   "Let me try a few likely URLs from the main Sydney food publications. These
 *    are predictable patterns, so I'll check them in parallel. …None of those hit
 *    — let me try broader Sydney pizza lists from the same publishers. …Those
 *    didn't resolve either. Let me try a few more approaches."
 *
 * Six WebFetch calls, every URL invented, every one a 404, rendered in the UI as
 * ticked-off tool calls that look like research making progress.
 *
 * ## Why this is code and not prompt text
 *
 * It was prompt text first. The system prompt permitted DERIVING a URL "by a
 * rule you can state" (a repo from `owner/repo`, a docs root) and forbade
 * RECALLING one, and told the model to stop after a single failure. The model
 * decided a magazine listicle slug was a stateable rule, awarded itself the
 * permission, and then ignored the stop rule four times in one paragraph.
 *
 * That is not a wording problem to be fixed with better wording. A rule the
 * model interprets is a rule the model can interpret its way out of — this
 * codebase's own history is four security toggles that "looked enforced" for the
 * same reason. So provenance is now a refusal: `canUseTool` runs whatever
 * `permissionMode` says, and a URL with no source does not get fetched.
 *
 * Anthropic's own `web_fetch` server tool has the same restriction ("only
 * fetches URLs already present in the conversation"), which is a reasonable sign
 * this is the right shape rather than a local invention.
 *
 * ## What counts as a source
 *
 * Anything the model did not author: the user's messages, the conversation
 * history, and the results of earlier tool calls — which is how a search result
 * becomes fetchable. That last one is the point of the design: with search
 * configured the loop is search → results → fetch, and every fetch is anchored
 * to something real. Without search, the user pastes a link. Neither path
 * involves guessing.
 *
 * ## The deliberate cost
 *
 * Genuinely derivable URLs are now refused too — `https://github.com/foo/bar`
 * from a bare `foo/bar`, a docs root the model knows. That is a real loss and it
 * is accepted knowingly: those cases are recoverable in one turn by asking, and
 * permitting them is precisely the opening the model drove a truck through.
 */

/** Matches http(s) URLs in free text, stopping before trailing punctuation. */
const URL_RE = /https?:\/\/[^\s<>"'`\]}]+/gi;

/**
 * Compare on scheme + host + path, ignoring query and fragment.
 *
 * Query strings are dropped because a model re-fetching a search result often
 * adds or loses tracking parameters, and refusing over `?utm_source` would make
 * the guard feel broken for no safety gain. The PATH is compared strictly: it is
 * the part an invention gets wrong, and the whole attack was guessed paths on
 * hosts that genuinely exist.
 */
export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

/**
 * Drop the punctuation prose wraps around a URL, keeping what belongs to it.
 *
 * A closing paren is genuinely ambiguous — `(see https://x.com/a)` ends the
 * sentence, `…/wiki/Nice_(disambiguation)` is part of the address — so it is
 * decided by BALANCE rather than by excluding the character. Excluding it was
 * the previous approach and it truncated every Wikipedia-style URL at the first
 * `(`: the guard then recorded `…/Foo_(bar` and refused the real
 * `…/Foo_(bar)` the model went on to fetch, which reads as the fetch tool
 * randomly rejecting a link the search just returned.
 */
function trimProse(raw: string): string {
  let s = raw.replace(/[.,;:!?]+$/, '');
  const count = (c: string) => (s.split(c).length - 1);
  while (s.endsWith(')') && count(')') > count('(')) {
    s = s.slice(0, -1).replace(/[.,;:!?]+$/, '');
  }
  return s;
}

/** Every URL appearing in a blob of text, normalized and de-duplicated. */
export function extractUrls(text: string): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.match(URL_RE) ?? []) {
    const n = normalizeUrl(trimProse(m));
    if (n) out.add(n);
  }
  return [...out];
}

export interface ProvenanceVerdict {
  allowed: boolean;
  /** Shown to the model on refusal. Has to say what to do instead. */
  message?: string;
}

/**
 * Tracks which URLs the conversation has actually seen.
 *
 * Per-request: a URL surfaced in one turn should not license a fetch three
 * conversations later.
 */
export class UrlProvenance {
  private readonly seen = new Set<string>();

  constructor(seedTexts: Array<string | null | undefined> = []) {
    for (const t of seedTexts) this.record(t);
  }

  /** Add every URL in this text as fetchable. Call for tool results too. */
  record(text: string | null | undefined): void {
    if (!text) return;
    for (const u of extractUrls(text)) this.seen.add(u);
  }

  /** How many sources are known — used to tailor the refusal message. */
  get size(): number {
    return this.seen.size;
  }

  check(rawUrl: unknown): ProvenanceVerdict {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
      return { allowed: true }; // Not a URL fetch we can reason about; leave it.
    }
    const n = normalizeUrl(rawUrl);
    // Unparseable: not our business to adjudicate, and denying it would produce
    // a confusing refusal for something that was never going to work anyway.
    if (!n) return { allowed: true };
    if (this.seen.has(n)) return { allowed: true };

    return {
      allowed: false,
      message:
        `Refused: ${rawUrl} did not come from anywhere in this conversation. ` +
        `It was not in the user's message and no tool returned it, which means ` +
        `it was constructed from memory — and a constructed URL that happens to ` +
        `resolve is worse than one that 404s, because nothing marks it as a guess.\n\n` +
        (this.size === 0
          ? `No URLs have been seen in this conversation yet. Do not try variants ` +
            `and do not try a different publisher. If a web search tool is available, ` +
            `use it. If not, say plainly that you cannot look this up, answer from ` +
            `what you know while marking it unverified, and ask for a link.`
          : `Fetch one of the URLs that actually appeared (${this.size} so far), or ` +
            `search for what you need. Do not try variants of this address.`),
    };
  }
}

/**
 * Tool names whose `url` input this guard applies to.
 *
 * `FetchUrl` is our own bounded replacement for the built-in `WebFetch`, which
 * is now denied in the provider. Listing it is not housekeeping: this guard is
 * the whole defence against the model inventing a plausible-looking URL instead
 * of searching, and it keys on the TOOL NAME. Swapping the tool without adding
 * the new name would have left the guard installed, passing its own tests, and
 * protecting nothing — the exact shape of failure this codebase keeps finding.
 *
 * `WebFetch` stays listed. It is denied rather than removed from the SDK, and a
 * guard that only covers the tools currently reachable is one config change away
 * from being wrong.
 */
export function isUrlFetchTool(toolName: string): boolean {
  const base = toolName.split('__').pop() ?? toolName;
  return base === 'WebFetch' || base === 'web_fetch' || base === 'FetchUrl';
}
