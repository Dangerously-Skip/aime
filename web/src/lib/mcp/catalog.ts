/**
 * One-click MCP servers (P3.6d).
 *
 * Every entry here was verified by actually completing OAuth discovery against
 * the live endpoint — RFC 9728 protected-resource metadata, then RFC 8414
 * authorization-server metadata, checking for a `registration_endpoint`. Run
 * `npx tsx scripts/probe-dcr.ts` to re-verify; that script uses the app's own
 * discovery code, so a pass means AIME can genuinely connect with zero
 * configuration rather than that a vendor announcement claimed it could.
 *
 * The probe also confirms its own trustworthiness: it independently agrees with
 * the connector registry that Atlassian, Figma and Miro do DCR and that Slack
 * does not.
 *
 * This is the substance of DR-9. Nobody registers an OAuth app — not us, not the
 * user, not a broker holding tokens — and the list grew from 3 services to 20
 * without shipping a single new connector.
 *
 * `verifiedAt` is recorded because this is a claim about someone else's server
 * that can stop being true. A stale entry degrades to the normal add-by-URL
 * flow, which surfaces a real error, rather than silently misleading anyone.
 */

/** Coarse grouping for the picker. */
export type CatalogCategory =
  | 'work-tracking'
  | 'design'
  | 'developer'
  | 'payments'
  | 'business';

export interface CatalogServer {
  /** Slug used as the MCP server name; must satisfy sanitizePluginName. */
  id: string;
  name: string
  url: string;
  category: CatalogCategory;
  description: string;
  /**
   * True when the service can move money or change billing. Not a warning about
   * the vendor — a signal that one-click connection deserves a visible caution,
   * since the granted scope is wider than most.
   */
  handlesMoney?: boolean;
}

/** ISO date of the last successful probe run for this list. */
export const CATALOG_VERIFIED_AT = '2026-07-27';

export const CATALOG_CATEGORY_LABELS: Record<CatalogCategory, string> = {
  'work-tracking': 'Work tracking',
  design: 'Design',
  developer: 'Developer tools',
  payments: 'Payments',
  business: 'Business',
};

/**
 * Probe-verified DCR servers. Atlassian, Figma, Miro and Slack are deliberately
 * ABSENT: they already exist as first-class connectors with logos and bespoke
 * handling, so listing them twice would be confusing.
 */
export const MCP_CATALOG: CatalogServer[] = [
  // ── Work tracking ────────────────────────────────────────────────────────
  {
    id: 'linear',
    name: 'Linear',
    url: 'https://mcp.linear.app/mcp',
    category: 'work-tracking',
    description: 'Issues, projects and cycles',
  },
  {
    id: 'notion',
    name: 'Notion',
    url: 'https://mcp.notion.com/mcp',
    category: 'work-tracking',
    description: 'Pages, databases and wikis',
  },
  {
    id: 'asana',
    name: 'Asana',
    url: 'https://mcp.asana.com/sse',
    category: 'work-tracking',
    description: 'Tasks, projects and portfolios',
  },

  // ── Design ───────────────────────────────────────────────────────────────
  {
    id: 'canva',
    name: 'Canva',
    url: 'https://mcp.canva.com/mcp',
    category: 'design',
    description: 'Designs, brand templates and exports',
  },
  {
    id: 'webflow',
    name: 'Webflow',
    url: 'https://mcp.webflow.com/sse',
    category: 'design',
    description: 'Sites, CMS collections and publishing',
  },

  // ── Developer tools ──────────────────────────────────────────────────────
  {
    id: 'sentry',
    name: 'Sentry',
    url: 'https://mcp.sentry.dev/mcp',
    category: 'developer',
    description: 'Errors, issues and releases',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    url: 'https://mcp.cloudflare.com/mcp',
    category: 'developer',
    description: 'DNS, Workers, and account configuration',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    url: 'https://mcp.vercel.com',
    category: 'developer',
    description: 'Deployments, projects and logs',
  },
  {
    id: 'neon',
    name: 'Neon',
    url: 'https://mcp.neon.tech/sse',
    category: 'developer',
    description: 'Postgres databases and branches',
  },
  {
    id: 'semgrep',
    name: 'Semgrep',
    url: 'https://mcp.semgrep.ai/mcp',
    category: 'developer',
    description: 'Static analysis and security findings',
  },
  {
    id: 'apify',
    name: 'Apify',
    url: 'https://mcp.apify.com',
    category: 'developer',
    description: 'Web scraping and automation actors',
  },

  // ── Payments ─────────────────────────────────────────────────────────────
  {
    id: 'stripe',
    name: 'Stripe',
    url: 'https://mcp.stripe.com',
    category: 'payments',
    description: 'Customers, payments and subscriptions',
    handlesMoney: true,
  },
  {
    id: 'paypal',
    name: 'PayPal',
    url: 'https://mcp.paypal.com/mcp',
    category: 'payments',
    description: 'Orders, invoices and payouts',
    handlesMoney: true,
  },
  {
    id: 'square',
    name: 'Square',
    url: 'https://mcp.squareup.com/sse',
    category: 'payments',
    description: 'Catalog, orders and payments',
    handlesMoney: true,
  },

  // ── Business ─────────────────────────────────────────────────────────────
  {
    id: 'intercom',
    name: 'Intercom',
    url: 'https://mcp.intercom.com/mcp',
    category: 'business',
    description: 'Conversations, contacts and help centre',
  },
  {
    id: 'zapier',
    name: 'Zapier',
    url: 'https://mcp.zapier.com/api/mcp/mcp',
    category: 'business',
    description: 'Bridges thousands of apps through one connection',
  },
  {
    id: 'supermemory',
    name: 'Supermemory',
    url: 'https://mcp.supermemory.ai/',
    category: 'business',
    description: 'Personal knowledge store',
  },
];

/**
 * Servers the probe found do NOT support DCR, kept so the UI can explain why they
 * are absent instead of leaving the user wondering.
 */
export const CATALOG_EXCLUSIONS: Array<{ name: string; reason: string }> = [
  { name: 'HubSpot', reason: 'Has OAuth but no dynamic registration — needs an app registered with HubSpot first.' },
  { name: 'DeepWiki', reason: 'Publishes no OAuth metadata; connect it as an unauthenticated server instead.' },
  { name: 'Slack', reason: 'Available as a built-in connector, which supplies the client id Slack requires.' },
];

export function catalogByCategory(): Array<{
  category: CatalogCategory;
  label: string;
  servers: CatalogServer[];
}> {
  const order: CatalogCategory[] = ['work-tracking', 'design', 'developer', 'business', 'payments'];
  return order
    .map((category) => ({
      category,
      label: CATALOG_CATEGORY_LABELS[category],
      servers: MCP_CATALOG.filter((s) => s.category === category),
    }))
    .filter((g) => g.servers.length > 0);
}

export function findCatalogServer(id: string): CatalogServer | undefined {
  return MCP_CATALOG.find((s) => s.id === id);
}
