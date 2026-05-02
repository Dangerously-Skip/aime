/**
 * Analytics client — sends events to the AWS analytics pipeline.
 * Uses SigV4 request signing if AWS credentials are available.
 * Falls back to unsigned requests for local dev.
 */

const ANALYTICS_API_URL = process.env.ANALYTICS_API_URL ?? '';
const ANALYTICS_AWS_REGION = process.env.ANALYTICS_AWS_REGION ?? 'ap-southeast-2';

export interface AnalyticsIdentity {
  app?: string;           // 'quarry' | 'claude-code'
  app_version?: string;
  user_email?: string;
  machine_id?: string;
  team_slug?: string;
  platform?: string;      // 'darwin' | 'win32' | 'linux'
  hostname?: string;
}

export interface AnalyticsEvent {
  schema_version: '1.0';
  event_type: string;
  timestamp: string;
  identity: AnalyticsIdentity;
  data: Record<string, unknown>;
}

// Throttle "ANALYTICS_API_URL not set" warning to once per process — the
// flush timer fires every 5 minutes and would otherwise spam the log.
let warnedMissingUrl = false;

/**
 * Send a batch of analytics events to the pipeline.
 * Returns true if the events were accepted by the server (2xx),
 * false otherwise. Caller should re-buffer on false.
 *
 * Telemetry must never break the main flow, so this never throws —
 * but unlike before, failures are logged and signalled to the caller
 * so events can be retried instead of silently dropped.
 */
export async function sendEvents(events: AnalyticsEvent[]): Promise<boolean> {
  if (events.length === 0) return true;
  if (!ANALYTICS_API_URL) {
    if (!warnedMissingUrl) {
      console.warn('[telemetry] ANALYTICS_API_URL is not set; events will be buffered locally and not delivered');
      warnedMissingUrl = true;
    }
    return false;
  }

  const ndjson = events.map((e) => JSON.stringify(e)).join('\n');
  let headers: Record<string, string> = { 'Content-Type': 'application/x-ndjson' };

  try {
    const { SignatureV4 } = await import('@smithy/signature-v4');
    const { fromNodeProviderChain } = await import('@aws-sdk/credential-providers');
    const { Sha256 } = await import('@aws-crypto/sha256-js');
    const url = new URL(`${ANALYTICS_API_URL}/v1/events`);

    const signer = new SignatureV4({
      credentials: fromNodeProviderChain(),
      region: ANALYTICS_AWS_REGION,
      service: 'execute-api',
      sha256: Sha256,
    });

    const signed = await signer.sign({
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname,
      protocol: url.protocol,
      headers: {
        'Content-Type': 'application/x-ndjson',
        host: url.hostname,
      },
      body: ndjson,
    });

    headers = signed.headers as Record<string, string>;
  } catch (err) {
    console.warn('[telemetry] SigV4 signing failed (sending unsigned, ingest will likely 403):', err instanceof Error ? err.message : err);
  }

  try {
    const res = await fetch(`${ANALYTICS_API_URL}/v1/events`, {
      method: 'POST',
      headers,
      body: ndjson,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[telemetry] ingest rejected ${events.length} event(s): ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[telemetry] failed to POST ${events.length} event(s):`, err instanceof Error ? err.message : err);
    return false;
  }
}

/** Build an identity object from available context. */
export function buildIdentity(overrides: Partial<AnalyticsIdentity> = {}): AnalyticsIdentity {
  return {
    app: 'quarry',
    app_version: process.env.npm_package_version ?? '1.0.0',
    ...overrides,
  };
}

/** Build a minimal AnalyticsEvent. */
export function buildEvent(
  eventType: string,
  data: Record<string, unknown>,
  identity: AnalyticsIdentity = {},
): AnalyticsEvent {
  return {
    schema_version: '1.0',
    event_type: eventType,
    timestamp: new Date().toISOString(),
    identity: buildIdentity(identity),
    data,
  };
}
