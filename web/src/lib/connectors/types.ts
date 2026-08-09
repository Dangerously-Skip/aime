export interface ConnectorDefinition {
  id: string;
  name: string;
  description: string;
  category: 'project-management' | 'communication' | 'development' | 'cloud' | 'design' | 'documentation';
  /** If true, shows a "Coming soon" badge and disables the Connect button */
  comingSoon?: boolean;

  // Auth config
  auth: {
    /**
     * `app-password` is a service reached with a username plus a
     * service-issued password, over its own protocols rather than OAuth —
     * iCloud, via IMAP and DAV. It lives in the connector catalogue because
     * that is where a user looks to connect their email; "it is not OAuth" is
     * an implementation detail they should not have to know.
     */
    type: 'oauth2' | 'api_key' | 'aws_iam' | 'mcp-oauth' | 'mcp-self-auth' | 'app-password';
    authUrl?: string;
    tokenUrl?: string;
    scopes?: string[];
    clientId?: string;
    pkce?: boolean;
    redirectScheme?: 'http' | 'https'; // Default: http. Slack requires https.
    /** Custom callback path for OAuth redirect. Default: /api/connectors/oauth/callback.
     * Microsoft's public-client apps (Graph PowerShell, Azure CLI) only accept
     * http://localhost/ (path "/"), so m365-graph overrides this. */
    redirectPath?: string;
    envVarName?: string; // For api_key type
    hint?: string;       // Instruction text shown in the Connect dialog
    /** For mcp-oauth type: the HTTP MCP server URL that supports DCR. */
    mcpUrl?: string;
    /**
     * Whether the MCP server supports Dynamic Client Registration (RFC 7591).
     * DCR is the fastest connect path — nobody pre-registers an OAuth app, the
     * server issues a client on demand — so knowing which servers lack it is
     * what lets the catalogue tell the user the truth before they click.
     * Omitted means "assume it works, fall back if it doesn't".
     */
    dcr?: 'supported' | 'unsupported';
    /** For mcp-oauth type: fallback env var to read client_id from if server doesn't support DCR. */
    fallbackClientIdEnv?: string;
    /** For mcp-oauth type: literal pre-registered client_id used when DCR is unavailable (e.g. Slack's public MCP client). */
    fallbackClientId?: string;
    /** For oauth2 type: user brings their own clientId + clientSecret via a setup dialog (no env var / pre-registered app). */
    byoCredentials?: boolean;
    /**
     * Extra query params for the authorization request, for provider quirks.
     * Google needs `access_type=offline` to issue a refresh_token at all, and
     * `prompt=consent` to reissue one on re-auth — without them the connection
     * dies when the access token expires (~1h) and cannot be refreshed.
     */
    extraAuthParams?: Record<string, string>;
  };

  // MCP server config
  /**
   * Optional, because not every connector is an MCP server.
   *
   * iCloud's tools run in-process on the `aime` server — there is no external
   * process or URL to describe, and nothing to provision into `.mcp.json`. The
   * two provisioning call sites read `mcp.tokenInjection` and are only reached
   * for connectors that HAVE one.
   */
  mcp?: {
    transport: 'stdio' | 'http';
    // For stdio:
    command?: string;
    args?: string[];
    // For http:
    url?: string;
    // How the auth token is injected
    tokenInjection:
      | { method: 'env'; envVar: string }
      | { method: 'header'; headerName: string; prefix?: string };
  };
}

export interface ConnectorState {
  id: string;
  enabled: boolean;
  authenticated: boolean;
  tokenStorageKey: string;
}
