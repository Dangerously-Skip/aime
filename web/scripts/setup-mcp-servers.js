#!/usr/bin/env node
/**
 * Pre-installs MCP server npm packages so connector tools load instantly
 * instead of cold-starting via `npx -y` on first use.
 *
 * Usage: npm run setup:mcp
 *
 * Packages marked CONFIRMED have official Anthropic-maintained implementations.
 * Packages marked COMMUNITY are third-party; verify before production use.
 * Packages marked HTTP need no install (remote server).
 */

const { execSync } = require('child_process');
const { existsSync } = require('fs');

const MCP_PACKAGES = [
  // CONFIRMED — Anthropic official
  { pkg: '@modelcontextprotocol/server-github', connector: 'GitHub' },
  { pkg: '@modelcontextprotocol/server-slack', connector: 'Slack' },
  { pkg: '@modelcontextprotocol/server-gdrive', connector: 'Google Drive' },

  // COMMUNITY — well-maintained
  { pkg: 'figma-mcp', connector: 'Figma' },
  { pkg: '@softeria/ms-365-mcp-server', connector: 'Outlook / SharePoint' },
  { pkg: '@buildkite/mcp-server', connector: 'Buildkite' },

  // COMMUNITY — newer / may require verification
  { pkg: '@mirohq/mcp-server', connector: 'Miro', optional: true },
  { pkg: 'zoom-mcp-server', connector: 'Zoom', optional: true },
  { pkg: '@aws/mcp-server-aws', connector: 'AWS', optional: true },
  { pkg: 'sumologic-mcp-server', connector: 'Sumo Logic', optional: true },
];

// Jira + Confluence use Atlassian's remote HTTP MCP — no install needed.

console.log('Setting up MCP server packages...\n');

let installed = 0;
let skipped = 0;
let failed = 0;

for (const { pkg, connector, optional } of MCP_PACKAGES) {
  process.stdout.write(`  ${connector.padEnd(22)} (${pkg}) ... `);
  try {
    execSync(`npm install -g ${pkg}@latest`, { stdio: 'pipe' });
    console.log('✓');
    installed++;
  } catch (err) {
    if (optional) {
      console.log('⚠ skipped (optional)');
      skipped++;
    } else {
      console.log('✗ failed');
      console.error(`    ${err.stderr?.toString().trim() || err.message}`);
      failed++;
    }
  }
}

console.log(`\nDone: ${installed} installed, ${skipped} optional skipped, ${failed} failed.`);

if (failed > 0) {
  console.log('\nSome packages failed to install. Those connectors will fall back to');
  console.log('on-demand download via `npx -y` on first use (slower cold start).');
}

console.log('\nHTTP connectors (no install needed):');
console.log('  Jira + Confluence → Atlassian Remote MCP (https://mcp.atlassian.com)');
