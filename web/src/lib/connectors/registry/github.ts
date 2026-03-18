import type { ConnectorDefinition } from '../types';

export const github: ConnectorDefinition = {
  id: 'github',
  name: 'GitHub',
  description: 'Code hosting & collaboration',
  category: 'development',
  auth: {
    type: 'oauth2',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'read:org', 'read:user'],
    pkce: false,
  },
  mcp: {
    transport: 'stdio',
    command: 'docker',
    args: ['run', '--pull=always', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server', 'stdio'],
    tokenInjection: { method: 'env', envVar: 'GITHUB_PERSONAL_ACCESS_TOKEN' },
  },
};
