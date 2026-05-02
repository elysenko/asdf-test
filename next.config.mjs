/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Ensure the Prisma client is bundled correctly for the Node.js server runtime.
  serverExternalPackages: ["@prisma/client", "prisma"],
};

export default nextConfig;
