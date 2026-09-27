/**
 * Redis-backed login rate limiter (Requirement 1.9).
 *
 * Uses the Upstash Redis REST API directly via fetch — no additional package
 * required. Credentials are accessed from server-only environment variables
 * and are never sent to the browser.
 *
 * Logic:
 *  - 5 consecutive failed attempts from the same IP within 10 minutes
 *    triggers a 15-minute block.
 *  - checkLoginRateLimit(ip) — throws RateLimitError if the IP is blocked.
 *  - recordFailedAttempt(ip) — increments the failure counter; applies block
 *    once the threshold is crossed.
 *  - resetAttempts(ip)       — clears counter and block on successful login.
 *
 * Graceful degradation: if Redis credentials are absent (e.g., local dev
 * without .env.local), rate limiting is silently skipped rather than
 * crashing the application.
 */

const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 10 * 60; // 10 minutes
const BLOCK_SECONDS = 15 * 60; // 15 minutes

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Thrown by checkLoginRateLimit when an IP is temporarily blocked.
 * Auth actions should catch this and return an appropriate ActionResult error.
 *
 * NOTE: Once src/lib/errors.ts (task 4) introduces AppError, callers may
 * translate this into AppError('UNAUTHORIZED', ...) at the action layer.
 */
export class RateLimitError extends Error {
  constructor(
    message = 'Too many failed login attempts. Please try again in 15 minutes.',
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

// ---------------------------------------------------------------------------
// Redis key helpers
// ---------------------------------------------------------------------------

/** Tracks the number of consecutive failed attempts for an IP. */
function attemptsKey(ip: string): string {
  return `login:attempts:${ip}`;
}

/** Set when an IP has been blocked; TTL controls how long the block lasts. */
function blockKey(ip: string): string {
  return `login:blocked:${ip}`;
}

// ---------------------------------------------------------------------------
// Upstash REST helpers
// All commands are issued as GET requests against the path-based REST API.
// Ref: https://upstash.com/docs/redis/features/restapi
// ---------------------------------------------------------------------------

function getRedisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn(
      '[rate-limit] UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is not set. ' +
        'Rate limiting is disabled.',
    );
    return null;
  }
  return { url, token };
}

type UpstashResponse<T> = { result: T };

/** GET /get/{key} → string value or null */
async function redisGet(key: string): Promise<string | null> {
  const config = getRedisConfig();
  if (!config) return null;

  try {
    const res = await fetch(
      `${config.url}/get/${encodeURIComponent(key)}`,
      {
        headers: { Authorization: `Bearer ${config.token}` },
        cache: 'no-store',
      },
    );
    if (!res.ok) return null;
    const json: UpstashResponse<string | null> = await res.json();
    return json.result;
  } catch {
    return null;
  }
}

/** GET /incr/{key} → new integer value after increment */
async function redisIncr(key: string): Promise<number> {
  const config = getRedisConfig();
  if (!config) return 0;

  try {
    const res = await fetch(
      `${config.url}/incr/${encodeURIComponent(key)}`,
      {
        headers: { Authorization: `Bearer ${config.token}` },
        cache: 'no-store',
      },
    );
    if (!res.ok) return 0;
    const json: UpstashResponse<number> = await res.json();
    return json.result;
  } catch {
    return 0;
  }
}

/** GET /expire/{key}/{ttl} → sets expiry on an existing key */
async function redisExpire(key: string, ttlSeconds: number): Promise<void> {
  const config = getRedisConfig();
  if (!config) return;

  try {
    await fetch(
      `${config.url}/expire/${encodeURIComponent(key)}/${ttlSeconds}`,
      {
        headers: { Authorization: `Bearer ${config.token}` },
        cache: 'no-store',
      },
    );
  } catch {
    // Best-effort: if expire fails, the key will persist until Redis eviction
  }
}

/** GET /set/{key}/{value}/ex/{ttl} → sets key with value and TTL */
async function redisSetEx(
  key: string,
  ttlSeconds: number,
  value: string,
): Promise<void> {
  const config = getRedisConfig();
  if (!config) return;

  try {
    await fetch(
      `${config.url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/ex/${ttlSeconds}`,
      {
        headers: { Authorization: `Bearer ${config.token}` },
        cache: 'no-store',
      },
    );
  } catch {
    // Best-effort
  }
}

/** GET /del/{key} → deletes a key */
async function redisDel(key: string): Promise<void> {
  const config = getRedisConfig();
  if (!config) return;

  try {
    await fetch(
      `${config.url}/del/${encodeURIComponent(key)}`,
      {
        headers: { Authorization: `Bearer ${config.token}` },
        cache: 'no-store',
      },
    );
  } catch {
    // Best-effort
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Checks whether the given IP is currently rate-limited.
 *
 * @throws {RateLimitError} if the IP is blocked due to too many failed attempts.
 */
export async function checkLoginRateLimit(ip: string): Promise<void> {
  const blocked = await redisGet(blockKey(ip));
  if (blocked !== null) {
    throw new RateLimitError();
  }
}

/**
 * Records a failed login attempt for the given IP.
 *
 * - Increments the failure counter with a 10-minute sliding window.
 * - Once MAX_ATTEMPTS is reached, sets a 15-minute block and clears the counter.
 */
export async function recordFailedAttempt(ip: string): Promise<void> {
  const key = attemptsKey(ip);
  const count = await redisIncr(key);

  if (count === 1) {
    // First attempt in this window — set the 10-minute expiry.
    // Uses EXPIRE rather than SET so we don't reset the counter value.
    await redisExpire(key, WINDOW_SECONDS);
  }

  if (count >= MAX_ATTEMPTS) {
    // Threshold crossed — block the IP for 15 minutes and clear the counter.
    await redisSetEx(blockKey(ip), BLOCK_SECONDS, '1');
    await redisDel(key);
  }
}

/**
 * Clears all rate-limit state for the given IP after a successful login.
 * Should be called immediately after a user authenticates successfully.
 */
export async function resetAttempts(ip: string): Promise<void> {
  await Promise.all([redisDel(attemptsKey(ip)), redisDel(blockKey(ip))]);
}
