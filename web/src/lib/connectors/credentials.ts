/**
 * Bundled OAuth app credentials for nib deployment.
 *
 * For non-nib deployments, env var overrides are checked first
 * (e.g. GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET), falling back to these.
 *
 * Replace placeholder values with real registered OAuth app credentials
 * before deploying.
 */

interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  tenantId?: string;
  accountId?: string;
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
  'google-drive': {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
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
};

export function getCredentials(connectorId: string): OAuthCredentials | null {
  return OAUTH_CREDENTIALS[connectorId] || null;
}
