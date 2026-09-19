/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The ten-hour test edition is a second build served at /test (see ecosystem.config.js: ladder-test).
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  // Test builds (local fork, browser tests) use their own output folder so they never touch the live build.
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
