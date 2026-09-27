/**
 * Pusher browser-side singleton.
 *
 * Only NEXT_PUBLIC_PUSHER_KEY and NEXT_PUBLIC_PUSHER_CLUSTER are used here --
 * both are intentionally public and safe for browser bundles.
 *
 * This file may be imported by client components. It must NOT import anything
 * from lib/pusher.ts (server-only secrets).
 */
'use client';

import PusherClient from 'pusher-js';
import { getPublicPusherKey, getPublicPusherCluster } from '@/lib/env';

// Singleton: reuse across hot-reloads in development.
const globalForPusher = globalThis as unknown as { pusherClient?: PusherClient };

function createPusherClient(): PusherClient {
  return new PusherClient(getPublicPusherKey(), {
    cluster: getPublicPusherCluster(),
    // Private channels are authenticated via /api/pusher/auth.
    channelAuthorization: {
      endpoint: '/api/pusher/auth',
      transport: 'ajax',
    },
  });
}

export const pusherClient: PusherClient =
  globalForPusher.pusherClient ?? createPusherClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPusher.pusherClient = pusherClient;
}
