import type { ConnectorDefinition } from './types';

/**
 * Master connector registry.
 *
 * MCP transport notes:
 *   stdio  — spawns a local npm package via npx; token injected as env var.
 *            Run `npm run setup:mcp` to pre-install packages (avoids cold-start delays).
 *   http   — connects to a remote MCP server; token injected as Authorization header.
 *            No local install required.
 *
 * OAuth redirect URI for all connectors: http://localhost:3001/api/connectors/oauth/callback
 */
export const CONNECTOR_REGISTRY: ConnectorDefinition[] = [
  // ── Development ────────────────────────────────────────────────────────────

  {
    id: 'github',
    name: 'GitHub',
    description: 'Code hosting & collaboration',
    category: 'development',
    auth: {
      type: 'oauth2',
      authUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['repo', 'read:org', 'read:user', 'gist'],
    },
    mcp: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github@latest'],
      tokenInjection: { method: 'env', envVar: 'GITHUB_PERSONAL_ACCESS_TOKEN' },
    },
  },

  {
    id: 'buildkite',
    name: 'Buildkite',
    description: 'CI/CD pipelines & builds',
    category: 'development',
    auth: {
      type: 'api_key',
      envVarName: 'BUILDKITE_API_TOKEN',
    },
    mcp: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@buildkite/mcp-server@latest'],
      tokenInjection: { method: 'env', envVar: 'BUILDKITE_API_TOKEN' },
    },
  },

  // ── Communication ──────────────────────────────────────────────────────────

  {
    id: 'slack',
    name: 'Slack',
    description: 'Team messaging & notifications',
    category: 'communication',
    auth: {
      type: 'oauth2',
      authUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      scopes: [
        'channels:read', 'channels:history', 'channels:join',
        'groups:read', 'groups:history',
        'users:read', 'users:read.email',
        'chat:write', 'files:read', 'reactions:read',
        'search:read',
      ],
    },
    mcp: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack@latest'],
      tokenInjection: { method: 'env', envVar: 'SLACK_BOT_TOKEN' },
    },
  },

  {
    id: 'zoom',
    name: 'Zoom',
    description: 'Video conferencing & meetings',
    category: 'communication',
    auth: {
      type: 'oauth2',
      authUrl: 'https://zoom.us/oauth/authorize',
      tokenUrl: 'https://zoom.us/oauth/token',
      scopes: ['meeting:read', 'recording:read', 'user:read', 'report:read:admin'],
    },
    mcp: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'zoom-mcp-server@latest'],
      tokenInjection: { method: 'env', envVar: 'ZOOM_ACCESS_TOKEN' },
    },
  },

  // ── Project Management ─────────────────────────────────────────────────────

  {
    id: 'jira',
    name: 'Jira',
    description: 'Issue tracking & project management',
    category: 'project-management',
    auth: {
      type: 'oauth2',
      authUrl: 'https://auth.atlassian.com/authorize',
      tokenUrl: 'https://auth.atlassian.com/oauth/token',
      scopes: [
        'read:jira-work', 'write:jira-work',
        'read:jira-user',
        'offline_access',
      ],
      pkce: true,
    },
    mcp: {
      // Atlassian provides an official remote MCP server — no local install needed.
      transport: 'http',
      url: 'https://mcp.atlassian.com/v1/mcp',
      tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
    },
  },

  // ── Documentation ──────────────────────────────────────────────────────────

  {
    id: 'confluence',
    name: 'Confluence',
    description: 'Team wiki & documentation',
    category: 'documentation',
    auth: {
      type: 'oauth2',
      authUrl: 'https://auth.atlassian.com/authorize',
      tokenUrl: 'https://auth.atlassian.com/oauth/token',
      scopes: [
        'read:confluence-content.all', 'write:confluence-content',
        'search:confluence',
        'offline_access',
      ],
      pkce: true,
    },
    mcp: {
      // Shares Atlassian's remote MCP server with Jira.
      transport: 'http',
      url: 'https://mcp.atlassian.com/v1/mcp',
      tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
    },
  },

  {
    id: 'sharepoint',
    name: 'SharePoint',
    description: 'Document management & collaboration',
    category: 'documentation',
    auth: {
      type: 'oauth2',
      authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scopes: [
        'Sites.Read.All', 'Files.Read.All', 'offline_access',
      ],
    },
    mcp: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@softeria/ms-365-mcp-server@latest'],
      tokenInjection: { method: 'env', envVar: 'MS365_ACCESS_TOKEN' },
    },
  },

  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'File storage & collaboration',
    category: 'documentation',
    auth: {
      type: 'oauth2',
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.metadata.readonly',
      ],
      pkce: true,
    },
    mcp: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-gdrive@latest'],
      tokenInjection: { method: 'env', envVar: 'GOOGLE_ACCESS_TOKEN' },
    },
  },

  // ── Communication (M365) ──────────────────────────────────────────────────

  {
    id: 'outlook',
    name: 'Outlook 365',
    description: 'Email & calendar',
    category: 'communication',
    auth: {
      type: 'oauth2',
      authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scopes: [
        'Mail.Read', 'Mail.Send', 'Mail.ReadWrite',
        'Calendars.Read', 'Calendars.ReadWrite',
        'offline_access',
      ],
    },
    mcp: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@softeria/ms-365-mcp-server@latest'],
      tokenInjection: { method: 'env', envVar: 'MS365_ACCESS_TOKEN' },
    },
  },

  // ── Cloud ──────────────────────────────────────────────────────────────────

  {
    id: 'aws',
    name: 'AWS',
    description: 'Cloud infrastructure & services',
    category: 'cloud',
    auth: {
      type: 'aws_iam',
    },
    mcp: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@aws/mcp-server-aws@latest'],
      tokenInjection: { method: 'env', envVar: 'AWS_ACCESS_KEY_ID' },
    },
  },

  {
    id: 'sumologic',
    name: 'Sumo Logic',
    description: 'Log management & analytics',
    category: 'cloud',
    auth: {
      type: 'api_key',
      envVarName: 'SUMOLOGIC_ACCESS_KEY',
    },
    mcp: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'sumologic-mcp-server@latest'],
      tokenInjection: { method: 'env', envVar: 'SUMOLOGIC_ACCESS_KEY' },
    },
  },

  // ── Design ─────────────────────────────────────────────────────────────────

  {
    id: 'figma',
    name: 'Figma',
    description: 'UI/UX design & prototyping',
    category: 'design',
    auth: {
      type: 'oauth2',
      authUrl: 'https://www.figma.com/oauth',
      tokenUrl: 'https://www.figma.com/api/oauth/token',
      scopes: ['files:read'],
    },
    mcp: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'figma-mcp@latest'],
      tokenInjection: { method: 'env', envVar: 'FIGMA_ACCESS_TOKEN' },
    },
  },

  {
    id: 'miro',
    name: 'Miro',
    description: 'Visual collaboration & whiteboarding',
    category: 'design',
    auth: {
      type: 'oauth2',
      authUrl: 'https://miro.com/oauth/authorize',
      tokenUrl: 'https://api.miro.com/v1/oauth/token',
      scopes: ['boards:read', 'boards:write'],
    },
    mcp: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@mirohq/mcp-server@latest'],
      tokenInjection: { method: 'env', envVar: 'MIRO_ACCESS_TOKEN' },
    },
  },
];

/** Fast O(1) lookup by connector ID. */
export const CONNECTOR_MAP: Record<string, ConnectorDefinition> = Object.fromEntries(
  CONNECTOR_REGISTRY.map((c) => [c.id, c])
);
