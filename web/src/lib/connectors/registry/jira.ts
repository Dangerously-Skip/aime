import type { ConnectorDefinition } from '../types';

export const jira: ConnectorDefinition = {
  id: 'jira',
  name: 'Jira',
  description: 'Issue tracking & project management',
  category: 'project-management',
  auth: {
    type: 'oauth2',
    authUrl: 'https://auth.atlassian.com/authorize',
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    scopes: ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'],
    pkce: true,
  },
  mcp: {
    transport: 'http',
    url: 'https://mcp.atlassian.com/v1/mcp',
    tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
  },
};
