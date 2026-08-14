import { validateServiceUrl } from '@/lib/mcp/url-guard';
import {
  PublishError,
  checkAudience,
  type PublishInput,
  type PublishResult,
  type PublishTarget,
} from './types';

/**
 * Publish a deck to an S3-compatible bucket the user brings.
 *
 * ONE implementation covers Cloudflare R2, Amazon S3, Backblaze B2, Wasabi and
 * MinIO, because they all speak the same API — so this is one preset family and
 * four fields, not five integrations. R2 is the one worth recommending: no
 * egress fees, a generous free tier, and a token is three clicks.
 *
 * ## What this tier can and cannot promise
 *
 * `capabilities.people` is FALSE and that is the honest answer, not a gap to
 * fill later. A bucket serves bytes to whoever asks; restricting a deck to
 * named people needs something that checks identity at request time, which
 * means an identity provider in front of the bucket (Cloudflare Access, an
 * OIDC proxy). `checkAudience` therefore refuses a people-share here and points
 * at Drive, rather than handing back a long URL and calling it access control.
 *
 * What it CAN promise, and does:
 *   - an unguessable key, so the URL is the secret
 *   - revocation, by deleting the object
 *
 * Signing uses `@smithy/signature-v4`, already a dependency and already how
 * telemetry signs — a bucket upload does not justify the full AWS SDK.
 */

export interface S3Config {
  /** e.g. `https://<account>.r2.cloudflarestorage.com` */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** R2 wants `auto`; S3 wants the bucket's real region. */
  region?: string;
  /**
   * Where the object will be readable from, when that is not the endpoint —
   * an R2 custom domain or `*.r2.dev`. Without it the returned URL points at
   * the API endpoint, which is not publicly readable, and the user gets a link
   * that 403s for everyone including them.
   */
  publicBaseUrl?: string;
}

export interface S3Deps {
  config: S3Config;
  fetchImpl?: typeof fetch;
  /** Injected for tests; production uses `@smithy/signature-v4`. */
  signer?: (req: SignableRequest, cfg: S3Config) => Promise<Record<string, string>>;
  /** Injected so a key is deterministic under test. */
  randomKey?: () => string;
}

export interface SignableRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: string;
}

/**
 * 160 bits of randomness in the object key.
 *
 * The key IS the access control on this tier, so it has to be unguessable
 * rather than merely unique — a slug plus a timestamp is neither.
 */
