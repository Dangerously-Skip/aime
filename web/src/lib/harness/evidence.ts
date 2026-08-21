/**
 * A citation must point at something the run actually fetched.
 *
 * WHAT THIS CLOSES. The verifier already refuses a pass with no evidence — "a
 * pass with no evidence is a failure" — but the evidence itself is free text the
 * verifier wrote. Nothing checked that a cited URL was ever retrieved, so the
 * one control standing between a claim and the ledger could be satisfied by a
 * plausible-looking URL the run had never opened.
 *
 * That is not hypothetical. A run produced a confident table of camera market
 * values recalled from model weights — never searched for, wrong by three to
 * four times — and the ROI ranking computed from them was the whole task. A
 * verifier asked to check that work would have been shown citations of exactly
 * the same shape as real ones.
 *
 * DR-22 D-3 calls for exactly this: "Every claim must cite a URL and an element
 * the run actually observed, and the verifier checks those citations exist in
 * the ledger." This is the checking half, and it is the difference between the
 * prompt-level rule in `shared/factual-claims.ts` — which asks nicely — and
 * something that refuses.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not check that the page SAID what
 * the claim says it said; that needs re-reading the page and is a separate,
 * heavier thing. It checks retrieval, which is the cheap half and catches the
 * failure that actually happened: a URL invented to dress up a remembered
 * number.
 */

/**
 * Compare URLs the way a person would, not byte for byte.
 *
 * The verifier retypes a URL from memory of the tool result, so it arrives with
 * a different case of host, a trailing slash, a `#section`, or `utm_` noise. A
 * citation rejected for punctuation is a false alarm, and a gate that cries wolf
 * gets switched off — so normalisation is generous everywhere it can be without
 * letting a DIFFERENT page through.
 *
 * Path case is preserved: hosts are case-insensitive by spec, paths are not, and
 * plenty of sites serve different content from `/Item` and `/item`.
 */
export function normaliseUrl(raw: string): string | null {
  const text = raw.trim().replace(/[),.;'"]+$/, '');
  if (!text) return null;
  try {
    const u = new URL(text);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|ref$)/i.test(k)) u.searchParams.delete(k);
    }
    // `https://a.com` and `https://a.com/` are the same page.
    const path = u.pathname.replace(/\/+$/, '');
    const query = u.searchParams.toString();
    return `${u.protocol}//${u.hostname}${path}${query ? `?${query}` : ''}`;
  } catch {
    return null;
  }
}

/** Every http(s) URL mentioned in a blob of text. */
export function extractUrls(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'`\])}]+/gi)) {
    const n = normaliseUrl(m[0]);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * A record of what a run actually retrieved.
 *
 * Deliberately a plain set of normalised URLs rather than the tool results
 * themselves: this is a gate, not a cache, and holding page bodies here would
 * make it a second copy of the transcript that can disagree with the first.
 */
export class RetrievalLog {
  private readonly urls = new Set<string>();

  /** Record a URL a tool actually went and got. */
  record(raw: unknown): void {
    if (typeof raw !== 'string') return;
    const n = normaliseUrl(raw);
    if (n) this.urls.add(n);
  }

  /** Record every URL appearing in a tool's INPUT or its RESULT. */
  recordFrom(text: unknown): void {
    if (typeof text !== 'string') return;
    for (const u of extractUrls(text)) this.urls.add(u);
  }

  has(raw: string): boolean {
    const n = normaliseUrl(raw);
    return n !== null && this.urls.has(n);
  }

  get size(): number {
    return this.urls.size;
  }

  snapshot(): string[] {
    return [...this.urls];
  }
}

/**
 * Citations in `evidence` that the run never retrieved.
 *
 * Empty means every URL cited was fetched. Evidence with NO urls at all is not
 * an offence — plenty of real evidence is "ran ./check.sh, exit 0" — so this
 * only judges the URLs that are there.
 */
export function unretrievedCitations(evidence: string[], log: RetrievalLog): string[] {
  const bad: string[] = [];
  for (const line of evidence) {
    for (const url of extractUrls(line)) {
      if (!log.has(url) && !bad.includes(url)) bad.push(url);
    }
  }
  return bad;
}

/** The sentence handed back when a citation was never fetched. */
export function citationFailure(bad: string[]): string {
  const list = bad.map((u) => `"${u}"`).join(', ');
  return (
    `This pass cites ${bad.length === 1 ? 'a URL' : 'URLs'} the run never retrieved: ${list}. ` +
    `A citation has to point at something actually fetched during this run — a remembered or ` +
    `plausible-looking URL is not evidence. Fetch it and re-check, or drop the claim that rests on it.`
  );
}
