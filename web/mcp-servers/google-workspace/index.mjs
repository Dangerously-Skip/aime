#!/usr/bin/env node
/**
 * Minimal Google Workspace MCP server.
 * Zero-dep JSON-RPC over stdio. Shared by the "Google Workspace (nib)"
 * and "Google (Personal)" connector tiles — the connector just passes
 * the appropriate access token via GOOGLE_ACCESS_TOKEN.
 *
 * Covers Gmail + Calendar + Drive at read-heavy surface area; writes
 * are limited to send_mail + create_event + upload_file to keep the
 * consent surface tight.
 */

const TOKEN = process.env.GOOGLE_ACCESS_TOKEN;
if (!TOKEN) {
  process.stderr.write('GOOGLE_ACCESS_TOKEN required\n');
  process.exit(1);
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}
function ok(id, result) { send({ jsonrpc: '2.0', id, result }); }
function err(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url.split('/').pop()} ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

// ── Tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  // Gmail
  {
    name: 'gmail_list_messages',
    description: 'List recent Gmail messages. Returns id, subject, from, snippet for each.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query (e.g. "from:alice is:unread"). Default: inbox.' },
        maxResults: { type: 'number', description: 'Max messages (default 20, max 50)' },
      },
    },
  },
  {
    name: 'gmail_get_message',
    description: 'Get the full body of a Gmail message by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'gmail_send',
    description: 'Send an email from the signed-in Gmail account.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string' } },
        cc: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  // Calendar
  {
    name: 'calendar_list_events',
    description: 'List upcoming Google Calendar events in a time window.',
    inputSchema: {
      type: 'object',
      properties: {
        timeMin: { type: 'string', description: 'ISO 8601 start (default: now)' },
        timeMax: { type: 'string', description: 'ISO 8601 end (default: now + 7 days)' },
        calendarId: { type: 'string', description: 'Calendar id (default "primary")' },
        maxResults: { type: 'number', description: 'Max events (default 25)' },
      },
    },
  },
  {
    name: 'calendar_create_event',
    description: 'Create a Google Calendar event on the primary calendar.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        start: { type: 'string', description: 'ISO 8601 start' },
        end: { type: 'string', description: 'ISO 8601 end' },
        attendees: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' },
        location: { type: 'string' },
      },
      required: ['summary', 'start', 'end'],
    },
  },
  // Drive
  {
    name: 'drive_list_files',
    description: 'List or search Google Drive files. Returns id, name, mimeType, modified time.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Drive search query (e.g. "name contains \'report\'")' },
        pageSize: { type: 'number', description: 'Max results (default 25)' },
      },
    },
  },
  {
    name: 'drive_get_file_content',
    description: 'Download a Drive file\'s text content. Works for Docs/Sheets (exports to plain text) and plain-text files.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  // User
  {
    name: 'get_me',
    description: 'Get the signed-in user\'s Google profile (email, name).',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ── Gmail helpers ───────────────────────────────────────────────────────────

function decodeBase64Url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function extractPlainText(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.mimeType?.startsWith('text/') && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const text = extractPlainText(part);
      if (text) return text;
    }
  }
  return '';
}

