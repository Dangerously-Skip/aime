/**
 * Analytics client — sends events to the AWS analytics pipeline.
 * Uses SigV4 request signing if AWS credentials are available.
 * Falls back to unsigned requests for local dev.
 */

const ANALYTICS_API_URL = process.env.ANALYTICS_API_URL ?? '';
const ANALYTICS_AWS_REGION = process.env.ANALYTICS_AWS_REGION ?? 'ap-southeast-2';

export interface AnalyticsIdentity {
  user_email?: string;
  machine_id?: string;
  team_slug?: string;
  app_version?: string;
}

export interface AnalyticsEvent {
  schema_version: '1.0';
  event_type: string;
  timestamp: string;
  identity: AnalyticsIdentity;
  data: Record<string, unknown>;
}

/**
 * Send a batch of analytics events to the pipeline.
 * Silently ignores errors — telemetry must never break the main flow.
 */
export async function sendEvents(events: AnalyticsEvent[]): Promise<void> {
  if (!ANALYTICS_API_URL || events.length === 0) return;

  const ndjson = events.map((e) => JSON.stringify(e)).join('\n');

  try {
    // Try SigV4 signing if AWS SDK packages are available
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
    } catch {
      // SigV4 deps not available or no credentials — send unsigned
    }

    await fetch(`${ANALYTICS_API_URL}/v1/events`, {
      method: 'POST',
      headers,
      body: ndjson,
    });
  } catch {
    // Never throw — telemetry is fire-and-forget
  }
}

/** Build an identity object from available context. */
export function buildIdentity(overrides: Partial<AnalyticsIdentity> = {}): AnalyticsIdentity {
  return {
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
