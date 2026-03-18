import type { ConnectorDefinition } from '../types';

export const sumologic: ConnectorDefinition = {
  id: 'sumologic',
  name: 'Sumo Logic',
  description: 'Log management & analytics',
  category: 'cloud',
  auth: {
    type: 'api_key',
    envVarName: 'SUMOLOGIC_ACCESS_TOKEN',
  },
  mcp: {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@nicholasgriffintn/sumologic-mcp-server'],
    tokenInjection: { method: 'env', envVar: 'SUMOLOGIC_ACCESS_TOKEN' },
  },
};
