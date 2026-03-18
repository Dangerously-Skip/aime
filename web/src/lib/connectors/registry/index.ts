import type { ConnectorDefinition } from '../types';

import { github } from './github';
import { slack } from './slack';
import { jira } from './jira';
import { confluence } from './confluence';
import { outlook } from './outlook';
import { sharepoint } from './sharepoint';
import { googleDrive } from './google-drive';
import { figma } from './figma';
import { miro } from './miro';
import { buildkite } from './buildkite';
import { aws } from './aws';
import { zoom } from './zoom';
import { sumologic } from './sumologic';

export const CONNECTOR_REGISTRY: ConnectorDefinition[] = [
  github,
  slack,
  jira,
  confluence,
  outlook,
  sharepoint,
  googleDrive,
  figma,
  miro,
  buildkite,
  aws,
  zoom,
  sumologic,
];

export const CONNECTOR_MAP: Record<string, ConnectorDefinition> = Object.fromEntries(
  CONNECTOR_REGISTRY.map((c) => [c.id, c])
);

export {
  github,
  slack,
  jira,
  confluence,
  outlook,
  sharepoint,
  googleDrive,
  figma,
  miro,
  buildkite,
  aws,
  zoom,
  sumologic,
};
