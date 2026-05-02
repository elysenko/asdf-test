/**
 * Prisma client singleton.
 *
 * Next.js HMR will re-import this module on every save in dev, which would
 * leak a fresh PrismaClient (and its connection pool) per reload. The
 * `globalThis` cache avoids that.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    // We log errors and warnings — query logs are noisy and can echo user
    // input (city names) in the SQL. Keep them off in shared environments.
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
