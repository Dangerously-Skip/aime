import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateMcpServerUrl, deriveServerName } from './url-guard';
import { sanitizePluginName } from './install-guard';

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

describe('validateMcpServerUrl — properties', () => {
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

describe('deriveServerName', () => {
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
