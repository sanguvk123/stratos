/** @type {import('next').NextConfig} */
// Next.js 14 does not read next.config.ts (that arrives in Next 15), so this is an .mjs file.
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // NEXT_DIST_DIR lets a second `next dev` or `next build` use its own build directory. Two Next
  // processes sharing one `.next` corrupt each other's chunks ("Cannot find module './276.js'").
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
