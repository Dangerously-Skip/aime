import type { ConnectorDefinition } from '../types';

export const miro: ConnectorDefinition = {
  id: 'miro',
  name: 'Miro',
  description: 'Visual collaboration & whiteboarding',
  category: 'design',
  auth: {
    type: 'oauth2',
    authUrl: 'https://miro.com/oauth/authorize',
    tokenUrl: 'https://api.miro.com/v1/oauth/token',
    scopes: ['boards:read', 'boards:write'],
    pkce: false,
  },
  mcp: {
    transport: 'http',
    url: 'https://mcp.miro.com/',
    tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
  },
};
