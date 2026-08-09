/**
 * Trusted MCP entry construction (P3.1).
 *
 * `/api/connectors/provision` used to spread a caller-supplied `mcpEntry`
 * straight into the MCP config. Because the agent launches stdio MCP servers by
 * running `command` with `args`, any local POST could register
 * `{command:'sh', args:['-c','…']}` and get arbitrary code execution the next
 * time a surface loaded its MCP set. Nothing describing *what runs* may come
 * from the caller.
 *
 * So the server rebuilds the entry from the connector registry — a static
 * module — and takes only the token from the request. The caller chooses
 * *which* connector; never what it executes.
 *
 * `_meta` is different: refresh token, client id/secret and token endpoint are
 * genuine OAuth results the client has to hand back. They are inert data with
 * one exception — `tokenEndpoint` is a URL the server later POSTs the refresh
 * token to, so an attacker-controlled value is credential exfiltration. It is
 * pinned to the registry's own token host.
 *
 * Pure and synchronous: no fs, no fetch. The route does I/O; this decides.
 */
import { CONNECTOR_MAP } from './registry';
import type { ConnectorDefinition } from './types';

export interface TrustedMcpEntry {
  transport: 'stdio' | 'streamable-http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

/** OAuth results the client legitimately supplies. All optional. */
export interface ProvisionMeta {
  refreshToken?: string;
  expiresAt?: number;
  clientId?: string;
  clientSecret?: string;
  tokenEndpoint?: string;
}

export interface ProvisionRequest {
  connectorId?: unknown;
  token?: unknown;
  refreshToken?: unknown;
  expiresAt?: unknown;
  oauthClientId?: unknown;
  oauthClientSecret?: unknown;
  oauthTokenEndpoint?: unknown;
}

export type ProvisionDecision =
  | { ok: true; serverKey: string; connectorName: string; entry: TrustedMcpEntry; meta: ProvisionMeta }
  | { ok: false; error: string };

/** Longest plausible bearer/JWT. Keeps a hostile body from bloating the config. */
const MAX_SECRET_LEN = 8192;

/**
 * Reject control characters anywhere a value can reach a process environment or
 * an HTTP header — CR/LF in a header value is header injection, and NUL
 * truncates in C-level APIs. Written as a code-point scan rather than a regex
 * character class so the control bytes stay escaped in source.
 */
function isSafeSecret(value: string): boolean {
  if (value.length > MAX_SECRET_LEN) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

function optionalSecret(value: unknown, field: string): { value?: string; error?: string } {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'string') return { error: `${field} must be a string` };
  if (!isSafeSecret(value)) return { error: `${field} contains invalid characters` };
  return { value };
}

/**
 * The origin the registry says this connector's tokens come from. Refresh
 * requests may only go here — otherwise a crafted `tokenEndpoint` turns our own
 * refresh loop into an exfiltration channel for the refresh token.
 */
function expectedTokenOrigin(connector: ConnectorDefinition): string | null {
  const url = connector.auth.tokenUrl;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function validateTokenEndpoint(
  raw: string,
  connector: ConnectorDefinition,
): { value?: string; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { error: 'oauthTokenEndpoint is not a valid URL' };
  }
  if (parsed.protocol !== 'https:') {
    return { error: 'oauthTokenEndpoint must be https' };
  }
  const expected = expectedTokenOrigin(connector);
  // Registry connectors are pinned to their own token host. Connectors with no
  // declared tokenUrl (mcp-oauth, where the endpoint is discovered per RFC 8414)
  // are provisioned through the MCP OAuth route, not this one — so a token
  // endpoint arriving here for one of those is unexpected and refused.
  if (!expected) {
    return { error: `${connector.id} has no registered token endpoint` };
  }
  if (parsed.origin !== expected) {
    return { error: `oauthTokenEndpoint must be on ${expected}` };
  }
  return { value: parsed.toString() };
}

/**
 * Substitute `{appDir}` in registry args. The value comes from the server
 * (cwd or Electron's resourcesPath), never the request.
 */
export function substituteAppDir(args: string[] | undefined, appDir: string): string[] | undefined {
  if (!args) return args;
  return args.map((a) => a.replace(/\{appDir\}/g, appDir));
}

/**
 * Build the MCP entry for a connector from the registry definition. The token
 * is the only caller-supplied value that lands in the entry.
 */
export function buildTrustedMcpEntry(
  connector: ConnectorDefinition,
  token: string,
  appDir: string,
): TrustedMcpEntry {
  const { mcp } = connector;
  if (!mcp) {
    // Only MCP-backed connectors are ever provisioned into `.mcp.json`. Reaching
    // here with, say, iCloud — whose tools run in-process — is a caller bug, and
    // a loud one beats writing a malformed entry that fails at load time.
    throw new Error(`${connector.id} has no MCP server to provision`);
  }

  if (mcp.transport === 'stdio') {
    const entry: TrustedMcpEntry = {
      transport: 'stdio',
      command: mcp.command,
      args: substituteAppDir(mcp.args, appDir),
    };
    // aws_iam connectors inject nothing — the server inherits credentials from
    // the environment (~/.aws/credentials, AWS_PROFILE).
    if (mcp.tokenInjection.method === 'env' && token) {
      entry.env = { [mcp.tokenInjection.envVar]: token };
    }
    return entry;
  }

  const entry: TrustedMcpEntry = { transport: 'streamable-http', url: mcp.url };
  if (mcp.tokenInjection.method === 'header') {
    const prefix = mcp.tokenInjection.prefix || '';
    entry.headers = { [mcp.tokenInjection.headerName]: `${prefix}${token}` };
  }
  return entry;
}

/**
 * Validate a provision request and produce the entry to write. Fails closed:
 * an unknown connector, a malformed token or an off-origin token endpoint is
 * refused rather than sanitised into something that still writes.
 */
export function decideProvision(
  body: ProvisionRequest,
  opts: { appDir: string; registry?: Record<string, ConnectorDefinition> },
): ProvisionDecision {
  const registry = opts.registry ?? CONNECTOR_MAP;

  if (typeof body.connectorId !== 'string' || !body.connectorId) {
    return { ok: false, error: 'Missing connectorId' };
  }
  // An exact registry hit is the whole allowlist — the id can only ever be one
  // of our own hardcoded slugs, so the derived server key is safe by
  // construction and no transport detail is caller-influenced. hasOwnProperty
  // keeps inherited names like `constructor` from resolving to a "connector".
  const connector = Object.prototype.hasOwnProperty.call(registry, body.connectorId)
    ? registry[body.connectorId]
    : undefined;
  if (!connector) {
    return { ok: false, error: 'Unknown connector' };
  }
  /**
   * A connector with no MCP server cannot be provisioned into `.mcp.json`.
   *
   * iCloud is the case: its tools run in-process on the `aime` server, reached
   * over IMAP and DAV, so there is no command or URL to write. Refusing here
   * rather than further down means the caller gets a reason instead of a throw,
   * and no half-formed entry can reach the config.
   */
  if (!connector.mcp) {
    return { ok: false, error: `${connector.name} has no MCP server to provision` };
  }

  // Empty is legitimate (aws_iam, and stdio servers reading their own env).
  const token = body.token === undefined || body.token === null ? '' : body.token;
  if (typeof token !== 'string') {
    return { ok: false, error: 'token must be a string' };
  }
  if (token && !isSafeSecret(token)) {
    return { ok: false, error: 'token contains invalid characters' };
  }

  const meta: ProvisionMeta = {};

  for (const [field, key] of [
    ['refreshToken', 'refreshToken'],
    ['oauthClientId', 'clientId'],
    ['oauthClientSecret', 'clientSecret'],
  ] as const) {
    const { value, error } = optionalSecret(body[field], field);
    if (error) return { ok: false, error };
    if (value !== undefined) meta[key] = value;
  }

  if (body.expiresAt !== undefined && body.expiresAt !== null) {
    if (typeof body.expiresAt !== 'number' || !Number.isFinite(body.expiresAt)) {
      return { ok: false, error: 'expiresAt must be a number' };
    }
    meta.expiresAt = body.expiresAt;
  }

  const rawEndpoint = body.oauthTokenEndpoint;
  if (rawEndpoint !== undefined && rawEndpoint !== null && rawEndpoint !== '') {
    if (typeof rawEndpoint !== 'string') {
      return { ok: false, error: 'oauthTokenEndpoint must be a string' };
    }
    const { value, error } = validateTokenEndpoint(rawEndpoint, connector);
    if (error) return { ok: false, error };
    meta.tokenEndpoint = value;
  }

  return {
    ok: true,
    serverKey: `aime-connector-${connector.id}`,
    connectorName: connector.name,
    entry: buildTrustedMcpEntry(connector, token, opts.appDir),
    meta,
  };
}
