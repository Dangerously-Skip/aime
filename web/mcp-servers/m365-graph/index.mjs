#!/usr/bin/env node
/**
 * Minimal Microsoft Graph MCP server.
 * Hand-rolls JSON-RPC over stdio so it has zero npm dependencies —
 * ships as a single file Quarry spawns via `node`.
 *
 * Auth: reads GRAPH_ACCESS_TOKEN env var (provisioned + auto-refreshed
 * by Quarry's OAuth layer). Each tool call uses that token; on 401 we
 * exit so the caller picks up the refreshed token on next spawn.
 */

const TOKEN = process.env.GRAPH_ACCESS_TOKEN;
if (!TOKEN) {
  process.stderr.write('GRAPH_ACCESS_TOKEN required\n');
  process.exit(1);
}

const GRAPH = 'https://graph.microsoft.com/v1.0';

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function ok(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function err(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function graph(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${GRAPH}${path}`;
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
  if (!res.ok) {
    throw new Error(`Graph ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : {};
}

// ── Tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_me',
    description: 'Get the signed-in user\'s profile (name, email, job title, manager).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_messages',
    description: 'List recent messages from the signed-in user\'s inbox. Returns subject, from, received time, preview.',
    inputSchema: {
      type: 'object',
      properties: {
        top: { type: 'number', description: 'Number of messages (default 20, max 50)' },
        folder: { type: 'string', description: 'Folder name (default "inbox"). Use "sentitems" for sent mail.' },
      },
    },
  },
  {
    name: 'search_messages',
    description: 'Full-text search across all mail folders. Uses Graph $search (KQL). Returns up to 25 matches.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query, e.g. "from:alice subject:release"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_message',
    description: 'Get the full body of a single message by its Graph id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Message id from list_messages/search_messages' } },
      required: ['id'],
    },
  },
  {
    name: 'send_mail',
    description: 'Send an email from the signed-in user.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string' }, description: 'Recipient email addresses' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Plain text or HTML body' },
        contentType: { type: 'string', enum: ['text', 'html'], description: 'Body content type (default text)' },
        cc: { type: 'array', items: { type: 'string' } },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'list_calendar_events',
    description: 'List upcoming calendar events for the signed-in user in a time window.',
    inputSchema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'ISO 8601 start time (default: now)' },
        end: { type: 'string', description: 'ISO 8601 end time (default: now + 7 days)' },
        top: { type: 'number', description: 'Max events (default 25)' },
      },
    },
  },
  {
    name: 'create_calendar_event',
    description: 'Create a new calendar event.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string' },
        start: { type: 'string', description: 'ISO 8601 start time' },
        end: { type: 'string', description: 'ISO 8601 end time' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee email addresses' },
        body: { type: 'string', description: 'Meeting description (plain text)' },
        location: { type: 'string', description: 'Meeting location or Teams link' },
      },
      required: ['subject', 'start', 'end'],
    },
  },
];

// ── Tool implementations ────────────────────────────────────────────────────

