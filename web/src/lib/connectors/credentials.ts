/**
 * OAuth app credentials, sourced from environment variables
 * (e.g. GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET).
 *
 * Replace placeholder values with real registered OAuth app credentials
 * before deploying.
 */

interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  tenantId?: string;
  accountId?: string;
  /** If true, client is public (PKCE, no secret) — token endpoints are called without client_secret. */
  publicClient?: boolean;
}

export const OAUTH_CREDENTIALS: Record<string, OAuthCredentials> = {
  github: {
    clientId: process.env.GITHUB_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
  },
  slack: {
    clientId: process.env.SLACK_CLIENT_ID || '',
    clientSecret: process.env.SLACK_CLIENT_SECRET || '',
  },
  jira: {
    clientId: process.env.ATLASSIAN_CLIENT_ID || '',
    clientSecret: process.env.ATLASSIAN_CLIENT_SECRET || '',
  },
  confluence: {
    clientId: process.env.ATLASSIAN_CLIENT_ID || '',
    clientSecret: process.env.ATLASSIAN_CLIENT_SECRET || '',
  },
  outlook: {
    clientId: process.env.MS365_CLIENT_ID || '',
    clientSecret: process.env.MS365_CLIENT_SECRET || '',
    tenantId: process.env.MS365_TENANT_ID || 'common',
  },
  sharepoint: {
    clientId: process.env.MS365_CLIENT_ID || '',
    clientSecret: process.env.MS365_CLIENT_SECRET || '',
    tenantId: process.env.MS365_TENANT_ID || 'common',
  },
  // Workspace Google — IT-managed OAuth app. Same env vars as the
  // retired google-drive connector so existing configs carry over.
  'google-workspace': {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  },
  // Personal Google — user brings their own client_id + secret via a setup
  // dialog. Server-side credentials are empty; the OAuth flow accepts
  // client-supplied creds in the request body for byoCredentials connectors.
  'google-personal': {
    clientId: '',
    clientSecret: '',
  },
  figma: {
    clientId: process.env.FIGMA_CLIENT_ID || '',
    clientSecret: process.env.FIGMA_CLIENT_SECRET || '',
  },
  miro: {
    clientId: process.env.MIRO_CLIENT_ID || '',
    clientSecret: process.env.MIRO_CLIENT_SECRET || '',
  },
  zoom: {
    clientId: process.env.ZOOM_CLIENT_ID || '',
    clientSecret: process.env.ZOOM_CLIENT_SECRET || '',
    accountId: process.env.ZOOM_ACCOUNT_ID || '',
  },
  // Microsoft Graph PowerShell — Microsoft first-party public client (FOCI app).
  // Pre-registered in every Entra tenant, accepts http://localhost:* redirects,
  // no client_secret required (PKCE). Lets any user connect their own
  // mail/calendar without IT creating a bespoke Entra app.
  'm365-graph': {
    clientId: '14d82eec-204b-4c2f-b7e8-296a70dab67e',
    clientSecret: '',
    publicClient: true,
  },
};

export function getCredentials(connectorId: string): OAuthCredentials | null {
  return OAUTH_CREDENTIALS[connectorId] || null;
}

/**
 * The env var each connector's client_id is read from above. Kept beside the
 * lookups themselves so the UI can name the *actual* variable to set — deriving
 * a name from the connector id gets it wrong (google-workspace reads
 * GOOGLE_CLIENT_ID, not GOOGLE_WORKSPACE_CLIENT_ID).
 *
 * Connectors with a hardcoded public client (m365-graph) are absent: nothing
 * needs configuring for them.
 */
export const OAUTH_CLIENT_ID_ENV: Record<string, string> = {
  github: 'GITHUB_CLIENT_ID',
  slack: 'SLACK_CLIENT_ID',
  jira: 'ATLASSIAN_CLIENT_ID',
  confluence: 'ATLASSIAN_CLIENT_ID',
  outlook: 'MS365_CLIENT_ID',
  sharepoint: 'MS365_CLIENT_ID',
  'google-workspace': 'GOOGLE_CLIENT_ID',
  figma: 'FIGMA_CLIENT_ID',
  miro: 'MIRO_CLIENT_ID',
  zoom: 'ZOOM_CLIENT_ID',
};
