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
      type: 'api_key',
      envVarName: 'GITHUB_PERSONAL_ACCESS_TOKEN',
      hint: 'Go to github.com/settings/tokens → Generate new token (classic). Recommended scopes: repo, read:org, read:user, workflow, gist. Fine-grained tokens also work — grant access to the repos you want Quarry to work with.',
    },
    mcp: {
      // Official hosted GitHub MCP — ~100 tools including PRs, issues, workflows, code scanning
      transport: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
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
      hint: 'Go to buildkite.com/user/api-access-tokens → New API Access Token. Enable read_builds, read_pipelines, and read_organizations scopes.',
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
      type: 'mcp-oauth',
      // Slack's hosted MCP. DCR isn't supported, so we use the public client_id
      // that slackapi publishes in their marketplace plugin's .mcp.json.
      mcpUrl: 'https://mcp.slack.com/mcp',
      fallbackClientId: '1601185624273.8899143856786',
    },
    mcp: {
      transport: 'http',
      url: 'https://mcp.slack.com/mcp',
      tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
    },
  },

  {
    id: 'zoom',
    name: 'Zoom',
    description: 'Video conferencing & meetings',
    category: 'communication',
    comingSoon: true,
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
    id: 'atlassian',
    name: 'Atlassian',
    description: 'Jira + Confluence — issue tracking, team wiki, documentation',
    category: 'project-management',
    auth: {
      type: 'mcp-oauth',
      mcpUrl: 'https://mcp.atlassian.com/v1/mcp',
    },
    mcp: {
      transport: 'http',
      url: 'https://mcp.atlassian.com/v1/mcp',
      tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
    },
  },

  {
    id: 'linear',
    name: 'Linear',
    description: 'Issue tracking for modern software teams',
    category: 'project-management',
    auth: {
      type: 'mcp-oauth',
      mcpUrl: 'https://mcp.linear.app/mcp',
    },
    mcp: {
      transport: 'http',
      url: 'https://mcp.linear.app/mcp',
      tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
    },
  },

  // ── Documentation ──────────────────────────────────────────────────────────

  {
    id: 'notion',
    name: 'Notion',
    description: 'Notes, docs, and knowledge base',
    category: 'documentation',
    auth: {
      type: 'mcp-oauth',
      mcpUrl: 'https://mcp.notion.com/mcp',
    },
    mcp: {
      transport: 'http',
      url: 'https://mcp.notion.com/mcp',
      tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
    },
  },

  {
    id: 'google-drive',
    name: 'Google Drive',
    comingSoon: true,
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
    id: 'outlook-mail',
    name: 'Outlook Mail',
    description: 'Read, send, and search email via Microsoft Graph',
    category: 'communication',
    auth: {
      type: 'mcp-oauth',
      // Microsoft's official MCP for mail. {tenant_id} is resolved from the user's
      // email domain at connect time. DCR isn't supported, so we fall back to a
      // pre-registered Azure AD app via MS365_CLIENT_ID.
      mcpUrl: 'https://agent365.svc.cloud.microsoft/agents/tenants/{tenant_id}/servers/mcp_MailTools',
      fallbackClientIdEnv: 'MS365_CLIENT_ID',
    },
    mcp: {
      transport: 'http',
      url: 'https://agent365.svc.cloud.microsoft/agents/tenants/{tenant_id}/servers/mcp_MailTools',
      tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
    },
  },

  {
    id: 'outlook-calendar',
    name: 'Outlook Calendar',
    description: 'Create and manage calendar events via Microsoft Graph',
    category: 'communication',
    auth: {
      type: 'mcp-oauth',
      mcpUrl: 'https://agent365.svc.cloud.microsoft/agents/tenants/{tenant_id}/servers/mcp_CalendarTools',
      fallbackClientIdEnv: 'MS365_CLIENT_ID',
    },
    mcp: {
      transport: 'http',
      url: 'https://agent365.svc.cloud.microsoft/agents/tenants/{tenant_id}/servers/mcp_CalendarTools',
      tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
    },
  },

  {
    id: 'm365-copilot',
    name: 'Microsoft 365 Copilot',
    description: 'Search across M365 content — documents, emails, sites, files, chats',
    category: 'documentation',
    auth: {
      type: 'mcp-oauth',
      mcpUrl: 'https://agent365.svc.cloud.microsoft/agents/tenants/{tenant_id}/servers/mcp_M365Copilot',
      fallbackClientIdEnv: 'MS365_CLIENT_ID',
    },
    mcp: {
      transport: 'http',
      url: 'https://agent365.svc.cloud.microsoft/agents/tenants/{tenant_id}/servers/mcp_M365Copilot',
      tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
    },
  },

  {
    id: 'onedrive-sharepoint',
    name: 'OneDrive & SharePoint',
    description: 'Read and manage files across OneDrive and SharePoint',
    category: 'documentation',
    auth: {
      type: 'mcp-oauth',
      mcpUrl: 'https://agent365.svc.cloud.microsoft/agents/tenants/{tenant_id}/servers/mcp_ODSPRemoteServer',
      fallbackClientIdEnv: 'MS365_CLIENT_ID',
    },
    mcp: {
      transport: 'http',
      url: 'https://agent365.svc.cloud.microsoft/agents/tenants/{tenant_id}/servers/mcp_ODSPRemoteServer',
      tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
    },
  },

  // ── Data ───────────────────────────────────────────────────────────────────

  {
    id: 'snowflake',
    name: 'Snowflake',
    description: 'Query Snowflake data via your org\'s hosted MCP server',
    category: 'cloud',
    auth: {
      // Snowflake's hosted MCP doesn't support Dynamic Client Registration, and
      // OAuth setup requires ACCOUNTADMIN to CREATE SECURITY INTEGRATION. PATs
      // are user-generated (no admin needed) and pass as a Bearer token.
      type: 'api_key',
      envVarName: 'SNOWFLAKE_PAT',
      hint: 'Use a Programmatic Access Token (PAT). See the connect dialog for the one-time setup SQL to run in Snowsight.',
    },
    mcp: {
      transport: 'http',
      url: 'https://{account}.snowflakecomputing.com/api/v2/databases/{database}/schemas/{schema}/mcp-servers/{server}',
      tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
    },
  },

  // ── Cloud ──────────────────────────────────────────────────────────────────

  {
    id: 'aws',
    name: 'AWS',
    description: 'Cloud infrastructure & services (via AWS Labs MCP)',
    category: 'cloud',
    auth: {
      type: 'aws_iam',
    },
    mcp: {
      // AWS Labs publishes MCPs on PyPI. The `core-mcp-server` provides
      // a general-purpose entry point. Additional service-specific MCPs
      // (docs, CDK, CloudWatch, Cost Explorer, Terraform, EKS) can be
      // installed via Marketplace.
      transport: 'stdio',
      command: 'uvx',
      args: ['awslabs.core-mcp-server@latest'],
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
      hint: 'Go to Administration → Security → Access Keys → Add Access Key. After saving, combine the two values as accessId:accessKey (colon-separated, no spaces).',
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
      type: 'mcp-oauth',
      mcpUrl: 'https://mcp.figma.com/mcp',
    },
    mcp: {
      transport: 'http',
      url: 'https://mcp.figma.com/mcp',
      tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
    },
  },

  {
    id: 'miro',
    name: 'Miro',
    description: 'Visual collaboration & whiteboarding',
    category: 'design',
    auth: {
      type: 'mcp-oauth',
      // Miro serves OAuth discovery at /mcp but actual JSON-RPC at /
      mcpUrl: 'https://mcp.miro.com/',
    },
    mcp: {
      transport: 'http',
      url: 'https://mcp.miro.com/',
      tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
    },
  },
];

/** Fast O(1) lookup by connector ID. */
export const CONNECTOR_MAP: Record<string, ConnectorDefinition> = Object.fromEntries(
  CONNECTOR_REGISTRY.map((c) => [c.id, c])
);
