/**
 * Route protection proxy (Next.js 16+).
 *
 * In Next.js 16, `middleware.ts` was renamed to `proxy.ts` and the default
 * export was replaced with a named `proxy` export.
 *
 * Auth.js v5 `auth()` wraps a handler and returns a NextMiddleware function
 * that reads the JWT session before calling the inner callback.  We export
 * that result under the name `proxy` so Next.js picks it up correctly.
 *
 * Public paths (no session required):
 *   /login          – login page
 *   /register       – registration page
 *   /api/auth/*     – Auth.js route handlers (OAuth callbacks, session, etc.)
 *
 * Any other path without an active session is redirected to /login.
 *
 * Requirements: 16.1
 */

import { auth } from "@/lib/auth";
import type { NextAuthRequest } from "next-auth";

/**
 * The exported function must be named `proxy` in Next.js 16+.
 * `auth(callback)` returns a NextMiddleware; we simply re-export it
 * under the required name.
 */
export const proxy = auth((req: NextAuthRequest) => {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/api/auth");

  // If the user is not authenticated and the path is not public, redirect to login.
  if (!req.auth && !isPublic) {
    return Response.redirect(new URL("/login", req.url));
  }
});

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static  (static assets)
     * - _next/image   (image optimisation)
     * - favicon.ico   (browser favicon)
     *
     * This mirrors the pattern from the design document and ensures auth
     * checks never block CSS/JS/image requests.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
