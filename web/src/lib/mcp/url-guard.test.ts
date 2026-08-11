import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  validateMcpServerUrl,
  validateFetchUrl,
  validateServiceUrl,
  isNameTakenError,
  NAME_TAKEN_PHRASE,
  deriveServerName,
  hostSlugName,
  isBuiltInServerId,
  builtInIdOwnsUrl,
} from './url-guard';
import { sanitizePluginName } from './install-guard';
import { CONNECTOR_REGISTRY } from '@/lib/connectors/registry';
import { MCP_CATALOG } from '@/lib/mcp/catalog';

/**
 * This guard stands between a request body and a server-side fetch, so it gets
 * property tests as well as cases: the interesting inputs here are the ones I
 * would not think to hand-write.
 */

const ok = (u: string) => {
  const v = validateMcpServerUrl(u);
  if (!v.ok) throw new Error(`expected ${u} to pass, got ${v.reason}`);
  return v;
};
const reason = (u: unknown) => {
  const v = validateMcpServerUrl(u);
  return v.ok ? null : v.reason;
};

describe('validateMcpServerUrl — what should work', () => {
  it('accepts ordinary vendor https endpoints', () => {
    for (const u of [
      'https://mcp.atlassian.com/v1/mcp',
      'https://api.githubcopilot.com/mcp/',
      'https://mcp.example.co.uk:8443/sse',
      'https://mcp.example.com/path?x=1#f',
    ]) {
      expect(ok(u).loopback).toBe(false);
    }
  });

  it('accepts http to loopback — a local MCP server is a normal setup', () => {
    for (const u of [
      'http://localhost:3000/mcp',
      'http://127.0.0.1:8080/mcp',
      'http://[::1]:3000/mcp',
      'http://dev.localhost:3000/mcp',
    ]) {
      expect(ok(u).loopback, u).toBe(true);
    }
  });

  it('accepts https to loopback too', () => {
    expect(ok('https://localhost:3000/mcp').loopback).toBe(true);
  });
});

describe('validateMcpServerUrl — SSRF targets', () => {
  it('refuses cloud metadata / link-local', () => {
    // The highest-value SSRF target there is.
    expect(reason('http://169.254.169.254/latest/meta-data/')).toBe('link-local');
    expect(reason('https://169.254.169.254/')).toBe('link-local');
    expect(reason('http://[fe80::1]/mcp')).toBe('link-local');
  });

  it('refuses plaintext http to a LAN address', () => {
    for (const u of ['http://10.0.0.5/mcp', 'http://172.16.4.4/mcp', 'http://192.168.1.10/mcp', 'http://0.0.0.0/mcp']) {
      expect(reason(u), u).toBe('private-over-http');
    }
  });

  it('refuses plaintext http to a public host', () => {
    expect(reason('http://mcp.example.com/mcp')).toBe('insecure-scheme');
  });

  it('allows https to a LAN address — the certificate proves what answered', () => {
    expect(validateMcpServerUrl('https://192.168.1.10/mcp').ok).toBe(true);
  });

  it('judges obfuscated IPv4 forms by the address they really mean', () => {
    // WHATWG URL parsing normalises octal, hex, decimal and short forms before
    // we ever see the hostname, so the guard inspects the true address. Pinned
    // because the policy depends on it: were normalisation to change, these
    // would silently start bypassing the reserved-range checks.
    expect(new URL('http://0177.0.0.1/mcp').hostname).toBe('127.0.0.1');

    // …all of these ARE loopback, so plaintext to them is legitimately fine
    for (const u of ['http://0177.0.0.1/mcp', 'http://2130706433/mcp', 'http://0x7f.1/mcp', 'http://127.1/mcp']) {
      expect(ok(u).loopback, u).toBe(true);
    }

    // …whereas 010.0.0.1 is octal for 8.0.0.1, a PUBLIC address, and is refused
    expect(new URL('http://010.0.0.1/mcp').hostname).toBe('8.0.0.1');
    expect(reason('http://010.0.0.1/mcp')).toBe('insecure-scheme');
  });

  it('catches an obfuscated metadata address', () => {
    // 169.254.169.254 written in decimal
    expect(new URL('http://2852039166/x').hostname).toBe('169.254.169.254');
    expect(reason('http://2852039166/x')).toBe('link-local');
  });
});

