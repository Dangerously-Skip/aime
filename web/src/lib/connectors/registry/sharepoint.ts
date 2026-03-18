import type { ConnectorDefinition } from '../types';

export const sharepoint: ConnectorDefinition = {
  id: 'sharepoint',
  name: 'SharePoint',
  description: 'Document management & collaboration',
  category: 'documentation',
  auth: {
    type: 'oauth2',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['Sites.ReadWrite.All', 'Files.ReadWrite.All', 'offline_access'],
    pkce: true,
  },
  mcp: {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@softeria/ms-365-mcp-server'],
    tokenInjection: { method: 'env', envVar: 'MS365_ACCESS_TOKEN' },
  },
};
