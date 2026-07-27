import { describe, it, expect } from 'vitest';
import {
  MCP_CATALOG,
  CATALOG_EXCLUSIONS,
  CATALOG_VERIFIED_AT,
  catalogByCategory,
  findCatalogServer,
} from './catalog';
import { validateMcpServerUrl } from './url-guard';
import { sanitizePluginName } from './install-guard';
import { CONNECTOR_MAP } from '../connectors/registry';

/**
 * These tests cannot verify DCR support — that needs the network, and lives in
 * scripts/probe-dcr.ts. What they CAN guarantee is that every catalogue entry is
 * actually connectable by this app's own machinery: a URL the guard accepts and
 * an id the installer accepts. A catalogue entry that fails on click is worse
 * than no catalogue.
 */

describe('every catalogue entry is usable by the real code paths', () => {
  it.each(MCP_CATALOG.map((s) => [s.id, s.url] as const))(
    '%s has a URL the guard accepts',
    (_id, url) => {
      const verdict = validateMcpServerUrl(url);
      expect(verdict.ok, verdict.ok ? '' : verdict.message).toBe(true);
    },
  );

  it.each(MCP_CATALOG.map((s) => s.id))('%s has an id the installer accepts', (id) => {
    // The id becomes a directory, a clients-file key and an MCP entry key.
    expect(sanitizePluginName(id).ok).toBe(true);
  });

  it('uses https for every entry — no plaintext to a vendor', () => {
    for (const s of MCP_CATALOG) {
      expect(new URL(s.url).protocol, s.id).toBe('https:');
    }
  });

  it('has no duplicate ids or URLs', () => {
    expect(new Set(MCP_CATALOG.map((s) => s.id)).size).toBe(MCP_CATALOG.length);
    expect(new Set(MCP_CATALOG.map((s) => s.url)).size).toBe(MCP_CATALOG.length);
  });

  it('gives every entry a name and a description', () => {
    for (const s of MCP_CATALOG) {
      expect(s.name.length, s.id).toBeGreaterThan(0);
      expect(s.description.length, s.id).toBeGreaterThan(0);
    }
  });
});

describe('the catalogue does not duplicate built-in connectors', () => {
  it('omits services that already ship as first-class connectors', () => {
    // Atlassian, Figma and Miro are DCR too, but they have logos and bespoke
    // handling in the registry; listing them twice would confuse.
    for (const id of ['atlassian', 'figma', 'miro', 'slack', 'github']) {
      expect(findCatalogServer(id), id).toBeUndefined();
    }
  });

  it('never collides with a registry connector id', () => {
    for (const s of MCP_CATALOG) {
      expect(CONNECTOR_MAP[s.id], s.id).toBeUndefined();
    }
  });
});

describe('money-handling services are flagged', () => {
  it('marks the payment processors', () => {
    // One-click connection to a payment API grants wider scope than most, so the
    // UI needs to be able to say so. The per-tool policy (P3.6b) defaults their
    // consequential tools to always_ask.
    for (const id of ['stripe', 'paypal', 'square']) {
      expect(findCatalogServer(id)?.handlesMoney, id).toBe(true);
    }
  });

  it('does not flag anything else', () => {
    const flagged = MCP_CATALOG.filter((s) => s.handlesMoney).map((s) => s.id);
    expect(flagged.sort()).toEqual(['paypal', 'square', 'stripe']);
  });
});

describe('catalogByCategory', () => {
  it('groups every server exactly once', () => {
    const grouped = catalogByCategory().flatMap((g) => g.servers);
    expect(grouped).toHaveLength(MCP_CATALOG.length);
    expect(new Set(grouped.map((s) => s.id)).size).toBe(MCP_CATALOG.length);
  });

  it('puts payments last, so a money-moving service is not the first thing offered', () => {
    const categories = catalogByCategory().map((g) => g.category);
    expect(categories[categories.length - 1]).toBe('payments');
  });

  it('emits no empty groups', () => {
    for (const g of catalogByCategory()) {
      expect(g.servers.length, g.category).toBeGreaterThan(0);
    }
  });
});

describe('honesty about what is not here', () => {
  it('records why excluded services are absent', () => {
    const names = CATALOG_EXCLUSIONS.map((e) => e.name);
    expect(names).toContain('HubSpot');
    expect(names).toContain('DeepWiki');
    for (const e of CATALOG_EXCLUSIONS) {
      expect(e.reason.length, e.name).toBeGreaterThan(20);
    }
  });

  it('records when the list was last verified', () => {
    // A claim about someone else's server that can stop being true.
    expect(CATALOG_VERIFIED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