describe('validateMcpServerUrl — malformed input', () => {
  it('refuses non-http schemes, including the git ones', () => {
    for (const u of ['ext::sh -c id', 'file:///etc/passwd', 'ftp://h/x', 'javascript:alert(1)', 'data:text/plain,x']) {
      expect(['unsupported-scheme', 'not-a-url'], u).toContain(reason(u));
    }
  });

  it('refuses embedded credentials, which would be written to disk', () => {
    expect(reason('https://user:pw@mcp.example.com/mcp')).toBe('credentials-in-url');
    expect(reason('https://user@mcp.example.com/mcp')).toBe('credentials-in-url');
  });

  it('refuses empty, whitespace and non-strings', () => {
    for (const u of ['', '   ', undefined, null, 42, {}, []]) {
      expect(reason(u), String(u)).toBe('not-a-url');
    }
  });

  it('refuses a relative URL', () => {
    expect(reason('/mcp')).toBe('not-a-url');
    expect(reason('mcp.example.com/mcp')).toBe('not-a-url');
  });

  it('trims surrounding whitespace rather than rejecting a pasted URL', () => {
    expect(ok('  https://mcp.example.com/mcp  ').url).toBe('https://mcp.example.com/mcp');
  });
});

/**
 * `fc.webUrl` generation dominates the runtime here — a thousand samples already
 * spends most of the 5s default, so a cold or loaded runner turns a passing
 * property into a red build. The timeout is raised rather than the sample count
 * lowered: these are the security properties, and a flaky suite is worse than a
 * slow one.
 */
