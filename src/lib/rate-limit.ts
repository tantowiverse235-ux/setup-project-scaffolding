/**
 * Redis-backed login rate limiter (Requirement 1.9).
 *
 * Uses Upstash Redis REST API via the @upstash/redis client pattern:
 * raw fetch calls against UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.
 * These credentials are server-only and must never be sent to the browser.
 *
 * Limits: 5 failed attempts per IP per 10-minute window -> 15-minute block.
 */

const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 10 * 60;   // 10 minutes
const BLOCK_SECONDS = 15 * 60;    // 15 minutes

/** Key for the failed-attempt counter. */
function attemptsKey(ip: string) {
  return `login:attempts:${ip}`;
}

/** Key for an explicit block flag (set after threshold is crossed). */
function blockKey(ip: string) {
  return `login:blocked:${ip}`;
}

// ---------------------------------------------------------------------------
// Upstash REST helpers -- secrets stay server-side
// ---------------------------------------------------------------------------

type UpstashResponse<T> = { result: T };

async function redisGet<T>(key: string): Promise<T | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    // If Redis is not configured, skip rate limiting rather than crashing.
    // Log a warning (key name only, no secret values).
    console.warn(
      '[rate-limit] UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is not set. ' +
        'Rate limiting is disabled.',
    );
    return null;
  }

  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const json: UpstashResponse<T | null> = await res.json();
  return json.result;
}

async function redisSetEx(key: string, ttlSeconds: number, value: string): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;

  await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/ex/${ttlSeconds}`, {
    method: 'GET', // Upstash REST uses GET for simple set commands
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
}

async function redisIncr(key: string): Promise<number> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return 0;

  const res = await fetch(`${url}/incr/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) return 0;
  const json: UpstashResponse<number> = await res.json();
  return json.result;
}

async function redisDel(key: string): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;

  await fetch(`${url}/del/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Checks whether the IP is currently blocked.
 * Throws a rate-limit error (to be caught by the auth action) if blocked.
 */
export async function checkLoginRateLimit(ip: string): Promise<void> {
  const blocked = await redisGet<string>(blockKey(ip));
  if (blocked) {
    throw new Error(
      'Too many failed login attempts. Your access has been temporarily blocked for 15 minutes.',
    );
  }
}

/**
 * Records a failed login attempt for the given IP.
 * Blocks the IP for BLOCK_SECONDS once MAX_ATTEMPTS is reached.
 */
export async function recordFailedAttempt(ip: string): Promise<void> {
  const key = attemptsKey(ip);
  const count = await redisIncr(key);

  if (count === 1) {
    // First attempt in this window -- set the expiry.
    await redisSetEx(key, WINDOW_SECONDS, String(count));
  }

  if (count >= MAX_ATTEMPTS) {
    await redisSetEx(blockKey(ip), BLOCK_SECONDS, '1');
    await redisDel(key); // clean up the counter
  }
}

/**
 * Clears any existing failed-attempt counters for the IP after a
 * successful login.
 */
export async function resetAttempts(ip: string): Promise<void> {
  await redisDel(attemptsKey(ip));
  await redisDel(blockKey(ip));
}
