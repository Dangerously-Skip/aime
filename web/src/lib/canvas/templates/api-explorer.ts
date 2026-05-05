import type { CanvasTemplate } from './types';

interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  path: string;
  summary?: string;
  description?: string;
  /** Optional grouping (e.g. tag from OpenAPI). */
  group?: string;
  /** Mark deprecated endpoints visually. */
  deprecated?: boolean;
}

interface ApiExplorerInput {
  title: string;
  /** API base URL or service name. */
  baseUrl?: string;
  /** Endpoints — pre-grouped by `group` if relevant. */
  endpoints: ApiEndpoint[];
  /** Optional caption. */
  caption?: string;
}

const METHOD_BADGE_COLOR: Record<string, string> = {
  GET: 'success',
  POST: 'info',
  PUT: 'warning',
  PATCH: 'warning',
  DELETE: 'error',
  HEAD: 'default',
  OPTIONS: 'default',
};

export const apiExplorerTemplate: CanvasTemplate<ApiExplorerInput> = {
  id: 'api_explorer',
  name: 'API explorer',
  description: 'Render an API surface (OpenAPI spec, README endpoint list, etc.) as grouped endpoint tables — one table per tag/section, with method badges.',
  whenToUse:
    'When the user asks to summarise an API, document endpoints, explore an OpenAPI/Swagger spec, or list HTTP routes for a service. ' +
    'Group endpoints by their OpenAPI tag (or by URL prefix if no tags exist).',
  inputShape:
    '{ title: string, baseUrl?: string, endpoints: { method, path, summary?, description?, group?, deprecated? }[], caption?: string }',
  render: ({ title, baseUrl, endpoints, caption }) => {
    const safeEndpoints = Array.isArray(endpoints) ? endpoints : [];
    const groups = new Map<string, ApiEndpoint[]>();
    for (const ep of safeEndpoints) {
      const g = ep.group || 'default';
      const bucket = groups.get(g) ?? [];
      bucket.push(ep);
      groups.set(g, bucket);
    }

    const groupTables = Array.from(groups.entries()).map(([group, eps]) => ({
      type: 'table' as const,
      id: `group-${group}`,
      title: group === 'default' ? undefined : group,
      columns: [
        { key: 'method', label: 'Method', type: 'badge' as const },
        { key: 'path', label: 'Path' },
        { key: 'summary', label: 'Summary' },
      ],
      rows: eps.map((ep) => ({
        method: ep.method + (ep.deprecated ? ' ⚠️' : ''),
        path: ep.path,
        summary: ep.summary || ep.description || '',
      })),
    }));

    return {
      version: '1',
      title: title || 'API explorer',
      components: [
        {
          type: 'stat',
          id: 'overview',
          stats: [
            ...(baseUrl ? [{ label: 'Base URL', value: baseUrl }] : []),
            { label: 'Endpoints', value: safeEndpoints.length },
            { label: 'Groups', value: groups.size },
          ],
        },
        ...groupTables,
        ...(caption ? [{ type: 'markdown' as const, id: 'caption', content: caption }] : []),
      ],
    };
  },
};

// Suppress the badge-color reference being unused — color hints are encoded
// in the method emoji/symbol via the badge column type.
void METHOD_BADGE_COLOR;
