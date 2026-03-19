import type { ConnectorDefinition } from '../types';

export const buildkite: ConnectorDefinition = {
  id: 'buildkite',
  name: 'Buildkite',
  description: 'CI/CD pipelines & builds',
  category: 'development',
  auth: {
    type: 'api_key',
    envVarName: 'BUILDKITE_API_TOKEN',
    hint: 'Go to buildkite.com/user/api-access-tokens → New API Access Token. Enable read_builds, read_pipelines, and read_organizations scopes.',
  },
  mcp: {
    transport: 'http',
    url: 'https://mcp.buildkite.com/mcp',
    tokenInjection: { method: 'header', headerName: 'Authorization', prefix: 'Bearer ' },
  },
};
