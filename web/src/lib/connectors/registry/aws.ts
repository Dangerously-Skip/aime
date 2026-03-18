import type { ConnectorDefinition } from '../types';

export const aws: ConnectorDefinition = {
  id: 'aws',
  name: 'AWS',
  description: 'Cloud infrastructure & services',
  category: 'cloud',
  auth: {
    type: 'aws_iam',
    // Uses existing AWS credentials from environment
  },
  mcp: {
    transport: 'stdio',
    command: 'uvx',
    args: ['awslabs.core-mcp-server'],
    tokenInjection: { method: 'env', envVar: 'AWS_PROFILE' },
  },
};
