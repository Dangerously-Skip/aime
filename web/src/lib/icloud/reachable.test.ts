import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The protocol layer worked and nothing could reach it.
 *
 * `config`, `mail`, `dav` and `parse` shipped tested — and with no MCP tools and
 * no way to enter a credential, the whole thing was dead code. That is the shape
 * of failure this codebase keeps finding: `searchSettings` plumbed through the
 * route and the provider with no client populating it; `POST /api/abort` built
 * and tested and never called; `CreateImage` working and advertised nowhere.
 *
 * Each of those passed its own unit tests. What none of them had was a test
 * asserting the capability was REACHABLE, which is what these are.
 */

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf-8');
const provider = () => read('src/lib/providers/claude-provider.ts');

const TOOLS = ['MailSearch', 'MailRead', 'MailDraft', 'CalendarEvents', 'ContactsSearch'];

describe('the tools exist on the MCP server', () => {
  it.each(TOOLS)('%s is registered', (name) => {
    expect(provider(), `${name} is not registered — the agent cannot call it`).toMatch(
      new RegExp(`'${name}'`),
    );
  });

  /**
   * Mounted only when a credential is stored. Offering five tools that all
   * answer "not configured" costs a turn to discover what we already knew.
   */
  it('is gated on a stored credential', () => {
    expect(provider()).toMatch(/\.\.\.\(icloudCreds\s*\n?\s*\?/);
    expect(provider()).toMatch(/loadICloudCredentials\(\)/);
  });

  /** A profile that silently withheld them looks like the connector broke. */
  it.each(TOOLS)('%s survives the coding tool profile', (name) => {
    const route = read('src/app/api/chat/[surfaceId]/route.ts');
    const coding = /coding:\s*\[([\s\S]*?)\n\s*\],/.exec(route)?.[1] ?? '';
    expect(coding, `the coding profile withholds ${name}`).toContain(`mcp__aime__${name}`);
  });
});

describe('a credential can actually be entered', () => {
  it('there is a route to connect, check and disconnect', () => {
    const route = read('src/app/api/icloud/connect/route.ts');
    for (const verb of ['GET', 'POST', 'DELETE']) {
      expect(route, `no ${verb} handler`).toMatch(new RegExp(`export async function ${verb}`));
    }
  });

  /**
   * Verified BEFORE storing. A credential iCloud rejects is worse than none: it
   * looks connected, and every tool then fails later with an auth error the user
   * has to trace back to Settings.
   */
  it('tests the credential against the real server before saving it', () => {
    const route = read('src/app/api/icloud/connect/route.ts');
    const postBody = /export async function POST[\s\S]*?\n\}/.exec(route)?.[0] ?? '';
    expect(postBody).toMatch(/searchMail\(/);
    expect(
      postBody.indexOf('searchMail('),
      'the credential is stored before it is verified',
    ).toBeLessThan(postBody.indexOf('.set('));
  });

  it('never returns the password, only whether one exists', () => {
    const route = read('src/app/api/icloud/connect/route.ts');
    const getBody = /export async function GET[\s\S]*?\n\}/.exec(route)?.[0] ?? '';
    expect(getBody).toMatch(/connected:/);
    expect(getBody, 'the app-specific password is readable over HTTP').not.toMatch(
      /appPassword:\s*rec/,
    );
  });

  /**
   * In the Connectors catalogue, not Settings.
   *
   * It first shipped as a Settings section on the reasoning that everything in
   * Connectors is OAuth and this is not. That is an implementation detail the
   * user should never have to know: "connect my email" belongs where the other
   * services are. The auth type carries the difference instead.
   */
  it('is a connector, listed in the catalogue', async () => {
    const { CONNECTOR_MAP } = await import('@/lib/connectors/registry');
    const c = CONNECTOR_MAP.icloud;
    expect(c, 'iCloud is not in the connector registry').toBeDefined();
    expect(c.auth.type).toBe('app-password');
    // Its tools are in-process, so it has nothing to provision.
    expect(c.mcp, 'iCloud declares an MCP server it does not have').toBeUndefined();
  });

  it('the catalogue knows how to connect it', () => {
    const browse = read('src/components/customize/browse-connectors.tsx');
    expect(browse, 'the Connectors view has no branch for app-password').toContain(
      "auth.type === 'app-password'",
    );
    expect(browse).toContain('/api/icloud/connect');
  });

  it('is not left behind in Settings as a second way in', () => {
    expect(read('src/components/settings/settings-nav.tsx')).not.toMatch(/id:\s*"icloud"/);
  });
});

