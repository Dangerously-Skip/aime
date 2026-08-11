/**
 * What counts as a private, local or otherwise not-public address.
 *
 * Extracted from `mcp/url-guard.ts`, which does two unrelated jobs — address
 * POLICY and server IDENTITY — and could therefore not be mutation-tested as
 * the security control it half is. Most of that file's mutants live in name
 * derivation, so a single score conflated "does the SSRF guard work" with "is
 * the slug logic exercised", and the answer to the first was hidden by the
 * second.
 *
 * These predicates are the whole of the first question, they are pure, and
 * `src/lib/security/**` is already in the mutation scope, so moving them here
 * puts them under the ratchet without dragging it down with unrelated code.
 *
 * ONE definition, deliberately. Both `validateFetchUrl` (a URL the MODEL chose)
 * and `validateServiceUrl` (a URL the USER typed) differ on POLICY and agree on
 * the facts; two copies of "what is link-local" is how the two drift apart.
 */

/** Strict dotted-quad only; rejects the octal/short forms that bypass naive checks. */
function parseIPv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    // A leading zero means an octal literal to some resolvers; refuse to guess.
    if (part.length > 1 && part.startsWith('0')) return null;
    const n = Number(part);
    if (n > 255) return null;
    nums.push(n);
  }
  return nums as [number, number, number, number];
}

/**
 * The IPv4 address an IPv6 literal actually reaches, or null.
 *
 * THE BYPASS THIS EXISTS FOR. `http://[::ffff:127.0.0.1]/` is a real, routable
 * way to say 127.0.0.1, and the WHATWG URL parser normalises it to
 * `[::ffff:7f00:1]` — which matched none of the string tests these checks used
 * to be, so loopback and `169.254.169.254` both passed every one. Verified end
 * to end: Node's fetch on `http://[::ffff:7f00:1]:PORT/` returns the body of a
 * server bound to 127.0.0.1. The two targets this module's header names as the
 * reason it exists were both reachable through it.
 *
 * Four shapes carry a v4 address and all four normalise differently, so this
 * parses rather than pattern-matches:
 *
 *   ::ffff:a.b.c.d   IPv4-mapped      → [::ffff:7f00:1]
 *   ::a.b.c.d        IPv4-compatible  → [::7f00:1]      (deprecated, still routed)
 *   64:ff9b::a.b.c.d NAT64            → [64:ff9b::a9fe:a9fe]
 *   ::               unspecified      → 0.0.0.0
 *
 * Returns the embedded address so ONE set of v4 rules covers both families; a
 * second copy of "what counts as private" is how the two drift apart.
 */
export function embeddedIPv4(groups: number[]): [number, number, number, number] | null {
  const asV4 = (hi: number, lo: number): [number, number, number, number] => [
    (hi >> 8) & 0xff,
    hi & 0xff,
    (lo >> 8) & 0xff,
    lo & 0xff,
  ];
  const zeroThrough = (n: number) => groups.slice(0, n).every((g) => g === 0);

  // ::ffff:0:0/96 — IPv4-mapped.
  if (zeroThrough(5) && groups[5] === 0xffff) return asV4(groups[6], groups[7]);
  // 64:ff9b::/96 — NAT64, a plain translation to the embedded v4.
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
    return asV4(groups[6], groups[7]);
  }
  // ::/96 — IPv4-compatible, and `::` itself, which means 0.0.0.0.
  if (zeroThrough(6)) return asV4(groups[6], groups[7]);
  return null;
}

/** The eight 16-bit groups of an IPv6 literal, or null if it is not one. */
export function parseIPv6(host: string): number[] | null {
  let h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h.includes(':')) return null;
  // A zone id (`fe80::1%eth0`) names an interface, not a different address.
  h = h.split('%')[0];

  // A trailing dotted quad is the v4-embedded form; fold it into two groups so
  // the rest of the parse is uniform.
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
  if (dotted) {
    const v4 = parseIPv4(dotted[1]);
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    h = h.slice(0, dotted.index) + `${hi}:${lo}`;
  }

  const halves = h.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const g of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  if (head === null || tail === null) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...Array(fill).fill(0), ...tail];
}

/**
 * The literal IP a host denotes, in v4 terms where one exists.
 *
 * `v6` is returned alongside so the v6-only ranges (link-local, unique-local)
 * can still be judged on the groups rather than on a string prefix.
 */
export function addressOf(host: string): {
  v4: [number, number, number, number] | null;
  v6: number[] | null;
} {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = parseIPv4(h);
  if (v4) return { v4, v6: null };
  const v6 = parseIPv6(h);
  return { v4: v6 ? embeddedIPv4(v6) : null, v6 };
}

/** 127.0.0.0/8, ::1, and the names that always mean this machine. */
export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  const { v4, v6 } = addressOf(h);
  if (v6 && v6.slice(0, 7).every((g) => g === 0) && v6[7] === 1) return true;
  return v4 !== null && v4[0] === 127;
}

/** 169.254.0.0/16 and fe80::/10 — cloud metadata and IPv6 link-local. */
export function isLinkLocalHost(host: string): boolean {
  const { v4, v6 } = addressOf(host);
  if (v4 && v4[0] === 169 && v4[1] === 254) return true;
  // fe80::/10 covers fe80 through febf.
  return v6 !== null && (v6[0] & 0xffc0) === 0xfe80;
}

/** RFC1918 plus IPv6 unique-local (fc00::/7). Loopback is handled separately. */
export function isPrivateHost(host: string): boolean {
  const { v4, v6 } = addressOf(host);
  if (v4) {
    const [a, b] = v4;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true; // 0.0.0.0/8 — "this network"
    // Carrier-grade NAT and the rest of the not-public space. Reached only via
    // the v6 path in practice, but the rule belongs with its family.
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 127) return true;
    return false;
  }
  // fc00::/7 — unique-local.
  return v6 !== null && (v6[0] & 0xfe00) === 0xfc00;
}


