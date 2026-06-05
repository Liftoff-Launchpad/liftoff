const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Trace from the monorepo root so the standalone bundle includes the right
  // node_modules (this app lives in a pnpm workspace).
  outputFileTracingRoot: path.join(__dirname, '../../'),
  reactStrictMode: true,
};

module.exports = nextConfig;
