import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  serverExternalPackages: ['pdfjs-dist'],
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
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    };
    return config;
  },
};

export default nextConfig;
