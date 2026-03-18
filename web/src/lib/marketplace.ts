export interface MarketplacePlugin {
  name: string;
  description: string;
  version?: string;
  author?: { name: string; email?: string };
  source: string | { source: string; url?: string; repo?: string; path?: string; ref?: string };
  category?: string;
  tags?: string[];
  keywords?: string[];
  homepage?: string;
  strict?: boolean;
  lspServers?: Record<string, unknown>;
}

export interface MarketplaceData {
  plugins: MarketplacePlugin[];
  categories: string[];
}

export const MARKETPLACE_CATEGORIES: Record<string, string> = {
  development: 'Development',
  productivity: 'Productivity',
  database: 'Database',
  security: 'Security',
  deployment: 'Deployment',
  testing: 'Testing',
  design: 'Design',
  learning: 'Learning',
  monitoring: 'Monitoring',
};

export function getPluginUrl(plugin: MarketplacePlugin): string {
  if (plugin.homepage) return plugin.homepage;

  if (typeof plugin.source === 'object' && plugin.source.url) {
    const url = plugin.source.url;
    if (url.startsWith('http')) return url;
    // GitHub shorthand like "owner/repo"
    return `https://github.com/${url}`;
  }

  // Default: link to the official repo tree
  const path = typeof plugin.source === 'string' ? plugin.source : plugin.source.path || '';
  const clean = path.replace(/^\.\//, '');
  return `https://github.com/anthropics/claude-plugins-official/tree/main/${clean}`;
}
