/**
 * Centralised environment variable access.
 *
 * - Server-side secrets are only exported from this file and must never be
 *   re-exported to client bundles.
 * - Client-safe variables (NEXT_PUBLIC_*) may be imported anywhere.
 * - Call `validateServerEnv()` once at startup (e.g. in lib/prisma.ts and
 *   lib/pusher.ts) to fail fast with a clear message rather than a
 *   confusing runtime error deep in a request.
 *
 * Values are accessed via process.env -- never logged or exposed in responses.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Asserts that a required server-side environment variable is present.
 * Throws if absent so the app fails fast at cold-start.
 * The value is intentionally NOT returned -- callers use process.env directly
 * so secrets never transit through a shared variable that could be leaked.
 */
function requireServerEnv(name: string): void {
  if (!process.env[name]) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Check .env.local and ensure the variable is set before starting the server.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Validation -- call once per long-lived singleton (Prisma, Pusher, Redis)
// ---------------------------------------------------------------------------

/** Required server-side keys (must NEVER be sent to the browser). */
const SERVER_ONLY_KEYS = [
  'DATABASE_URL',
  'NEXTAUTH_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'PUSHER_APP_ID',
  'PUSHER_KEY',
  'PUSHER_SECRET',
  'PUSHER_CLUSTER',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
] as const;

/** Required client-exposed keys (safe to include in browser bundles). */
const CLIENT_KEYS = [
  'NEXT_PUBLIC_PUSHER_KEY',
  'NEXT_PUBLIC_PUSHER_CLUSTER',
] as const;

/**
 * Returns the names of all required environment variables that are missing.
 * Does NOT print their values.
 *
 * Usage: call inside health-check endpoints or startup diagnostics.
 */
export function getMissingEnvKeys(): string[] {
  const allRequired = [...SERVER_ONLY_KEYS, ...CLIENT_KEYS];
  return allRequired.filter((key) => !process.env[key]);
}

/**
 * Throws on the first missing required variable.
 * Intended for use inside singleton constructors so the app crashes at
 * startup rather than at request time.
 */
export function validateServerEnv(): void {
  for (const key of SERVER_ONLY_KEYS) {
    requireServerEnv(key);
  }
  for (const key of CLIENT_KEYS) {
    if (!process.env[key]) {
      throw new Error(
        `Missing required public environment variable: ${key}. ` +
          `Check .env.local and ensure the variable is set.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Client-safe public accessors
// These are the ONLY env values that may be read on the client side.
// ---------------------------------------------------------------------------

/**
 * Pusher public key -- safe for browser bundles (NEXT_PUBLIC_).
 * Accessed via process.env so Next.js can inline it at build time.
 */
export function getPublicPusherKey(): string {
  const value = process.env.NEXT_PUBLIC_PUSHER_KEY;
  if (!value) throw new Error('NEXT_PUBLIC_PUSHER_KEY is not set.');
  return value;
}

/**
 * Pusher cluster -- safe for browser bundles (NEXT_PUBLIC_).
 */
export function getPublicPusherCluster(): string {
  const value = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
  if (!value) throw new Error('NEXT_PUBLIC_PUSHER_CLUSTER is not set.');
  return value;
}
