import type { ConnectorDefinition } from '../types';

export const zoom: ConnectorDefinition = {
  id: 'zoom',
  name: 'Zoom',
  description: 'Video conferencing & meetings',
  category: 'communication',
  auth: {
    type: 'oauth2',
    authUrl: 'https://zoom.us/oauth/authorize',
    tokenUrl: 'https://zoom.us/oauth/token',
    scopes: ['meeting:read', 'meeting:write', 'user:read'],
    pkce: false,
  },
  mcp: {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@yitianyigexiangfa/zoom-mcp-server'],
    tokenInjection: { method: 'env', envVar: 'ZOOM_ACCESS_TOKEN' },
  },
};