describe('validateMcpServerUrl — properties', { timeout: 30_000 }, () => {
  it('never throws, for any input at all', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.constant(undefined), fc.constant(null), fc.integer(), fc.object()),
        (input) => {
          expect(() => validateMcpServerUrl(input)).not.toThrow();
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('an accepted URL is always http/https and never carries credentials', () => {
    fc.assert(
      fc.property(fc.webUrl({ withQueryParameters: true, withFragments: true }), (u) => {
        const v = validateMcpServerUrl(u);
        if (!v.ok) return;
        const parsed = new URL(v.url);
        expect(['http:', 'https:']).toContain(parsed.protocol);
        expect(parsed.username).toBe('');
        expect(parsed.password).toBe('');
        // plaintext is only ever allowed to this machine
        if (parsed.protocol === 'http:') expect(v.loopback).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it('no dotted-quad in a reserved range is ever accepted over http', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.constantFrom(10, 172, 192, 169, 127, 0),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: 1, max: 254 }),
        ),
        ([a, b, c, d]) => {
          const v = validateMcpServerUrl(`http://${a}.${b}.${c}.${d}/mcp`);
          if (!v.ok) return;
          // the only reserved range that may pass over http is loopback
          expect(a).toBe(127);
          expect(v.loopback).toBe(true);
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe('deriveServerName', { timeout: 30_000 }, () => {
  it('names a server after its organisation, not its service label', () => {
    expect(deriveServerName('https://mcp.atlassian.com/v1/mcp')).toBe('atlassian');
    expect(deriveServerName('https://api.githubcopilot.com/mcp/')).toBe('githubcopilot');
    expect(deriveServerName('https://mcp.acme.co.uk/mcp')).toBe('acme');
    expect(deriveServerName('https://www.example.com/mcp')).toBe('example');
  });

  it('handles a bare host and localhost', () => {
    expect(deriveServerName('https://acme.com/mcp')).toBe('acme');
    expect(deriveServerName('http://localhost:3000/mcp')).toBe('localhost');
  });

  it('always produces something the install allowlist accepts', () => {
    // The name becomes a directory, a clients-file key and an MCP entry key.
    for (const u of [
      'https://mcp.atlassian.com/v1/mcp',
      'https://api.githubcopilot.com/mcp/',
      'http://127.0.0.1:8080/mcp',
      'https://xn--80ak6aa92e.com/mcp',
    ]) {
      const name = deriveServerName(u);
      expect(name, u).toBeTruthy();
      expect(sanitizePluginName(name).ok, `${u} → ${name}`).toBe(true);
    }
  });

  it('returns null for something unparseable', () => {
    expect(deriveServerName('not a url')).toBeNull();
    expect(deriveServerName('')).toBeNull();
  });

  it('property: a derived name is always allowlist-safe or null', () => {
    fc.assert(
      fc.property(fc.webUrl(), (u) => {
        const name = deriveServerName(u);
        if (name === null) return;
        expect(sanitizePluginName(name).ok, `${u} → ${name}`).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});

/**
 * A derived name is not just a label: it becomes the config key
 * `aime-mcp-<name>`, and consumers map that key back to a built-in connector id
 * — the chat route's "already connected" prompt, and the Connectors page's green
 * toggle. So "first label that isn't mcp/api/www" was an identity claim that any
 * hostname could forge.
 */
describe('deriveServerName — a name is an identity claim, not a label', () => {
  const lookalikes: Array<[string, string]> = [
    ['https://mcp.github.evil.com/mcp', 'github'],
    ['https://api.slack.attacker.net/mcp', 'slack'],
    ['https://mcp.notion.com.evil.io/mcp', 'notion'],
    ['https://www.atlassian.badguy.dev/mcp', 'atlassian'],
  ];

  it.each(lookalikes)('%s must not be able to call itself %s', (url, claimed) => {
    const name = deriveServerName(url);
    expect(name, url).toBeTruthy();
    expect(name, url).not.toBe(claimed);
    // …and not any OTHER built-in id either
    const builtIn = new Set([
      ...CONNECTOR_REGISTRY.map((c) => c.id),
      ...MCP_CATALOG.map((s) => s.id),
    ]);
    expect(builtIn.has(name as string), `${url} → ${name}`).toBe(false);
    // still has to be usable as a directory and a config key
    expect(sanitizePluginName(name).ok, `${url} → ${name}`).toBe(true);
  });

  it('keeps the built-in name when the origin really is the built-in one', () => {
    // Adding the real vendor endpoint by URL must still land on the canonical id,
    // otherwise the same service shows up twice.
    expect(deriveServerName('https://mcp.atlassian.com/v1/mcp')).toBe('atlassian');
    expect(deriveServerName('https://mcp.figma.com/mcp')).toBe('figma');
    expect(deriveServerName('https://mcp.miro.com/')).toBe('miro');
    expect(deriveServerName('https://mcp.slack.com/mcp')).toBe('slack');
    // catalogue entries are identities too
    expect(deriveServerName('https://mcp.linear.app/mcp')).toBe('linear');
    expect(deriveServerName('https://mcp.notion.com/mcp')).toBe('notion');
    // a different path on the same origin is the same server
    expect(deriveServerName('https://mcp.atlassian.com/v2/sse')).toBe('atlassian');
  });

  it('leaves an ordinary third-party name alone', () => {
    expect(deriveServerName('https://mcp.acme.com/mcp')).toBe('acme');
    expect(deriveServerName('https://api.githubcopilot.com/mcp/')).toBe('githubcopilot');
    expect(deriveServerName('https://mcp.acme.co.uk/mcp')).toBe('acme');
  });
});

describe('hostSlugName — the disambiguator', { timeout: 30_000 }, () => {
  it('distinguishes vendors that share a label', () => {
    // These three all derive `acme`; the whole point is that they stay distinct.
    const names = ['https://mcp.acme.com/mcp', 'https://acme.io/mcp', 'https://api.acme.co.uk/mcp'].map(
      (u) => hostSlugName(u),
    );
    expect(new Set(names).size).toBe(3);
    expect(names).toEqual(['mcp-acme-com', 'acme-io', 'api-acme-co-uk']);
  });

  it('keeps a non-default port, because it is part of the origin', () => {
    expect(hostSlugName('https://mcp.acme.com:8443/mcp')).toBe('mcp-acme-com-8443');
    expect(hostSlugName('https://mcp.acme.com/mcp')).toBe('mcp-acme-com');
  });

  it('is always allowlist-safe or null', () => {
    fc.assert(
      fc.property(fc.webUrl(), (u) => {
        const name = hostSlugName(u);
        if (name === null) return;
        expect(sanitizePluginName(name).ok, `${u} → ${name}`).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('returns null for something unparseable', () => {
    expect(hostSlugName('not a url')).toBeNull();
  });
});

describe('built-in identity lookup', () => {
  it('knows every shipped connector and catalogue id', () => {
    for (const c of CONNECTOR_REGISTRY) expect(isBuiltInServerId(c.id), c.id).toBe(true);
    for (const s of MCP_CATALOG) expect(isBuiltInServerId(s.id), s.id).toBe(true);
    expect(isBuiltInServerId('acme')).toBe(false);
    expect(isBuiltInServerId('mcp-github-evil-com')).toBe(false);
  });

  it('matches only on origin, so a path or a query cannot change identity', () => {
    expect(builtInIdOwnsUrl('atlassian', 'https://mcp.atlassian.com/v1/mcp')).toBe(true);
    expect(builtInIdOwnsUrl('atlassian', 'https://mcp.atlassian.com/anything?x=1')).toBe(true);
    expect(builtInIdOwnsUrl('atlassian', 'https://mcp.atlassian.com.evil.io/v1/mcp')).toBe(false);
    expect(builtInIdOwnsUrl('github', 'https://api.githubcopilot.com/mcp/')).toBe(true);
    expect(builtInIdOwnsUrl('github', 'https://mcp.github.evil.com/mcp')).toBe(false);
    // a connector with no MCP endpoint of its own can never be proven this way
    expect(builtInIdOwnsUrl('buildkite', 'https://mcp.buildkite.com/mcp')).toBe(false);
    expect(builtInIdOwnsUrl('atlassian', undefined)).toBe(false);
  });

  it('tolerates the {placeholder} URLs Microsoft connectors declare', () => {
    // {tenant_id} sits in the path, so the origin is still literal.
    expect(
      builtInIdOwnsUrl(
        'outlook-mail',
        'https://agent365.svc.cloud.microsoft/agents/tenants/abc-123/servers/mcp_MailTools',
      ),
    ).toBe(true);
    expect(
      builtInIdOwnsUrl('outlook-mail', 'https://agent365.svc.cloud.microsoft.evil.io/x'),
    ).toBe(false);
  });
});

/**
 * The bypass: an IPv6 literal that carries an IPv4 address.
 *
 * `http://[::ffff:127.0.0.1]/` is a routable way to say 127.0.0.1, and the
 * WHATWG parser normalises it to `[::ffff:7f00:1]` — which matched none of the
 * string tests these checks used to be. Loopback and 169.254.169.254 both
 * passed, i.e. the two targets this module's header names as its reason for
 * existing. A reviewer confirmed it end to end: Node's fetch on the mapped form
 * returns the body of a server bound to 127.0.0.1.
 *
 * Every literal below is written the way a caller would type it; the assertions
 * run on whatever `new URL` turns it into, which is the form the guard sees.
 */
describe('IPv6 literals that reach a private address', () => {
  it.each([
    // IPv4-mapped — the verified bypass.
    ['http://[::ffff:127.0.0.1]/', 'loopback, mapped'],
    ['http://[::ffff:169.254.169.254]/', 'cloud metadata, mapped'],
    ['http://[::ffff:10.0.0.1]/', 'RFC1918, mapped'],
    ['http://[::ffff:192.168.1.1]/', 'RFC1918, mapped'],
    ['http://[0:0:0:0:0:ffff:7f00:1]/', 'loopback, mapped and unabbreviated'],
    // IPv4-compatible — deprecated, still routed.
    ['http://[::127.0.0.1]/', 'loopback, compatible'],
    ['http://[::169.254.169.254]/', 'metadata, compatible'],
    // NAT64 — a plain translation to the embedded v4.
    ['http://[64:ff9b::169.254.169.254]/', 'metadata via NAT64'],
    // The v6-native ranges.
    ['http://[::1]/', 'loopback'],
    ['http://[::]/', 'unspecified — 0.0.0.0'],
    ['http://[fe80::1]/', 'link-local'],
    ['http://[febf::1]/', 'link-local, top of the range'],
    ['http://[fd00::1]/', 'unique-local'],
    ['http://[fc00::1]/', 'unique-local, bottom of the range'],
    ['http://[fe80::1%25eth0]/', 'link-local with a zone id'],
  ])('refuses %s (%s)', (url) => {
    const v = validateFetchUrl(url);
    expect(v.ok, `${url} was allowed`).toBe(false);
  });

  /*
   * The complement. A guard that refuses real IPv6 hosts would push every
   * v6-only site onto "it is a private address", which is both wrong and
   * unfalsifiable from the message.
   */
  it.each([
    ['https://[2606:4700:4700::1111]/', 'Cloudflare DNS'],
    ['https://[2001:4860:4860::8888]/', 'Google DNS'],
    ['https://[2400:cb00::1]/', 'ordinary global unicast'],
  ])('still allows %s (%s)', (url) => {
    expect(validateFetchUrl(url).ok, `${url} was refused`).toBe(true);
  });

  /*
   * The v4 forms the WHATWG parser normalises for us. Asserted so that a future
   * change to the parse order cannot quietly reopen them — they are the classic
   * bypass list and it is not obvious from the code that URL handles them.
   */
  it.each([
    ['http://2130706433/', 'decimal 127.0.0.1'],
    ['http://0x7f000001/', 'hex 127.0.0.1'],
    ['http://0/', '0 — 0.0.0.0'],
    ['http://127.1/', 'short form'],
  ])('refuses %s (%s)', (url) => {
    expect(validateFetchUrl(url).ok, `${url} was allowed`).toBe(false);
  });
});

/**
 * `validateServiceUrl` — a URL for a service the USER chose to run.
 *
 * It exists because the two failure modes point in opposite directions. A
 * self-hosted SearXNG on `http://192.168.1.10:8080` is an ordinary setup, so
 * `validateFetchUrl`'s private-address rule (right for a URL the MODEL picked)
 * would break a real installation. Link-local is refused in both, being cloud
 * metadata and never a service.
 */
describe('validateServiceUrl', () => {
  it.each([
    'http://192.168.1.10:8080',
    'http://10.0.0.5:8080',
    'http://172.16.4.4:8888',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'https://searx.example.org',
    'https://searx.example.org/custom/path',
  ])('allows the self-hosted instance %s', (url) => {
    expect(validateServiceUrl(url).ok, `${url} was refused`).toBe(true);
  });

  it.each([
    ['http://169.254.169.254', 'link-local'],
    ['http://[fe80::1]', 'link-local'],
    ['http://[::ffff:169.254.169.254]', 'link-local'],
    ['http://[64:ff9b::169.254.169.254]', 'link-local'],
  ])('refuses %s (%s)', (url, reason) => {
    const v = validateServiceUrl(url);
    expect(v.ok, `${url} was allowed`).toBe(false);
    expect(v.ok === false && v.reason).toBe(reason);
  });

  it.each([
    ['file:///etc/passwd', 'unsupported-scheme'],
    ['ftp://example.com', 'unsupported-scheme'],
    ['http://user:pw@example.com', 'credentials-in-url'],
    ['not a url', 'not-a-url'],
    ['', 'not-a-url'],
    ['   ', 'not-a-url'],
  ])('refuses %s as %s', (url, reason) => {
    const v = validateServiceUrl(url);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toBe(reason);
  });

  it.each([null, undefined, 42, {}, []])('refuses the non-string %p', (bad) => {
    expect(validateServiceUrl(bad).ok).toBe(false);
  });

  it('reports loopback so a caller can treat it differently', () => {
    const local = validateServiceUrl('http://127.0.0.1:8080');
    expect(local.ok === true && local.loopback).toBe(true);
    const remote = validateServiceUrl('https://searx.example.org');
    expect(remote.ok === true && remote.loopback).toBe(false);
  });

  it('normalises the URL it returns', () => {
    const v = validateServiceUrl('  https://searx.example.org  ');
    expect(v.ok === true && v.url).toBe('https://searx.example.org/');
  });
});

/**
 * The "that name belongs to another origin" refusal crosses a boundary as a
 * plain Error message — that is all `runMcpOAuthFlow` preserves — so the phrase
 * and its recogniser have to agree. Two string literals that must match and
 * live in different files is precisely the pair that drifts.
 */
describe('isNameTakenError', () => {
  it('recognises a message built from the shared phrase', () => {
    expect(isNameTakenError(`github is ${NAME_TAKEN_PHRASE}.`)).toBe(true);
  });

  it('recognises it mid-sentence, since callers wrap it', () => {
    expect(isNameTakenError(`Setup failed: that name is ${NAME_TAKEN_PHRASE} — pick another.`)).toBe(true);
  });

  it.each([
    'Something else went wrong',
    'connected to a different server',
    '',
  ])('does not claim %p', (msg) => {
    expect(isNameTakenError(msg)).toBe(false);
  });
});

/**
 * `validateMcpServerUrl` and `validateFetchUrl` share the address predicates but
 * differ on policy — an MCP server on localhost is a supported setup, a URL the
 * MODEL picked is not. The IPv6 forms have to be refused on both paths, and
 * only one of them had tests.
 */
describe('validateMcpServerUrl and IPv6 literals', () => {
  it.each([
    'http://[::ffff:169.254.169.254]/mcp',
    'http://[fe80::1]/mcp',
    'http://[64:ff9b::169.254.169.254]/mcp',
  ])('refuses link-local %s', (url) => {
    const v = validateMcpServerUrl(url);
    expect(v.ok, `${url} was allowed`).toBe(false);
    expect(v.ok === false && v.reason).toBe('link-local');
  });

  it('treats an IPv6-mapped loopback as loopback, so plaintext http is allowed', () => {
    const v = validateMcpServerUrl('http://[::ffff:127.0.0.1]:3000/mcp');
    expect(v.ok).toBe(true);
    expect(v.ok === true && v.loopback).toBe(true);
  });

  it('refuses plaintext http to a mapped RFC1918 address', () => {
    const v = validateMcpServerUrl('http://[::ffff:192.168.1.10]:3000/mcp');
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.reason).toBe('private-over-http');
  });

  it('allows https to a v6 global unicast host', () => {
    expect(validateMcpServerUrl('https://[2606:4700::1111]/mcp').ok).toBe(true);
  });
});
