import type { ConnectorDefinition } from '../types';

export const googleDrive: ConnectorDefinition = {
  id: 'google-drive',
  name: 'Google Drive',
  description: 'File storage & collaboration',
  category: 'documentation',
  auth: {
    type: 'oauth2',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    pkce: true,
  },
  mcp: {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gdrive'],
    tokenInjection: { method: 'env', envVar: 'GDRIVE_ACCESS_TOKEN' },
  },
};
