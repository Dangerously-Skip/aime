import type { CanvasTemplate } from './types';

interface ConfluencePageInput {
  title: string;
  /** Confluence page ID. */
  pageId: string;
  /** Atlassian site cloudId. */
  cloudId: string;
  /** Page space key. */
  spaceKey?: string;
  /** Last-known version (for optimistic concurrency on update). */
  version: number;
  /** Page body as markdown. */
  body: string;
  /** Web URL to the live page. */
  url?: string;
  /** Author display name. */
  author?: string;
  /** Last-modified ISO date. */
  lastModified?: string;
  /**
   * Full MCP tool name for updateConfluencePage (e.g.
   * `mcp__claude_ai_Atlassian__updateConfluencePage`). Used by the
   * "Save edits via agent" action to prompt the agent to make changes.
   */
  updateTool?: string;
}

export const confluencePageTemplate: CanvasTemplate<ConfluencePageInput> = {
  id: 'confluence_page',
  name: 'Confluence page viewer',
  description: 'Render a Confluence page as markdown with metadata + actions to refresh, open, or hand off to the agent for edits.',
  whenToUse:
    'When the user asks to view, summarise, or edit a specific Confluence page. ' +
    'Identify the Atlassian MCP server (`claude_ai_Atlassian`, `aime-mcp-atlassian`, or legacy `nib-mcp-atlassian`) and use *_getConfluencePage to fetch. ' +
    'Convert the body to markdown. Pass `updateTool` as the FULL MCP tool name so the "Edit via agent" action wires correctly.',
  inputShape:
    '{ title: string, pageId: string, cloudId: string, spaceKey?: string, version: number, body: string (markdown), url?: string, author?: string, lastModified?: string, updateTool?: string }',
  render: ({ title, pageId, cloudId, spaceKey, version, body, url, author, lastModified, updateTool }) => {
    return {
      version: '1',
      title: title || 'Confluence page',
      components: [
        {
          type: 'stat',
          id: 'meta',
          stats: [
            ...(spaceKey ? [{ label: 'Space', value: spaceKey }] : []),
            { label: 'Version', value: String(version) },
            ...(author ? [{ label: 'Last by', value: author }] : []),
            ...(lastModified ? [{ label: 'Modified', value: new Date(lastModified).toLocaleDateString() }] : []),
          ],
        },
        {
          type: 'markdown',
          id: 'body',
          content: body || '_(empty page)_',
        },
        {
          type: 'action-card',
          id: 'actions',
          title: 'Actions',
          actions: [
            ...(url ? [{
              actionId: `open-${pageId}`,
              label: '↗ Open in Confluence',
              variant: 'secondary' as const,
              feedbackPrompt: `Open ${url} in the user's browser.`,
            }] : []),
            ...(updateTool ? [{
              actionId: `edit-${pageId}`,
              label: '✎ Edit via agent',
              variant: 'primary' as const,
              feedbackPrompt: `Help the user edit Confluence page "${title}" (id ${pageId}, current version ${version}, cloudId ${cloudId}). Ask what changes they want, then call ${updateTool} with the new body and version: ${version + 1}.`,
            }] : []),
            {
              actionId: `refresh-${pageId}`,
              label: '⟳ Refresh from Confluence',
              variant: 'secondary' as const,
              feedbackPrompt: `Re-fetch Confluence page id ${pageId} (cloudId ${cloudId}) and re-render the canvas with the latest content.`,
            },
          ],
        },
      ],
    };
  },
};
