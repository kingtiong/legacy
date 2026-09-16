/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Test builds (local fork, browser tests) use their own output folder so they never touch the live build.
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
