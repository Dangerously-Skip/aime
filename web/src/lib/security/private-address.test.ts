import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isLoopbackHost, isLinkLocalHost, isPrivateHost, addressOf, parseIPv6 } from './private-address';

/**
 * The address facts, tested directly rather than only through the two callers
 * that apply policy to them.
 *
 * They lived inside `mcp/url-guard.ts` and were only ever exercised via
 * `validateFetchUrl`, which is how an IPv4-mapped IPv6 literal walked through
 * every one of them: the tests asked "is this URL refused", and every URL they
 * asked about was a dotted quad.
 *
 * Hosts are written here the way `new URL().hostname` yields them — brackets
 * included — because that is what the callers pass.
 */
describe('isLoopbackHost', () => {
  it.each([
    'localhost', 'app.localhost', '127.0.0.1', '127.1.2.3',
    '[::1]', '::1', '[0:0:0:0:0:0:0:1]',
    '[::ffff:7f00:1]', '[::7f00:1]',
  ])('%s is loopback', (h) => expect(isLoopbackHost(h)).toBe(true));

  it.each(['example.com', '8.8.8.8', 'notlocalhost', 'localhost.evil.com', '[2606:4700::1111]'])(
    '%s is not loopback',
    (h) => expect(isLoopbackHost(h)).toBe(false),
  );
});

describe('isLinkLocalHost', () => {
  it.each([
    '169.254.169.254', '169.254.0.1',
    '[fe80::1]', '[fe90::1]', '[fea0::1]', '[febf::1]',
    '[::ffff:a9fe:a9fe]', '[64:ff9b::a9fe:a9fe]',
  ])('%s is link-local', (h) => expect(isLinkLocalHost(h)).toBe(true));

  it.each(['169.253.1.1', '170.254.1.1', '[fec0::1]', '[ff80::1]', '8.8.8.8'])(
    '%s is not link-local',
    (h) => expect(isLinkLocalHost(h)).toBe(false),
  );
});

describe('isPrivateHost', () => {
  it.each([
    '10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.1', '0.0.0.0',
    '100.64.0.1', '[fc00::1]', '[fd00::1]', '[fdff::1]',
    '[::ffff:a00:1]', '[::]',
  ])('%s is private', (h) => expect(isPrivateHost(h)).toBe(true));

  it.each(['8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.1.1', '99.64.0.1', '[2606:4700::1111]', '[fe00::1]'])(
    '%s is not private',
    (h) => expect(isPrivateHost(h)).toBe(false),
  );
});

describe('parseIPv6', () => {
  it('expands :: to the right number of groups', () => {
    expect(parseIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('fe80::1')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('2606:4700:4700::1111')).toEqual([0x2606, 0x4700, 0x4700, 0, 0, 0, 0, 0x1111]);
  });

  it('folds a trailing dotted quad into two groups', () => {
    expect(parseIPv6('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
  });

  it('ignores a zone id, which names an interface rather than an address', () => {
    expect(parseIPv6('fe80::1%eth0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
  });

  it.each(['not-an-address', '1.2.3.4', '', 'fe80::1::2', 'fe80:::1', '12345::1', 'ge80::1'])(
    'refuses %p',
    (h) => expect(parseIPv6(h)).toBeNull(),
  );

  it('requires exactly eight groups when there is no ::', () => {
    expect(parseIPv6('1:2:3:4:5:6:7:8')).toHaveLength(8);
    expect(parseIPv6('1:2:3:4:5:6:7')).toBeNull();
    expect(parseIPv6('1:2:3:4:5:6:7:8:9')).toBeNull();
  });
});

describe('addressOf', () => {
  it('reports the v4 address an IPv6 literal really reaches', () => {
    expect(addressOf('[::ffff:7f00:1]').v4).toEqual([127, 0, 0, 1]);
    expect(addressOf('[64:ff9b::a9fe:a9fe]').v4).toEqual([169, 254, 169, 254]);
    expect(addressOf('[::7f00:1]').v4).toEqual([127, 0, 0, 1]);
  });

  it('reports no embedded v4 for an ordinary global-unicast address', () => {
    expect(addressOf('[2606:4700::1111]').v4).toBeNull();
  });

  it('is not confused by a hostname', () => {
    expect(addressOf('example.com')).toEqual({ v4: null, v6: null });
  });
});

/**
 * The property that matters: whatever the notation, an address in a reserved
 * range must be judged on the address. Hand-written cases cover the forms I
 * thought of; this covers the ones I did not.
 */
describe('properties', { timeout: 30_000 }, () => {
  const RESERVED: Array<[number, number]> = [[10, 0], [127, 0], [169, 254], [192, 168], [172, 16]];

  it('a reserved v4 is reserved however it is spelled in IPv6', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...RESERVED),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 1, max: 254 }),
        ([a, b], c, d) => {
          const dotted = `${a}.${b}.${c}.${d}`;
          const plain = isLoopbackHost(dotted) || isLinkLocalHost(dotted) || isPrivateHost(dotted);
          expect(plain, `${dotted} is not reserved`).toBe(true);
          // The same address, written three other legal ways.
          for (const h of [`[::ffff:${dotted}]`, `[::${dotted}]`, `[64:ff9b::${dotted}]`]) {
            const judged = isLoopbackHost(h) || isLinkLocalHost(h) || isPrivateHost(h);
            expect(judged, `${h} escaped every check`).toBe(true);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it('never throws, for any string at all', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(() => [isLoopbackHost(s), isLinkLocalHost(s), isPrivateHost(s)]).not.toThrow();
      }),
      { numRuns: 1000 },
    );
  });
});
