/**
 * Reaching iCloud without an iCloud API.
 *
 * Apple publishes no API for user data — CloudKit Web Services only reaches your
 * own app's containers, and Sign in with Apple is authentication, not access.
 * What Apple DOES run is standards servers, and those are fully documented by
 * the standards rather than by Apple:
 *
 *   Mail      IMAP  imap.mail.me.com:993
 *   Calendar  CalDAV  caldav.icloud.com      (verified: 401 to an unauthenticated PROPFIND)
 *   Contacts  CardDAV contacts.icloud.com    (verified: 401 at /.well-known/carddav)
 *   Reminders CalDAV, as VTODO on the same server as Calendar
 *
 * Notes is deliberately absent: it moved to CloudKit around 2015 and is not on
 * IMAP for iCloud accounts. It is reachable locally through AppleScript instead,
 * which is a separate integration with a separate permission.
 *
 * ## Why this and not AppleScript
 *
 * AppleScript can read Mail too, and needs no extra credential. But it requires
 * Mail.app to be running on an awake Mac, which makes it unreliable for the
 * thing this app is FOR: standing orders, cron and automation run on a schedule,
 * often while nobody is at the machine. IMAP works headlessly, and on Windows
 * and Linux. That is the deciding difference, not protocol elegance.
 */

export const ICLOUD = {
  imap: { host: 'imap.mail.me.com', port: 993, secure: true },
  smtp: { host: 'smtp.mail.me.com', port: 587 },
  caldav: 'https://caldav.icloud.com',
  carddav: 'https://contacts.icloud.com',
} as const;

/**
 * Bounded like every other outbound call the agent can make. An IMAP connection
 * to an unreachable host otherwise sits until the per-tool deadline kills the
 * whole turn — the failure mode `fetch-url.ts` exists to document.
 */
export const ICLOUD_TIMEOUT_MS = 20_000;

export interface ICloudCredentials {
  /** The full Apple ID, e.g. someone@icloud.com. */
  appleId: string;
  /** An app-specific password from appleid.apple.com — never the account password. */
  appPassword: string;
}

export type CredentialProblem = 'missing' | 'not-an-email' | 'looks-like-account-password';

/**
 * Check a credential before using it, so the failure is explicable.
 *
 * The one worth catching is the third. App-specific passwords are issued in a
 * fixed `xxxx-xxxx-xxxx-xxxx` shape; anything else is almost certainly the user
 * typing their real Apple ID password, which will fail against a 2FA-protected
 * account with a bare "authentication failed" and no hint as to why. Told
 * plainly, it takes one minute to fix; discovered as an auth error, it reads as
 * "the integration is broken".
 *
 * It is a warning, not a rejection — Apple's format is not guaranteed forever,
 * and refusing a working credential because it fails our regex would be worse
 * than accepting one that fails theirs.
 */
export function inspectCredentials(c: Partial<ICloudCredentials>): CredentialProblem | null {
  if (!c.appleId?.trim() || !c.appPassword?.trim()) return 'missing';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.appleId.trim())) return 'not-an-email';
  if (!/^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$/i.test(c.appPassword.trim())) {
    return 'looks-like-account-password';
  }
  return null;
}

export function describeCredentialProblem(p: CredentialProblem): string {
  switch (p) {
    case 'missing':
      return 'Enter your Apple ID and an app-specific password.';
    case 'not-an-email':
      return 'That does not look like an Apple ID — it should be a full email address.';
    case 'looks-like-account-password':
      return (
        'That looks like your Apple ID password rather than an app-specific password. ' +
        'iCloud will reject it if two-factor authentication is on. Generate one at ' +
        'appleid.apple.com → Sign-In and Security → App-Specific Passwords; it looks like ' +
        'abcd-efgh-ijkl-mnop and can be revoked on its own.'
      );
  }
}

/** HTTP Basic, which is what both DAV endpoints expect. */
export function basicAuthHeader(c: ICloudCredentials): string {
  return `Basic ${Buffer.from(`${c.appleId}:${c.appPassword}`).toString('base64')}`;
}
