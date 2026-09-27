/**
 * Pusher private-channel auth endpoint.
 *
 * The Pusher JS client sends an application/x-www-form-urlencoded POST to
 * /api/pusher/auth whenever it needs to subscribe to a private channel.
 * This handler:
 *   1. Validates the session — returns 403 if unauthenticated (Req 16.1).
 *   2. Parses socket_id and channel_name from the form body.
 *   3. Validates that channel_name matches private-trip-{tripId} (Req 7.6).
 *   4. Confirms the authenticated user is a TripMember of that trip.
 *      Returns 403 (not 404) to avoid disclosing trip existence (Req 16.3).
 *   5. Signs the Pusher channel auth response and returns it as JSON.
 */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { pusher } from "@/lib/pusher";

/** Pattern: private-trip-<cuid> */
const PRIVATE_TRIP_CHANNEL_RE = /^private-trip-([a-z0-9]+)$/;

export async function POST(request: Request): Promise<Response> {
  // ── 1. Session validation ─────────────────────────────────────────────────
  const session = await auth();

  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 403 });
  }

  const userId = session.user.id;

  // ── 2. Parse form body ────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }

  const socketId = formData.get("socket_id");
  const channelName = formData.get("channel_name");

  if (typeof socketId !== "string" || typeof channelName !== "string") {
    return new Response("Missing socket_id or channel_name", { status: 400 });
  }

  // ── 3. Validate channel name ──────────────────────────────────────────────
  const match = PRIVATE_TRIP_CHANNEL_RE.exec(channelName);

  if (!match) {
    return new Response("Invalid channel name", { status: 400 });
  }

  const tripId = match[1];

  // ── 4. Verify TripMember membership ──────────────────────────────────────
  const membership = await prisma.tripMember.findUnique({
    where: {
      tripId_userId: { tripId, userId },
    },
    select: { id: true },
  });

  if (!membership) {
    // Return 403, not 404, to avoid disclosing whether the trip exists.
    return new Response("Forbidden", { status: 403 });
  }

  // ── 5. Sign and return the Pusher channel auth response ───────────────────
  const authResponse = pusher.authorizeChannel(socketId, channelName);

  return Response.json(authResponse);
}
