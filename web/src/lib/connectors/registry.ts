import type { ConnectorDefinition } from './types';
import { APP_NAME } from '@/config/branding';

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
      hint: `Go to github.com/settings/tokens → Generate new token (classic). Recommended scopes: repo, read:org, read:user, workflow, gist. Fine-grained tokens also work — grant access to the repos you want ${APP_NAME} to work with.`,
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
      dcr: 'unsupported',
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

  // ── Documentation ──────────────────────────────────────────────────────────

  {
    id: 'google-workspace',
    name: 'Google Workspace',
    description: 'Gmail, Calendar, and Drive — uses your workspace Google account',
    category: 'documentation',
    auth: {
      type: 'oauth2',
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: [
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
      ],
      pkce: true,
      // Google only returns a refresh_token when access_type=offline is asked
      // for, and only reissues one when prompt=consent is forced. Without both,
      // the connection stops working ~1h after connecting and cannot recover.
      extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    },
    mcp: {
      transport: 'stdio',
      command: 'node',
      args: ['{appDir}/mcp-servers/google-workspace/index.mjs'],
      tokenInjection: { method: 'env', envVar: 'GOOGLE_ACCESS_TOKEN' },
    },
  },

  {
    id: 'google-personal',
    name: 'Google (Personal)',
    description: 'Personal Gmail, Calendar, Drive — uses your own Google Cloud OAuth app',
    category: 'documentation',
    auth: {
      type: 'oauth2',
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: [
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
      ],
      pkce: true,
      byoCredentials: true,
      // See google-workspace: without these the token cannot be refreshed.
      extraAuthParams: { access_type: 'offline', prompt: 'consent' },
      hint:
        'Create your own Google OAuth client (10 min):\n' +
        '1. Go to console.cloud.google.com → select or create a project\n' +
        '2. Enable Gmail API, Calendar API, Drive API (APIs & Services → Library)\n' +
        '3. OAuth consent screen → External → add yourself as test user. Scopes: gmail.modify, gmail.send, calendar, drive\n' +
        '4. Credentials → Create OAuth Client ID → "Desktop app"\n' +
        '5. Paste the client_id and client_secret here.\n\n' +
        'Works for personal @gmail.com AND any other Google accounts you add as test users.',
    },
    mcp: {
      transport: 'stdio',
      command: 'node',
      args: ['{appDir}/mcp-servers/google-workspace/index.mjs'],
      tokenInjection: { method: 'env', envVar: 'GOOGLE_ACCESS_TOKEN' },
    },
  },

  // ── Communication (M365) ──────────────────────────────────────────────────

  {
    // Mail + Calendar via standard Microsoft Graph (not the WorkIQ MCP).
    // Uses Microsoft's first-party "Microsoft Graph PowerShell" public client
    // that lives in every Entra tenant — no custom app registration, no
    // MS365_CLIENT_ID env var. Each user signs in as themselves.
    id: 'm365-graph',
    name: 'Microsoft 365 (Mail + Calendar)',
    description: 'Read/send email and manage calendar via Microsoft Graph',
    category: 'communication',
    auth: {
      type: 'oauth2',
      // /common accepts any Entra tenant; Microsoft routes by signed-in user
      authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scopes: [
        'Mail.ReadWrite',
        'Mail.Send',
        'Calendars.ReadWrite',
        'User.Read',
        'offline_access',
      ],
      pkce: true,
      // Microsoft's public-client apps only accept path "/" as the redirect.
      redirectPath: '/',
    },
    mcp: {
      transport: 'stdio',
      command: 'node',
      // {appDir} is substituted server-side at provision time
      args: ['{appDir}/mcp-servers/m365-graph/index.mjs'],
      tokenInjection: { method: 'env', envVar: 'GRAPH_ACCESS_TOKEN' },
    },
  },

  {
    id: 'icloud',
    name: 'iCloud',
    description: 'Mail, Calendar and Contacts — reads your inbox and writes drafts; it cannot send',
    category: 'communication',
    auth: {
      // Not OAuth: Apple publishes no API for user data, so this speaks IMAP and
      // DAV with an app-specific password. The catalogue is still the right home
      // — a user connecting their email should not have to know the difference.
      type: 'app-password',
      hint: 'Create one at appleid.apple.com → Sign-In and Security → App-Specific Passwords. Not your Apple ID password — iCloud rejects that when two-factor is on.',
    },
  },

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
      // Microsoft Graph MCP endpoints do not implement RFC 7591, so a client_id
      // must come from an app registration — this is why they need env config.
      dcr: 'unsupported',      fallbackClientIdEnv: 'MS365_CLIENT_ID',
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
      // Microsoft Graph MCP endpoints do not implement RFC 7591, so a client_id
      // must come from an app registration — this is why they need env config.
      dcr: 'unsupported',      fallbackClientIdEnv: 'MS365_CLIENT_ID',
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
      // Microsoft Graph MCP endpoints do not implement RFC 7591, so a client_id
      // must come from an app registration — this is why they need env config.
      dcr: 'unsupported',      fallbackClientIdEnv: 'MS365_CLIENT_ID',
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
      // Microsoft Graph MCP endpoints do not implement RFC 7591, so a client_id
      // must come from an app registration — this is why they need env config.
      dcr: 'unsupported',      fallbackClientIdEnv: 'MS365_CLIENT_ID',
    },
    mcp: {
      transport: 'http',
      url: 'https://agent365.svc.cloud.microsoft/agents/tenants/{tenant_id}/servers/mcp_ODSPRemoteServer',
      tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
    },
  },

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
      // This connector injects NOTHING: `aws_iam` is in the provision route's
      // CREDENTIAL_FREE_AUTH set, so the token is blanked before the entry is
      // built and the server inherits the ambient chain (~/.aws, SSO, IRSA).
      // `tokenInjection` is required by the type, so it has to name something —
      // and this named AWS_ACCESS_KEY_ID, which is the wrong slot to point a
      // bypass at. Env static keys sit at the TOP of the AWS credential chain, so
      // a value landing there is unrecoverable: it either fails as a partial
      // credential (no AWS_SECRET_ACCESS_KEY) or authenticates as garbage, and
      // either way it shadows the working profile. AWS_PROFILE is only consulted
      // by the shared-config provider, so a stray value there is inert whenever
      // env or container credentials are present, and fails loudly and locally
      // when they are not.
      //
      // AWS_PROFILE is also what the rest of the codebase already believes this
      // says — provision-guard's buildTrustedMcpEntry comment, and both aws tests
      // in the provision route ("would set AWS_PROFILE to a profile that does not
      // exist", "refuses a hostile AWS_PROFILE dressed up as a token"). The
      // registry was the only place saying otherwise.
      tokenInjection: { method: 'env', envVar: 'AWS_PROFILE' },
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

/**
 * Display names for the connector categories.
 *
 * Lived in `nango-catalog.ts` until Nango was removed, and the keys were always
 * this registry's own `category` union — so the browse view was importing its
 * labels from a module about a service the app never used. Typed against
 * `ConnectorDefinition` so a new category cannot be added without a label.
 */
export const CATEGORY_LABELS: Record<ConnectorDefinition['category'], string> = {
  'project-management': 'Project Management',
  communication: 'Communication',
  development: 'Development',
  cloud: 'Cloud',
  design: 'Design',
  documentation: 'Documentation',
};
