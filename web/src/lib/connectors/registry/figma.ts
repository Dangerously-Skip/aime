import type { ConnectorDefinition } from '../types';

export const figma: ConnectorDefinition = {
  id: 'figma',
  name: 'Figma',
  description: 'UI/UX design & prototyping',
  category: 'design',
  auth: {
    type: 'oauth2',
    authUrl: 'https://www.figma.com/oauth',
    tokenUrl: 'https://api.figma.com/v1/oauth/token',
    scopes: ['files:read'],
    pkce: false,
  },
  mcp: {
    transport: 'http',
    url: 'https://mcp.figma.com/mcp',
    tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
  },
};
