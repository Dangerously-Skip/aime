import { describe, it, expect } from 'vitest';
import { isCrossOriginRequest } from './same-origin';

/**
 * The app listens on localhost with no authentication — fine while "the caller
 * is the renderer" was true by construction, and untrue the moment the browser
 * surface loads a page that can POST to `http://localhost:3100/api/…`. A
 * `text/plain` POST is a simple request, so CORS never gets a say.
 */
const req = (headers: Record<string, string>) => ({
  headers: {
    get: (n: string) => headers[n.toLowerCase()] ?? null,
  },
});

describe('isCrossOriginRequest', () => {
  it.each([
    ['sec-fetch-site: cross-site', { 'sec-fetch-site': 'cross-site' }],
    ['sec-fetch-site: same-site (a sibling subdomain is still not us)', { 'sec-fetch-site': 'same-site' }],
    ['an Origin from another host', { origin: 'https://evil.example', host: 'localhost:3100' }],
    ['an Origin on another port', { origin: 'http://localhost:9999', host: 'localhost:3100' }],
    ['an Origin that will not parse', { origin: 'not a url', host: 'localhost:3100' }],
  ])('refuses %s', (_label, headers) => {
    expect(isCrossOriginRequest(req(headers))).toBe(true);
  });

  it.each([
    ['the renderer', { 'sec-fetch-site': 'same-origin', origin: 'http://localhost:3100', host: 'localhost:3100' }],
    ['a direct navigation', { 'sec-fetch-site': 'none' }],
    ['a matching Origin with no Sec-Fetch-Site', { origin: 'http://localhost:3100', host: 'localhost:3100' }],
    ['a differing SCHEME on the same host', { origin: 'https://localhost:3100', host: 'localhost:3100' }],
  ])('allows %s', (_label, headers) => {
    expect(isCrossOriginRequest(req(headers))).toBe(false);
  });

  /*
   * The deliberate hole, asserted so it is a decision rather than an oversight.
   * A non-browser caller sends neither header. Refusing it would break the
   * Electron main process and every test while adding nothing: a program that
   * can make a local HTTP request is not a confused deputy. The attack closed
   * here is "a web PAGE drives the API", and a page always sends one of the two.
   */
  it('allows a caller that sends neither header', () => {
    expect(isCrossOriginRequest(req({}))).toBe(false);
  });

  it('treats a null Origin as no evidence rather than as a match', () => {
    expect(isCrossOriginRequest(req({ origin: 'null', host: 'localhost:3100' }))).toBe(false);
  });
});
