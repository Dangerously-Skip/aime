export interface ConnectorDefinition {
  id: string;
  name: string;
  description: string;
  category: 'project-management' | 'communication' | 'development' | 'cloud' | 'design' | 'documentation';
  /** If true, shows a "Coming soon" badge and disables the Connect button */
  comingSoon?: boolean;

  // Auth config
  auth: {
    type: 'oauth2' | 'api_key' | 'aws_iam';
    authUrl?: string;
    tokenUrl?: string;
    scopes?: string[];
    clientId?: string;
    pkce?: boolean;
    envVarName?: string; // For api_key type
    hint?: string;       // Instruction text shown in the Connect dialog
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
