/**
 * What the agent is doing, in words a person reads.
 *
 * WHY THIS EXISTS. During a long research turn the only thing on screen was
 * `Running mcp__aime__SearchWeb...` and then, for minutes, a collapsed
 * "7 actions completed". A user watching that has no idea whether it is working
 * or wedged — and the tool ids leak an internal naming convention (`mcp__`,
 * the server name, the exact camelCase symbol) that means nothing outside this
 * codebase.
 *
 * The complementary half is asking the MODEL to narrate, which the surface
 * prompts now do. That is guidance, not a mechanism: the model may say nothing,
 * and on a turn that is all tool calls it often does. This function is what
 * guarantees the screen says something useful regardless — so the two are not
 * alternatives, they are a floor and a ceiling.
 *
 * Phrasing rules, learned from reading the bad version:
 *   - present participle ("Searching…"), because it describes something in
 *     flight and the same string is reused once it has finished
 *   - name the SUBJECT, not the tool: the query, the host, the filename. "Read"
 *     is not information; "Reading pricing.csv" is.
 *   - never longer than a glance. Long values are truncated on a word boundary.
 */

/** Longest subject we will show inline before truncating. */
const MAX_SUBJECT = 48;

function short(value: unknown, max = MAX_SUBJECT): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().replace(/\s+/g, ' ');
  if (!v) return null;
  if (v.length <= max) return v;
  const cut = v.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut) + '…';
}

/** The host of a URL, or the raw string when it will not parse. */
function host(value: unknown): string | null {
  const raw = short(value, 60);
  if (!raw) return null;
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return raw;
  }
}

/** The last path segment, which is the part a person recognises. */
function basename(value: unknown): string | null {
  const raw = short(value, 200);
  if (!raw) return null;
  const name = raw.split(/[\\/]/).filter(Boolean).pop() ?? raw;
  return short(name);
}

/**
 * The bare tool name, with the MCP plumbing stripped.
 *
 * `mcp__aime__CalendarEvents` and `mcp__web-search__web_search` both carry a
 * server name the user never chose and cannot act on.
 */
export function baseToolLabel(name: string): string {
  const bare = name.replace(/^mcp__[^_]+(?:__)?/, '').replace(/^[a-z-]+__/, '') || name;
  return bare
    .replace(/[_-]+/g, ' ')
    // camelCase → spaced, without breaking an all-caps run like `URL`
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    // Sentence case, not Title Case: this is a status line, not a heading, and
    // "Checking calendar events" reads like English where "Calendar Events"
    // reads like a menu item. An all-caps run is left alone so `URL` survives.
    .split(' ')
    .map((w, i) => {
      if (w.length > 1 && w === w.toUpperCase()) return w;
      const lower = w.toLowerCase();
      return i === 0 ? lower.replace(/^./, (c) => c.toUpperCase()) : lower;
    })
    .join(' ');
}

type Describer = (input: Record<string, unknown>) => string;

/**
 * Keyed on the BARE tool name, so a tool keeps its phrasing whether it arrives
 * as `SearchWeb`, `mcp__aime__SearchWeb` or `aime__SearchWeb` — which it does,
 * depending on the surface and the transport.
 */
