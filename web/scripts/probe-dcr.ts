/**
 * Probe candidate remote MCP endpoints for Dynamic Client Registration support.
 *
 * Uses AIME's OWN discovery code (RFC 9728 → RFC 8414), so a pass here means the
 * app can genuinely connect to the server with zero configuration — not that a
 * blog post claimed it could. Run:
 *
 *   npx tsx scripts/probe-dcr.ts
 *
 * Network-dependent and therefore NOT part of the test suite; it is the tool that
 * produces the seed data for the catalogue, re-runnable when vendors change.
 */
import { discoverMcpOAuth } from '../src/lib/mcp/oauth-discovery';

const CANDIDATES: Array<{ name: string; url: string }> = [
  // Known-good baseline: these three are the only DCR servers already shipping,
  // so if the probe disagrees about them the probe is wrong.
  { name: 'Atlassian', url: 'https://mcp.atlassian.com/v1/mcp' },
  { name: 'Figma', url: 'https://mcp.figma.com/mcp' },
  { name: 'Miro', url: 'https://mcp.miro.com/' },
  // Known-negative baseline: Slack ships a public client_id precisely because it
  // has no DCR.
  { name: 'Slack', url: 'https://mcp.slack.com/mcp' },

  // Candidates from vendor announcements and the remote-MCP catalogues.
  { name: 'Linear', url: 'https://mcp.linear.app/mcp' },
  { name: 'Linear (sse)', url: 'https://mcp.linear.app/sse' },
  { name: 'Notion', url: 'https://mcp.notion.com/mcp' },
  { name: 'Asana', url: 'https://mcp.asana.com/sse' },
  { name: 'Intercom', url: 'https://mcp.intercom.com/mcp' },
  { name: 'Cloudflare', url: 'https://mcp.cloudflare.com/mcp' },
  { name: 'Sentry', url: 'https://mcp.sentry.dev/mcp' },
  { name: 'Webflow', url: 'https://mcp.webflow.com/sse' },
  { name: 'Canva', url: 'https://mcp.canva.com/mcp' },
  { name: 'Stripe', url: 'https://mcp.stripe.com' },
  { name: 'PayPal', url: 'https://mcp.paypal.com/mcp' },
  { name: 'HubSpot', url: 'https://mcp.hubspot.com/anthropic' },
  { name: 'Vercel', url: 'https://mcp.vercel.com' },
  { name: 'Neon', url: 'https://mcp.neon.tech/sse' },
  { name: 'Semgrep', url: 'https://mcp.semgrep.ai/mcp' },
  { name: 'Apify', url: 'https://mcp.apify.com' },
  { name: 'Supermemory', url: 'https://mcp.supermemory.ai/' },
  { name: 'DeepWiki', url: 'https://mcp.deepwiki.com/sse' },
  { name: 'Square', url: 'https://mcp.squareup.com/sse' },
  { name: 'Zapier', url: 'https://mcp.zapier.com/api/mcp/mcp' },
];

type Verdict = 'dcr' | 'oauth-no-dcr' | 'no-oauth' | 'unreachable';

interface Result {
  name: string;
  url: string;
  verdict: Verdict;
  registrationEndpoint?: string;
  authServer?: string;
  scopes?: number;
  detail?: string;
}

async function probe(name: string, url: string): Promise<Result> {
  try {
    const { serverMetadata, resourceMetadata } = await discoverMcpOAuth(url);
    if (!serverMetadata) {
      return { name, url, verdict: 'no-oauth', detail: 'no authorization server metadata' };
    }
    const reg = serverMetadata.registration_endpoint;
    return {
      name,
      url,
      verdict: reg ? 'dcr' : 'oauth-no-dcr',
      registrationEndpoint: reg,
      authServer: serverMetadata.issuer ?? serverMetadata.authorization_endpoint,
      scopes: (resourceMetadata?.scopes_supported ?? serverMetadata.scopes_supported)?.length,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { name, url, verdict: 'unreachable', detail: detail.slice(0, 140) };
  }
}

async function main() {
const results: Result[] = [];
for (const c of CANDIDATES) {
  const r = await probe(c.name, c.url);
  results.push(r);
  const mark = { dcr: 'DCR  ', 'oauth-no-dcr': 'oauth', 'no-oauth': '-----', unreachable: 'x    ' }[r.verdict];
  console.log(
    `${mark} ${r.name.padEnd(16)} ${r.url.padEnd(42)} ${r.registrationEndpoint ?? r.detail ?? ''}`,
  );
}

console.log('\n--- summary ---');
for (const verdict of ['dcr', 'oauth-no-dcr', 'no-oauth', 'unreachable'] as Verdict[]) {
  const names = results.filter((r) => r.verdict === verdict).map((r) => r.name);
  console.log(`${verdict}: ${names.length ? names.join(', ') : '(none)'}`);
}
console.log('\n--- json ---');
console.log(JSON.stringify(results.filter((r) => r.verdict === 'dcr'), null, 2));
}

void main();
