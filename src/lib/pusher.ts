/**
 * Pusher server-side singleton.
 *
 * Used exclusively in Server Actions and Route Handlers to trigger events.
 * All four Pusher server credentials are server-only -- they must never be
 * imported by client components.
 *
 * Do NOT re-export PUSHER_SECRET, PUSHER_KEY, or PUSHER_APP_ID from this
 * file. Consumers call the `pusher` instance methods directly.
 */
import Pusher from 'pusher';

// Guard: this module must only execute server-side.
if (typeof window !== 'undefined') {
  throw new Error(
    'lib/pusher.ts must not be imported in client components. ' +
      'Use lib/pusher-client.ts for browser-side Pusher access.',
  );
}

if (
  !process.env.PUSHER_APP_ID ||
  !process.env.PUSHER_KEY ||
  !process.env.PUSHER_SECRET ||
  !process.env.PUSHER_CLUSTER
) {
  throw new Error(
    'One or more Pusher server environment variables are missing ' +
      '(PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER). ' +
      'Check .env.local.',
  );
}

export const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true,
});