const DESCRIBERS: Record<string, Describer> = {
  searchweb: (i) => {
    const q = short(i.query ?? i.q);
    return q ? `Searching the web for “${q}”` : 'Searching the web';
  },
  web_search: (i) => {
    const q = short(i.query ?? i.q);
    return q ? `Searching the web for “${q}”` : 'Searching the web';
  },
  websearch: (i) => {
    const q = short(i.query ?? i.q);
    return q ? `Searching the web for “${q}”` : 'Searching the web';
  },
  fetchurl: (i) => {
    const h = host(i.url);
    return h ? `Reading ${h}` : 'Reading a page';
  },
  webfetch: (i) => {
    const h = host(i.url);
    return h ? `Reading ${h}` : 'Reading a page';
  },
  read: (i) => {
    const f = basename(i.file_path ?? i.path ?? i.notebook_path);
    return f ? `Reading ${f}` : 'Reading a file';
  },
  write: (i) => {
    const f = basename(i.file_path ?? i.path);
    return f ? `Writing ${f}` : 'Writing a file';
  },
  edit: (i) => {
    const f = basename(i.file_path ?? i.path);
    return f ? `Editing ${f}` : 'Editing a file';
  },
  glob: (i) => {
    const p = short(i.pattern);
    return p ? `Looking for ${p}` : 'Looking through files';
  },
  grep: (i) => {
    const p = short(i.pattern);
    return p ? `Searching files for “${p}”` : 'Searching files';
  },
  bash: (i) => {
    const c = short(i.command, 40);
    return c ? `Running \`${c}\`` : 'Running a command';
  },
  createimage: (i) => {
    const p = short(i.prompt ?? i.description, 40);
    return p ? `Generating an image of ${p}` : 'Generating an image';
  },
  skill: (i) => {
    const s = short(i.command ?? i.name ?? i.skill, 30);
    return s ? `Using the ${s} skill` : 'Using a skill';
  },
  mailsearch: () => 'Searching your mail',
  mailread: () => 'Reading an email',
  maildraft: () => 'Drafting an email',
  calendarevents: () => 'Checking your calendar',
  contactssearch: () => 'Looking up a contact',
  askuserquestion: () => 'Waiting on your answer',
  todowrite: () => 'Updating its plan',
  documentcreate: () => 'Creating a document',
  excelread: () => 'Reading a spreadsheet',
  excelwrite: () => 'Writing a spreadsheet',
  exceledit: () => 'Editing a spreadsheet',
  spawn_agent: (i) => {
    const a = short(i.agentName, 24);
    return a ? `Handing off to the ${a} agent` : 'Handing off to a subagent';
  },
};

/**
 * One line describing a tool call.
 *
 * Falls back to the de-prefixed tool name rather than to the raw symbol: a tool
 * this does not know about is far likelier to be a new one than a bug, and
 * "Calendar events" beats `mcp__aime__CalendarEvents` even with no describer.
 */
export function describeToolActivity(name: unknown, input?: unknown): string {
  if (typeof name !== 'string' || !name.trim()) return 'Working';
  const bare = name.replace(/^mcp__[^_]+(?:__)?/, '').replace(/^[a-z-]+__/, '') || name;
  const fn = DESCRIBERS[bare.toLowerCase()];
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (fn) {
    try {
      return fn(args);
    } catch {
      // A malformed input must not blank the status line.
    }
  }
  return baseToolLabel(name);
}

/**
 * The status line for a set of tool calls — what the summary bar shows.
 *
 * Named for the CURRENT activity rather than counted, because "7 actions
 * completed" answers a question nobody asked while the interesting one ("what
 * is it doing right now?") goes unanswered.
 */
export function describeToolProgress(
  toolCalls: ReadonlyArray<{ name: string; input?: Record<string, unknown>; status: string }>,
): string {
  const running = toolCalls.filter((t) => t.status === 'running');
  const finished = toolCalls.length - running.length;

  if (running.length > 0) {
    const current = running[running.length - 1];
    const doing = describeToolActivity(current.name, current.input);
    // The count is context, not the headline, and only once there is one.
    return finished > 0 ? `${doing} · ${finished} done` : doing;
  }

  const errored = toolCalls.filter((t) => t.status === 'error').length;
  const total = toolCalls.length;
  const plural = total === 1 ? '' : 's';
  if (errored > 0) return `${total} step${plural} (${errored} failed)`;
  if (total === 0) return 'Working';

  // Finished: name the LAST thing done, so the collapsed row still says
  // something about this turn rather than only how many things happened.
  const last = describeToolActivity(toolCalls[total - 1].name, toolCalls[total - 1].input);
  return `${total} step${plural} · ${last}`;
}
