/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  basePath: '/asdf-test-staging',
  reactStrictMode: true,
  // Ensure the Prisma client is bundled correctly for the Node.js server runtime.
  serverExternalPackages: ["@prisma/client", "prisma"],
};

export default nextConfig;
