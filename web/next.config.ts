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
  // Force Next.js standalone output to include the Claude Agent SDK's cli.js
  // and platform-specific native binary siblings. The tracer normally skips
  // cli.js (it's a CLI binary, not an imported module) which leaves the SDK
  // unable to spawn at runtime in the packaged Electron build. Listing them
  // here makes the standalone output authoritative — extraResources merging
  // is no longer load-bearing (and was failing silently on Windows due to
  // MAX_PATH limits under claude-agent-sdk-win32-x64).
  outputFileTracingIncludes: {
    '*': [
      './node_modules/@anthropic-ai/claude-agent-sdk/**/*',
      './node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/**/*',
      './node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64/**/*',
      './node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/**/*',
      './node_modules/@anthropic-ai/claude-agent-sdk-win32-arm64/**/*',
      './node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/**/*',
      './node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64/**/*',
    ],
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
