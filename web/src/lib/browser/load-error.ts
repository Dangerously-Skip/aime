/**
 * What a failed page load means, from the `<webview>`'s `did-fail-load` event.
 *
 * A load that failed left the Browser surface a blank white rectangle: no
 * message, no URL, no way to retry. The event carries Chromium's net error code
 * (net/base/net_error_list.h); this turns it into something a person can act
 * on. Pure, so the mapping is testable without a webview.
 */

export type LoadErrorKind = 'dns' | 'offline' | 'tls' | 'refused' | 'timeout' | 'generic';

export interface LoadFailure {
  kind: LoadErrorKind;
  title: string;
  hint: string;
  code: number;
  description: string;
  url: string;
}

/** ERR_ABORTED: a redirect, a navigation superseding this one, or a download. Not a failure. */
export const ERR_ABORTED = -3;

const DNS = new Set([-105 /* NAME_NOT_RESOLVED */, -137 /* NAME_RESOLUTION_FAILED */]);
const OFFLINE = new Set([
  -106 /* INTERNET_DISCONNECTED */,
  -21 /* NETWORK_CHANGED */,
  -109 /* ADDRESS_UNREACHABLE */,
]);
const REFUSED = new Set([-102 /* CONNECTION_REFUSED */, -101 /* CONNECTION_RESET */, -100 /* CONNECTION_CLOSED */]);
const TIMEOUT = new Set([-7 /* TIMED_OUT */, -118 /* CONNECTION_TIMED_OUT */]);
const TLS = new Set([
  -107 /* SSL_PROTOCOL_ERROR */,
  -113 /* SSL_VERSION_OR_CIPHER_MISMATCH */,
  -117 /* BAD_SSL_CLIENT_AUTH_CERT */,
]);

/**
 * Should this `did-fail-load` be shown to the user?
 *
 * Only for the main frame (a failed ad iframe is not the page failing) and never
 * for ERR_ABORTED, which fires on ordinary redirects.
 */
export function isUserVisibleLoadFailure(e: { errorCode?: number; isMainFrame?: boolean }): boolean {
  if (e.isMainFrame === false) return false;
  return typeof e.errorCode === 'number' && e.errorCode !== ERR_ABORTED && e.errorCode < 0;
}

export function classifyLoadError(code: number, description: string, url: string): LoadFailure {
  const base = { code, description, url };
  if (DNS.has(code)) {
    return { ...base, kind: 'dns', title: 'This site can’t be found', hint: 'Check the address for typos. The domain may not exist, or DNS may be unreachable.' };
  }
  if (OFFLINE.has(code)) {
    return { ...base, kind: 'offline', title: 'You’re offline', hint: 'Check your internet connection, then try again.' };
  }
  // -200…-299 are certificate errors (CERT_COMMON_NAME_INVALID, CERT_DATE_INVALID, CERT_AUTHORITY_INVALID, …).
  if (TLS.has(code) || (code <= -200 && code >= -299)) {
    return { ...base, kind: 'tls', title: 'The connection isn’t secure', hint: 'The site’s security certificate could not be verified, so the page was not loaded.' };
  }
  if (REFUSED.has(code)) {
    return { ...base, kind: 'refused', title: 'The site refused to connect', hint: 'Nothing answered at this address. If it is a local server, check that it is running.' };
  }
  if (TIMEOUT.has(code)) {
    return { ...base, kind: 'timeout', title: 'The site took too long to respond', hint: 'The server may be busy or down. Try again in a moment.' };
  }
  return { ...base, kind: 'generic', title: 'This page couldn’t load', hint: 'Something went wrong loading the page.' };
}