function headerValue(headers, name) {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function buildRfc822(args) {
  const lines = [
    `To: ${args.to.join(', ')}`,
    ...(args.cc?.length ? [`Cc: ${args.cc.join(', ')}`] : []),
    `Subject: ${args.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    args.body,
  ];
  const raw = lines.join('\r\n');
  return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Tool implementations ────────────────────────────────────────────────────

async function callTool(name, args = {}) {
  switch (name) {
    case 'get_me': {
      return api('https://www.googleapis.com/oauth2/v2/userinfo');
    }

    case 'gmail_list_messages': {
      const maxResults = Math.min(args.maxResults ?? 20, 50);
      const qs = new URLSearchParams({ maxResults: String(maxResults) });
      if (args.query) qs.set('q', args.query);
      const list = await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${qs}`);
      if (!list.messages?.length) return [];
      const details = await Promise.all(
        list.messages.slice(0, maxResults).map((m) =>
          api(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          ),
        ),
      );
      return details.map((d) => ({
        id: d.id,
        threadId: d.threadId,
        subject: headerValue(d.payload?.headers, 'Subject'),
        from: headerValue(d.payload?.headers, 'From'),
        date: headerValue(d.payload?.headers, 'Date'),
        snippet: d.snippet,
        unread: d.labelIds?.includes('UNREAD') ?? false,
      }));
    }

    case 'gmail_get_message': {
      if (!args.id) throw new Error('id is required');
      const msg = await api(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(args.id)}?format=full`,
      );
      return {
        id: msg.id,
        threadId: msg.threadId,
        subject: headerValue(msg.payload?.headers, 'Subject'),
        from: headerValue(msg.payload?.headers, 'From'),
        to: headerValue(msg.payload?.headers, 'To'),
        date: headerValue(msg.payload?.headers, 'Date'),
        body: extractPlainText(msg.payload),
      };
    }

    case 'gmail_send': {
      if (!args.to?.length || !args.subject || !args.body) {
        throw new Error('to, subject, body are required');
      }
      const raw = buildRfc822(args);
      const res = await api('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        body: JSON.stringify({ raw }),
      });
      return { id: res.id, threadId: res.threadId, sent: true };
    }

    case 'calendar_list_events': {
      const timeMin = args.timeMin || new Date().toISOString();
      const timeMax = args.timeMax || new Date(Date.now() + 7 * 86400_000).toISOString();
      const calendarId = args.calendarId || 'primary';
      const qs = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: String(args.maxResults ?? 25),
      });
      const res = await api(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${qs}`,
      );
      return (res.items || []).map((e) => ({
        id: e.id,
        summary: e.summary,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        location: e.location,
        attendees: (e.attendees || []).map((a) => a.email),
        organizer: e.organizer?.email,
        hangoutLink: e.hangoutLink,
        htmlLink: e.htmlLink,
      }));
    }

    case 'calendar_create_event': {
      if (!args.summary || !args.start || !args.end) throw new Error('summary, start, end are required');
      const payload = {
        summary: args.summary,
        start: { dateTime: args.start },
        end: { dateTime: args.end },
        ...(args.description ? { description: args.description } : {}),
        ...(args.location ? { location: args.location } : {}),
        ...(args.attendees?.length
          ? { attendees: args.attendees.map((email) => ({ email })) }
          : {}),
      };
      const res = await api(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        { method: 'POST', body: JSON.stringify(payload) },
      );
      return { id: res.id, htmlLink: res.htmlLink, summary: res.summary };
    }

    case 'drive_list_files': {
      const pageSize = args.pageSize ?? 25;
      const qs = new URLSearchParams({
        pageSize: String(pageSize),
        fields: 'files(id,name,mimeType,modifiedTime,webViewLink,owners(emailAddress))',
      });
      if (args.query) qs.set('q', args.query);
      const res = await api(`https://www.googleapis.com/drive/v3/files?${qs}`);
      return (res.files || []).map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modified: f.modifiedTime,
        webLink: f.webViewLink,
        owner: f.owners?.[0]?.emailAddress,
      }));
    }

    case 'drive_get_file_content': {
      if (!args.id) throw new Error('id is required');
      // Peek at mimeType to decide between export (Google Docs types) and download
      const meta = await api(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.id)}?fields=id,name,mimeType`,
      );
      let url;
      if (meta.mimeType?.startsWith('application/vnd.google-apps')) {
        // Google Doc/Sheet/Slide → export as plain text
        url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.id)}/export?mimeType=text/plain`;
      } else {
        url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.id)}?alt=media`;
      }
      const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
      if (!res.ok) throw new Error(`drive download ${res.status}: ${await res.text()}`);
      const content = await res.text();
      return { id: meta.id, name: meta.name, mimeType: meta.mimeType, content };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── JSON-RPC over stdio ─────────────────────────────────────────────────────

async function handleMessage(msg) {
  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      ok(id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'google-workspace', version: '1.0.0' },
        capabilities: { tools: {} },
      });
    } else if (method === 'notifications/initialized') {
      // no-op
    } else if (method === 'tools/list') {
      ok(id, { tools: TOOLS });
    } else if (method === 'tools/call') {
      const result = await callTool(params?.name, params?.arguments || {});
      ok(id, {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
      });
    } else if (method === 'ping') {
      ok(id, {});
    } else {
      err(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    err(id, -32000, e instanceof Error ? e.message : String(e));
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch (e) {
      process.stderr.write(`[google-workspace] parse error: ${e.message}\n`);
    }
  }
});

process.stdin.on('end', () => process.exit(0));
