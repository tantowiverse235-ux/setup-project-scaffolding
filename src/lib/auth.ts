/**
 * Auth.js v5 (next-auth@5.x) configuration for Travel Planner SaaS.
 *
 * Exports: { handlers, auth, signIn, signOut }
 *
 * Providers:
 *   - Google OAuth 2.0
 *   - Credentials (email + password with bcrypt)
 *
 * Session strategy: JWT, 24-hour maxAge.
 * Adapter: PrismaAdapter (links OAuth accounts to database User records).
 *
 * Rate limiting:
 *   The Credentials authorize function calls checkLoginRateLimit before
 *   attempting password verification, and records failed / successful
 *   attempts via recordFailedAttempt / resetAttempts.
 *
 * Type augmentations:
 *   JWT is extended with `id` so session.user.id is available on the client.
 */

import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  checkLoginRateLimit,
  recordFailedAttempt,
  resetAttempts,
} from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// Module augmentation — extend JWT and Session types with `id`
// ---------------------------------------------------------------------------

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      image?: string | null;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    /** The database User.id, propagated from the jwt callback into the session. */
    id?: string;
  }
}

// ---------------------------------------------------------------------------
// Auth.js configuration
// ---------------------------------------------------------------------------

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),

  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },

  providers: [
    // ── Google OAuth 2.0 ──────────────────────────────────────────────────
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),

    // ── Email + Password (Credentials) ────────────────────────────────────
    Credentials({
      credentials: {
        email: { type: "email" },
        password: { type: "password" },
        /**
         * The client IP is forwarded from the Server Action so we can
         * apply per-IP rate limiting here.  The authorize function has
         * access to both the credentials object and the raw request.
         */
        ip: { type: "text" },
      },

      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        const ip = (credentials?.ip as string | undefined) ?? "unknown";

        // Basic presence check — full Zod validation happens in the Server
        // Action before signIn() is ever called.
        if (!email || !password) return null;

        // ── Rate limit check ───────────────────────────────────────────────
        // Throws RateLimitError (caught by the Server Action layer) if the
        // IP is currently blocked.
        await checkLoginRateLimit(ip);

        // ── User lookup ────────────────────────────────────────────────────
        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            passwordHash: true,
            displayName: true,
          },
        });

        // ── Password verification ──────────────────────────────────────────
        const isValid =
          user?.passwordHash != null &&
          (await bcrypt.compare(password, user.passwordHash));

        if (!isValid) {
          await recordFailedAttempt(ip);
          return null;
        }

        await resetAttempts(ip);

        // Return the minimal User shape that Auth.js needs.
        // `name` maps to displayName; `image` is not required here.
        return {
          id: user!.id,
          email: user!.email,
          name: user!.displayName || null,
        };
      },
    }),
  ],

  callbacks: {
    /**
     * jwt callback — called whenever a JWT is created or updated.
     * On sign-in (`trigger === "signIn"` or `"signUp"`), the `user` object
     * is available.  We store user.id in the token so it survives across
     * subsequent requests.
     */
    jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
      }
      return token;
    },

    /**
     * session callback — called before a session is returned to the client.
     * Maps token.id → session.user.id so components and Server Actions can
     * access the authenticated user's database id.
     */
    session({ session, token }) {
      if (token.id) {
        session.user.id = token.id;
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
  },
});
