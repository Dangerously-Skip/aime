import type { ConnectorDefinition } from '../types';

export const slack: ConnectorDefinition = {
  id: 'slack',
  name: 'Slack',
  description: 'Team messaging & notifications',
  category: 'communication',
  auth: {
    type: 'oauth2',
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: ['channels:read', 'chat:write', 'users:read'],
    pkce: false,
  },
  mcp: {
    transport: 'http',
    url: 'https://mcp.slack.com/mcp',
    tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
  },
};
