/**
 * Prisma client singleton -- Prisma v7.
 *
 * In Prisma v7:
 *   - The generated client lives in src/generated/prisma (not node_modules).
 *   - PrismaClient no longer accepts a `datasourceUrl` string directly.
 *     It must be given a database adapter (PrismaPg for PostgreSQL).
 *   - DATABASE_URL is read from process.env here and passed to PrismaPg.
 *     It is never logged or returned to callers.
 *
 * In development, Next.js hot-reload creates new module instances. We store
 * the client on `globalThis` to avoid exhausting the connection pool.
 * In production, each serverless invocation starts fresh -- no globalThis needed,
 * but keeping it has no side-effects.
 */
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { validateServerEnv } from "@/lib/env";

// Fail fast if DATABASE_URL (or any other required server var) is absent.
validateServerEnv();

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  if (!process.env.DATABASE_URL) {
    // validateServerEnv() above already throws, but TypeScript needs the guard.
    throw new Error("DATABASE_URL is not set.");
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}