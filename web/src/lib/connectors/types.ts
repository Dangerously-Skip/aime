export interface ConnectorDefinition {
  id: string;
  name: string;
  description: string;
  category: 'project-management' | 'communication' | 'development' | 'cloud' | 'design' | 'documentation';
  /** If true, shows a "Coming soon" badge and disables the Connect button */
  comingSoon?: boolean;

  // Auth config
  auth: {
    type: 'oauth2' | 'api_key' | 'aws_iam' | 'mcp-oauth' | 'mcp-self-auth';
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
  mcp: {
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