/**
 * The security property, restated where the UI makes the claim. A user reading
 * "it cannot send" should be able to rely on it, and the only thing that makes
 * that true is the absence of a send path.
 */
describe('draft-only survives the wiring', () => {
  it('no send tool was added alongside the draft one', () => {
    const p = provider();
    expect(p).not.toMatch(/'MailSend'|'SendMail'/);
  });

  it('the draft tool tells the model to say it was not sent', () => {
    const p = provider();
    const draft = /'MailDraft'[\s\S]{0,2000}/.exec(p)?.[0] ?? '';
    expect(draft).toMatch(/NOT sent|not been sent/i);
  });

  /**
   * Stated where the user decides to connect it. The guarantee is only worth
   * having if the person granting access can see it.
   */
  it('the connector card says it cannot send', async () => {
    const { CONNECTOR_MAP } = await import('@/lib/connectors/registry');
    expect(CONNECTOR_MAP.icloud.description).toMatch(/cannot send/i);
  });

  /** And the connect dialog explains which password is wanted. */
  it('the hint distinguishes an app-specific password from the account one', async () => {
    const { CONNECTOR_MAP } = await import('@/lib/connectors/registry');
    expect(CONNECTOR_MAP.icloud.auth.hint).toMatch(/appleid\.apple\.com/);
    expect(CONNECTOR_MAP.icloud.auth.hint).toMatch(/not your Apple ID password/i);
  });
});

/**
 * An empty inbox and a broken connection must not look alike. Conflating them is
 * what taught the model to invent URLs when search failed — the same lesson,
 * recorded in `SearchWeb`'s error text, applied here before it can repeat.
 */
describe('empty results are distinguishable from failures', () => {
  /**
   * Each tool's own block, bounded at the next tool definition. A fixed-size
   * window does not work: the first version used 3500 characters and spilled
   * into the NEXT tool, so `MailSearch` passed on `CalendarEvents`' wording and
   * the sabotage went undetected.
   */
  const toolBlock = (name: string): string => {
    /*
     * Comments stripped FIRST. The note explaining this rule necessarily
     * contains the phrase the rule looks for, so without this the assertion
     * matched the comment and the sabotage went green — the fourth time in this
     * codebase that a test has been satisfied by the prose justifying it.
     */
    const src = provider()
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*/gm, '$1');
    const start = src.indexOf(`'${name}'`);
    if (start === -1) return '';
    const next = src.indexOf('(tool as any)(', start);
    return src.slice(start, next === -1 ? src.length : next);
  };

  it.each(['MailSearch', 'CalendarEvents', 'ContactsSearch'])(
    '%s says an empty result is real',
    (name) => {
      expect(toolBlock(name), `${name} does not distinguish empty from broken`).toMatch(
        /real empty result/i,
      );
    },
  );
});

/**
 * Mounted is not the same as known about.
 *
 * Reported: "whats my latest email from First Advantage about" → the agent
 * replied that it could not connect to Microsoft 365 Mail and that the connector
 * was not set up. iCloud WAS connected and all five tools were mounted. The
 * system prompt is what misled it: `buildConnectorsPrompt` lists the OAuth
 * registry, iCloud is not in it, so the model was told nothing was connected and
 * shown M365 on the offer list. It reached for the thing it had been told about.
 *
 * Exactly the `CreateImage` failure again — a working capability advertised
 * nowhere the model reads.
 */
