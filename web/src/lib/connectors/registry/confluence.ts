import type { ConnectorDefinition } from '../types';

export const confluence: ConnectorDefinition = {
  id: 'confluence',
  name: 'Confluence',
  description: 'Team wiki & documentation',
  category: 'documentation',
  auth: {
    type: 'oauth2',
    authUrl: 'https://auth.atlassian.com/authorize',
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    scopes: ['read:confluence-content.all', 'write:confluence-content', 'offline_access'],
    pkce: true,
  },
  mcp: {
    transport: 'http',
    url: 'https://mcp.atlassian.com/v1/mcp',
    tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
  },
};