async function callTool(name, args = {}) {
  switch (name) {
    case 'get_me': {
      const me = await graph('/me?$select=displayName,mail,userPrincipalName,jobTitle,officeLocation');
      return me;
    }

    case 'list_messages': {
      const top = Math.min(args.top ?? 20, 50);
      const folder = args.folder || 'inbox';
      const qs = new URLSearchParams({
        $top: String(top),
        $select: 'id,subject,from,receivedDateTime,bodyPreview,isRead,hasAttachments',
        $orderby: 'receivedDateTime desc',
      });
      const res = await graph(`/me/mailFolders/${encodeURIComponent(folder)}/messages?${qs}`);
      return (res.value || []).map((m) => ({
        id: m.id,
        subject: m.subject,
        from: m.from?.emailAddress?.address,
        received: m.receivedDateTime,
        preview: m.bodyPreview,
        isRead: m.isRead,
        hasAttachments: m.hasAttachments,
      }));
    }

    case 'search_messages': {
      if (!args.query) throw new Error('query is required');
      // Graph $search requires ConsistencyLevel: eventual
      const qs = new URLSearchParams({
        $search: `"${args.query.replace(/"/g, '\\"')}"`,
        $top: '25',
        $select: 'id,subject,from,receivedDateTime,bodyPreview',
      });
      const res = await graph(`/me/messages?${qs}`, {
        headers: { ConsistencyLevel: 'eventual' },
      });
      return (res.value || []).map((m) => ({
        id: m.id,
        subject: m.subject,
        from: m.from?.emailAddress?.address,
        received: m.receivedDateTime,
        preview: m.bodyPreview,
      }));
    }

    case 'get_message': {
      if (!args.id) throw new Error('id is required');
      const m = await graph(`/me/messages/${encodeURIComponent(args.id)}`);
      return {
        id: m.id,
        subject: m.subject,
        from: m.from?.emailAddress?.address,
        to: (m.toRecipients || []).map((r) => r.emailAddress?.address),
        cc: (m.ccRecipients || []).map((r) => r.emailAddress?.address),
        received: m.receivedDateTime,
        body: m.body?.content,
        bodyType: m.body?.contentType,
      };
    }

    case 'send_mail': {
      if (!args.to?.length || !args.subject || !args.body) {
        throw new Error('to, subject, body are required');
      }
      const contentType = args.contentType === 'html' ? 'HTML' : 'Text';
      const payload = {
        message: {
          subject: args.subject,
          body: { contentType, content: args.body },
          toRecipients: args.to.map((a) => ({ emailAddress: { address: a } })),
          ...(args.cc?.length
            ? { ccRecipients: args.cc.map((a) => ({ emailAddress: { address: a } })) }
            : {}),
        },
        saveToSentItems: true,
      };
      await graph('/me/sendMail', { method: 'POST', body: JSON.stringify(payload) });
      return { sent: true, to: args.to, subject: args.subject };
    }

    case 'list_calendar_events': {
      const start = args.start || new Date().toISOString();
      const end = args.end || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const top = args.top ?? 25;
      const qs = new URLSearchParams({
        startDateTime: start,
        endDateTime: end,
        $top: String(top),
        $select: 'id,subject,start,end,location,attendees,organizer,bodyPreview,onlineMeeting',
        $orderby: 'start/dateTime',
      });
      const res = await graph(`/me/calendarView?${qs}`);
      return (res.value || []).map((e) => ({
        id: e.id,
        subject: e.subject,
        start: e.start?.dateTime,
        end: e.end?.dateTime,
        location: e.location?.displayName,
        organizer: e.organizer?.emailAddress?.address,
        attendees: (e.attendees || []).map((a) => a.emailAddress?.address),
        preview: e.bodyPreview,
        joinUrl: e.onlineMeeting?.joinUrl,
      }));
    }

    case 'create_calendar_event': {
      if (!args.subject || !args.start || !args.end) {
        throw new Error('subject, start, end are required');
      }
      const payload = {
        subject: args.subject,
        start: { dateTime: args.start, timeZone: 'UTC' },
        end: { dateTime: args.end, timeZone: 'UTC' },
        ...(args.body ? { body: { contentType: 'Text', content: args.body } } : {}),
        ...(args.location ? { location: { displayName: args.location } } : {}),
        ...(args.attendees?.length
          ? {
              attendees: args.attendees.map((a) => ({
                emailAddress: { address: a },
                type: 'required',
              })),
            }
          : {}),
      };
      const ev = await graph('/me/events', { method: 'POST', body: JSON.stringify(payload) });
      return { id: ev.id, subject: ev.subject, webLink: ev.webLink };
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
        serverInfo: { name: 'm365-graph', version: '1.0.0' },
        capabilities: { tools: {} },
      });
    } else if (method === 'notifications/initialized') {
      // No response to notifications
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
      // Unknown method — return error with correct JSON-RPC code
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
      process.stderr.write(`[m365-graph] parse error: ${e.message}\n`);
    }
  }
});

process.stdin.on('end', () => process.exit(0));
