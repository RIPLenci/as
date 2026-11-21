import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

export default function createNextConfig(phase: string): NextConfig {
  return {
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
    reactStrictMode: true,
    eslint: {
      ignoreDuringBuilds: true,
    },
    typescript: {
      ignoreBuildErrors: process.env.SKIP_NEXT_TYPECHECK === '1',
    },
    images: {
      remotePatterns: [
        {
          protocol: 'https',
          hostname: 'cdn.discordapp.com',
          port: '',
          pathname: '/**',
        },
        {
          protocol: 'https',
          hostname: 'media.discordapp.net',
          port: '',
          pathname: '/**',
        },
      ],
    },
    experimental: {
      optimizePackageImports: ['lucide-react', 'motion'],
    },
    serverExternalPackages: ['discord.js', 'mongoose', 'ioredis'],
    outputFileTracingExcludes: {
      '*': ['./public/assets/aistudio/**', './.aegis-data/**', './.next-dev/**'],
    },
    webpack: (config, { dev }) => {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      if (dev && process.env.DISABLE_HMR === 'true') {
        config.watchOptions = {
          ignored: /.*/,
        };
      }
      if (config.output) {
        config.output.chunkLoadTimeout = 180000;
      }
      return config;
    },
    async headers() {
      return [
        {
          source: '/(.*)',
          headers: [
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
            { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ],
        },
      ];
    },
  };
}
