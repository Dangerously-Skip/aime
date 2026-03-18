/**
 * @deprecated Legacy connector catalog. Use CONNECTOR_REGISTRY from '@/lib/connectors/registry' instead.
 * Kept for backward compatibility with components that haven't been migrated yet.
 */

export interface CatalogConnector {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'project-management' | 'communication' | 'development' | 'cloud' | 'design' | 'documentation';
  authType: 'oauth2' | 'api_key';
}

/** @deprecated Use CONNECTOR_REGISTRY instead */
export const CONNECTOR_CATALOG: CatalogConnector[] = [
  {
    id: 'jira',
    name: 'Jira',
    description: 'Issue tracking & project management',
    icon: 'clipboard-list',
    category: 'project-management',
    authType: 'oauth2',
  },
  {
    id: 'confluence',
    name: 'Confluence',
    description: 'Team wiki & documentation',
    icon: 'book-open',
    category: 'documentation',
    authType: 'oauth2',
  },
  {
    id: 'outlook',
    name: 'Outlook 365',
    description: 'Email & calendar',
    icon: 'mail',
    category: 'communication',
    authType: 'oauth2',
  },
  {
    id: 'sharepoint',
    name: 'SharePoint',
    description: 'Document management & collaboration',
    icon: 'folder-open',
    category: 'documentation',
    authType: 'oauth2',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Team messaging & notifications',
    icon: 'message-square',
    category: 'communication',
    authType: 'oauth2',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Code hosting & collaboration',
    icon: 'git-branch',
    category: 'development',
    authType: 'oauth2',
  },
  {
    id: 'buildkite',
    name: 'Buildkite',
    description: 'CI/CD pipelines & builds',
    icon: 'play',
    category: 'development',
    authType: 'api_key',
  },
  {
    id: 'sumologic',
    name: 'Sumo Logic',
    description: 'Log management & analytics',
    icon: 'activity',
    category: 'cloud',
    authType: 'api_key',
  },
  {
    id: 'aws',
    name: 'AWS',
    description: 'Cloud infrastructure & services',
    icon: 'cloud',
    category: 'cloud',
    authType: 'oauth2',
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'File storage & collaboration',
    icon: 'hard-drive',
    category: 'documentation',
    authType: 'oauth2',
  },
  {
    id: 'miro',
    name: 'Miro',
    description: 'Visual collaboration & whiteboarding',
    icon: 'layout',
    category: 'design',
    authType: 'oauth2',
  },
  {
    id: 'figma',
    name: 'Figma',
    description: 'UI/UX design & prototyping',
    icon: 'pen-tool',
    category: 'design',
    authType: 'oauth2',
  },
  {
    id: 'zoom',
    name: 'Zoom',
    description: 'Video conferencing & meetings',
    icon: 'video',
    category: 'communication',
    authType: 'oauth2',
  },
];

export const CATEGORY_LABELS: Record<CatalogConnector['category'], string> = {
  'project-management': 'Project Management',
  'communication': 'Communication',
  'development': 'Development',
  'cloud': 'Cloud',
  'design': 'Design',
  'documentation': 'Documentation',
};
