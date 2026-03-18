import type { ConnectorDefinition } from '../types';

export const outlook: ConnectorDefinition = {
  id: 'outlook',
  name: 'Outlook 365',
  description: 'Email & calendar',
  category: 'communication',
  auth: {
    type: 'oauth2',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['Mail.Read', 'Mail.Send', 'Calendars.ReadWrite', 'offline_access'],
    pkce: true,
  },
  mcp: {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@softeria/ms-365-mcp-server'],
    tokenInjection: { method: 'env', envVar: 'MS365_ACCESS_TOKEN' },
  },
};
