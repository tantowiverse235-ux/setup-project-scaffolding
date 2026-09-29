// prisma.config.ts
//
// Prisma v7 CLI configuration.
//
// In Prisma v7, the database connection URL for the CLI (migrations, db push,
// db pull, validate) is defined here -- NOT in schema.prisma.
// The `env` helper reads from process.env; it does not print or expose values.
//
// At runtime, PrismaClient receives the connection via a PrismaPg adapter
// in src/lib/prisma.ts -- see that file for the runtime wiring.

import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Load .env.local so the Prisma CLI can read DATABASE_URL when invoked
// directly (e.g. `npx prisma validate`, `npx prisma migrate dev`).
// Next.js loads .env.local automatically at runtime; this import covers
// CLI-only execution paths.
config({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});