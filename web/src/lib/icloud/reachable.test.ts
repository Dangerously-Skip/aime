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

  it('is offered in Settings, with a nav entry that reaches it', () => {
    expect(read('src/components/settings/settings-dialog.tsx')).toMatch(/icloud:\s*ICloudSection/);
    expect(read('src/components/settings/settings-nav.tsx')).toMatch(/id:\s*"icloud"/);
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

  it('the Settings copy states it too', () => {
    expect(read('src/components/settings/sections/icloud-section.tsx')).toMatch(
      /cannot send/i,
    );
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
