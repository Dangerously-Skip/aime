import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  serverExternalPackages: ['pdfjs-dist'],
  outputFileTracingExcludes: {
    '*': ['./dist/**', './release/**', './temp/**', './.next/cache/**'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
  // Suppress pdf.js optional Node canvas dependency
  turbopack: {
    resolveAlias: {
      canvas: { browser: './empty-module.js' },
    },
  },
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    };
    // Disable module concatenation on client to prevent TDZ errors from
    // circular imports between Zustand stores and components. The codebase
    // has multiple circular chains (e.g. cowork-surface → use-project-context
    // → context-builder → stores → cowork chunk). Module concatenation
    // merges these into one scope where evaluation order causes "Cannot
    // access 'X' before initialization". Negligible bundle size impact
    // for an Electron app.
    if (!isServer) {
      config.optimization.concatenateModules = false;
    }
    return config;
  },
};

export default nextConfig;