describe('the model is told iCloud is connected', () => {
  it('says so, and names the tools', async () => {
    const { buildConnectorsPrompt } = await import('@/lib/connectors/prompt');
    const text = buildConnectorsPrompt([], new Set(), { canRequest: true, icloudConnected: true });
    expect(text, 'the prompt never mentions iCloud').toMatch(/iCloud/);
    for (const t of TOOLS) expect(text).toContain(t);
  });

  /**
   * The active harm, not just the omission: being told nothing is connected is
   * what sent it looking for another mail provider.
   */
  it('does not claim nothing is connected while iCloud is', async () => {
    const { buildConnectorsPrompt } = await import('@/lib/connectors/prompt');
    const text = buildConnectorsPrompt([], new Set(), { canRequest: true, icloudConnected: true });
    expect(text).not.toMatch(/Nothing is connected yet/);
  });

  it('tells it not to go offering another mail service', async () => {
    const { buildConnectorsPrompt } = await import('@/lib/connectors/prompt');
    const text = buildConnectorsPrompt([], new Set(), { canRequest: true, icloudConnected: true });
    expect(text).toMatch(/do not offer to connect another mail service/i);
  });

  it('stays silent when iCloud is not connected', async () => {
    const { buildConnectorsPrompt } = await import('@/lib/connectors/prompt');
    const text = buildConnectorsPrompt([], new Set(), { canRequest: true, icloudConnected: false });
    expect(text).not.toMatch(/iCloud/);
  });

  it('is actually passed from the chat route, not merely supported', () => {
    const route = read('src/app/api/chat/[surfaceId]/route.ts');
    expect(route, 'the route never sets icloudConnected — the flag is dead').toMatch(
      /icloudConnected:/,
    );
    expect(route).toMatch(/loadICloudCredentials\(\)/);
  });
});

/**
 * Connected, and the card still said "Connect".
 *
 * The credential was stored and verified — `GET /api/icloud/connect` answered
 * `{connected: true, appleId: …}` — while the Connectors row offered to connect
 * it again. The UI hydrates from `/api/connectors/hydrate`, which reads
 * `config.mcpServers`. That was a complete definition of "connected" for as long
 * as every connector was an MCP server; iCloud provisions nothing there by
 * design, so it was structurally invisible to the only source the card consults.
 *
 * The same shape as the connectors PROMPT missing it: a second place that
 * enumerates connectors from the MCP config and therefore cannot see one that
 * does not live there.
 */
describe('a credential-backed connector shows as connected', () => {
  it('hydrate reports connectors that have no MCP entry', () => {
    const route = read('src/app/api/connectors/hydrate/route.ts');
    expect(route).toMatch(/loadICloudCredentials/);
    /*
     * The SUCCESS return specifically. Checking only that the helper is
     * mentioned somewhere in the file passes while the happy path ignores it —
     * verified by sabotage, which is how this assertion came to be this narrow.
     */
    const success = /return Response\.json\(\{ connectedIds: \[\.\.\.ids[^)]*\)/.exec(route)?.[0] ?? '';
    expect(success, 'the normal path does not include credential-backed ids').toMatch(
      /credentialBackedIds/,
    );
  });

  /**
   * Including when there is no MCP config at all. A fresh install has no file,
   * the read throws, and the catch used to return an empty list — so the one
   * connector that does not need the file would have been hidden by its absence.
   */
  it('reports it even when the MCP config cannot be read', () => {
    const route = read('src/app/api/connectors/hydrate/route.ts');
    const cat = /\} catch \{[\s\S]*?\n\}/.exec(route)?.[0] ?? '';
    expect(cat, 'the failure path drops credential-backed connectors').toMatch(
      /credentialBackedIds/,
    );
  });
});

/**
 * "Could it be because email is being masked on entry?" — a good catch, and a
 * real bug even though it was not the cause. The shared dialog defaults to
 * `type="password"` because it was built for API tokens; an Apple ID is an
 * address the user needs to read back to confirm they typed the right account.
 */
describe('the connect dialog asks for the right kinds of value', () => {
  it('does not mask the Apple ID', () => {
    const browse = read('src/components/customize/browse-connectors.tsx');
    const branch = /auth\.type === 'app-password'[\s\S]{0,1400}/.exec(browse)?.[0] ?? '';
    const appleIdPrompt = /label: 'Apple ID'[\s\S]{0,300}/.exec(branch)?.[0] ?? '';
    expect(appleIdPrompt, 'the Apple ID field inherits the password default').toMatch(
      /inputType: 'email'/,
    );
  });

  it('still masks the app-specific password', () => {
    const browse = read('src/components/customize/browse-connectors.tsx');
    const branch = /auth\.type === 'app-password'[\s\S]{0,1400}/.exec(browse)?.[0] ?? '';
    const pw = /label: 'App-specific password'[\s\S]{0,300}/.exec(branch)?.[0] ?? '';
    expect(pw).toMatch(/inputType: 'password'/);
  });
});
