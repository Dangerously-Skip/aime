/**
 * What to call a tool in Settings.
 *
 * The surface configs list the names the Agent SDK sees — `mcp__aime__FetchUrl`,
 * `spawn_agent`, `NotebookEdit` — and Settings used to print them verbatim, so the
 * one screen meant to explain what each surface can do read like a stack trace.
 * The internal name stays the source of truth; this is presentation only.
 */

/** Names that do not read well once split, or that deserve plainer wording. */
const KNOWN: Record<string, string> = {
  Agent: 'Sub-agents',
  spawn_agent: 'Sub-agents',
  AskUserQuestion: 'Ask you a question',
  Bash: 'Terminal commands',
  Edit: 'Edit files',
  Write: 'Write files',
  Read: 'Read files',
  Glob: 'Find files',
  Grep: 'Search in files',
  NotebookEdit: 'Edit notebooks',
  EnterWorktree: 'Git worktrees',
  TodoWrite: 'To-do list',
  Skill: 'Skills',
  SkillCreate: 'Create skills',
  WebFetch: 'Read web pages',
  FetchUrl: 'Read web pages',
  WebSearch: 'Web search',
  SearchWeb: 'Web search',
  web_search: 'Web search',
  WidgetCreate: 'Widgets',
  canvas: 'Canvas',
  navigate: 'Navigate the app',
  CreateImage: 'Create images',
  DocumentCreate: 'Create documents',
  ExcelRead: 'Read spreadsheets',
  ExcelWrite: 'Write spreadsheets',
  ExcelEdit: 'Edit spreadsheets',
  MailRead: 'Read mail',
  MailSearch: 'Search mail',
  MailDraft: 'Draft mail',
  CalendarEvents: 'Calendar',
  ContactsSearch: 'Contacts',
  RequestConnector: 'Suggest a connector',
  VoiceProfileSave: 'Save voice profile',
  StandingOrderCreate: 'Create automations',
  StandingOrderUpdate: 'Update automations',
  StandingOrderCancel: 'Cancel automations',
  StandingOrderList: 'List automations',
  StandingOrderHistory: 'Automation history',
}

/** `mcp__<server>__<tool>` → `<tool>`. */
function stripMcpPrefix(name: string): string {
  const m = /^mcp__.+?__(.+)$/.exec(name)
  return m ? m[1] : name
}

/** `FetchUrl` → `Fetch url`, `web_search` → `Web search`. */
function humanise(name: string): string {
  const words = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function friendlyToolLabel(name: string): string {
  const bare = stripMcpPrefix(name)
  return KNOWN[bare] ?? humanise(bare)
}

/** Friendly labels for a tool list, de-duplicated (two internal names can share one). */
export function friendlyToolLabels(names: readonly string[]): string[] {
  return [...new Set(names.filter(Boolean).map(friendlyToolLabel))]
}