function defaultKey(): string {
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function smithySign(req: SignableRequest, cfg: S3Config): Promise<Record<string, string>> {
  const { SignatureV4 } = await import('@smithy/signature-v4');
  const { Sha256 } = await import('@aws-crypto/sha256-js');
  const signer = new SignatureV4({
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    region: cfg.region || 'auto',
    service: 's3',
    sha256: Sha256,
  });
  const signed = await signer.sign({
    method: req.method,
    hostname: req.url.hostname,
    path: req.url.pathname,
    protocol: req.url.protocol,
    headers: { ...req.headers, host: req.url.host },
    body: req.body,
  });
  return signed.headers as Record<string, string>;
}

export function s3Target(deps: S3Deps): PublishTarget {
  const doFetch = deps.fetchImpl ?? fetch;
  const sign = deps.signer ?? smithySign;
  const newKey = deps.randomKey ?? defaultKey;
  const cfg = deps.config;

  const target: PublishTarget = {
    id: 's3',
    label: 'your storage bucket',
    // No identity model. Stated in the type, enforced by checkAudience.
    capabilities: { people: false, revoke: true },

    async publish(input: PublishInput): Promise<PublishResult> {
      checkAudience(target, input.audience);

      for (const [name, value] of [
        ['endpoint', cfg.endpoint],
        ['bucket', cfg.bucket],
        ['access key', cfg.accessKeyId],
        ['secret key', cfg.secretAccessKey],
      ] as const) {
        if (!value?.trim()) {
          throw new PublishError(`Storage is not configured — the ${name} is missing.`, 'not-connected');
        }
      }

      /*
       * The endpoint is user-supplied and fetched server-side, so it goes
       * through the same guard as the search instance URL: a LAN address is a
       * legitimate MinIO, link-local is cloud metadata and never a bucket.
       */
      const verdict = validateServiceUrl(cfg.endpoint);
      if (!verdict.ok) {
        throw new PublishError(`That storage endpoint cannot be used: ${verdict.message}`, 'upstream');
      }

      /*
       * `encodeURIComponent` per segment, not `encodeURI` over the whole path.
       *
       * `encodeURI` leaves `#` and `?` alone, so a deck called `Q3 review #2`
       * produced a URL whose `#2.share.html` parsed as a FRAGMENT: the signed
       * path — and the object actually written — was truncated at the `#`,
       * while the returned id and share link carried the full name. The link
       * 404'd and `revoke(id)` could not find the object. The `publicBaseUrl`
       * branch compounded it by interpolating the RAW key against an encoded
       * upload path, so the two disagreed for any name with a space.
       */
      const key = `${newKey()}/${input.fileName}`;
      const encodedKey = key.split('/').map(encodeURIComponent).join('/');
      const url = new URL(`/${encodeURIComponent(cfg.bucket)}/${encodedKey}`, verdict.url);

      let headers: Record<string, string>;
      try {
        headers = await sign(
          {
            method: 'PUT',
            url,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            body: input.html,
          },
          cfg,
        );
      } catch (e) {
        throw new PublishError(
          `Could not sign the upload: ${e instanceof Error ? e.message : 'unknown error'}`,
          'auth',
        );
      }

      let res: Response;
      try {
        res = await doFetch(url.toString(), { method: 'PUT', headers, body: input.html });
      } catch (e) {
        throw new PublishError(e instanceof Error ? e.message : 'Upload failed', 'network');
      }
      if (!res.ok) {
        throw new PublishError(
          `The bucket rejected the upload (HTTP ${res.status}). Check the bucket name, region and key permissions.`,
          res.status === 401 || res.status === 403 ? 'auth' : 'upstream',
        );
      }

      // The API endpoint is not the read endpoint on R2, so a link built from
      // it 403s for everyone — including the person who just published.
      const base = cfg.publicBaseUrl?.trim();
      const publicUrl = base
        // The encoded key, so the share link addresses the object that was
        // actually written rather than the name it was written from.
        ? `${base.replace(/\/+$/, '')}/${encodedKey}`
        : url.toString();

      return {
        id: key,
        url: publicUrl,
        effective: { kind: 'link' },
        summary: base
          ? 'Anyone with this link can open it. The link is the only secret — it is unguessable, but not restricted.'
          : 'Uploaded. No public base URL is configured, so this link only works for credentials that can read the bucket — set one in Settings to share it.',
      };
    },

    async revoke(key: string): Promise<void> {
      const verdict = validateServiceUrl(cfg.endpoint);
      if (!verdict.ok) throw new PublishError('That storage endpoint cannot be used.', 'upstream');
      const encodedKey = key.split('/').map(encodeURIComponent).join('/');
      const url = new URL(`/${encodeURIComponent(cfg.bucket)}/${encodedKey}`, verdict.url);
      const headers = await sign({ method: 'DELETE', url, headers: {} }, cfg);
      const res = await doFetch(url.toString(), { method: 'DELETE', headers });
      if (!res.ok && res.status !== 404) {
        throw new PublishError(`Could not remove the deck (HTTP ${res.status}).`, 'upstream');
      }
    },
  };

  return target;
}

/**
 * The buckets this speaks to, for the Settings picker.
 *
 * One family, because the API is the same; the differences are the endpoint
 * shape and whether a region matters. Ordered by how easy they are to set up.
 */
export const S3_PRESETS = [
  {
    id: 'r2',
    label: 'Cloudflare R2',
    endpointHint: 'https://<account-id>.r2.cloudflarestorage.com',
    region: 'auto',
    note: 'No egress fees and a generous free tier. Needs a public r2.dev URL or a custom domain to share links.',
  },
  {
    id: 's3',
    label: 'Amazon S3',
    endpointHint: 'https://s3.<region>.amazonaws.com',
    region: '',
    note: "Set the bucket's real region — S3 rejects a signature made for the wrong one.",
  },
  {
    id: 'b2',
    label: 'Backblaze B2',
    endpointHint: 'https://s3.<region>.backblazeb2.com',
    region: '',
    note: 'S3-compatible endpoint; use the S3 application key, not the native B2 one.',
  },
  {
    id: 'minio',
    label: 'MinIO / self-hosted',
    // A placeholder, not a literal address: `no-private-hosts.test.ts` forbids
    // RFC1918 in source, and it is right to — a hardcoded internal host shipped
    // in the search proxy once. A LAN address is still ACCEPTED at runtime.
    endpointHint: 'http://your-minio-host:9000',
    region: 'us-east-1',
    note: 'A LAN address is fine here. Link-local is refused — that is cloud metadata, never a bucket.',
  },
] as const;
