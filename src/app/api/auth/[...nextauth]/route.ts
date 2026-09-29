/**
 * Auth.js v5 route handler.
 *
 * Destructures the GET and POST handlers from the Auth.js `handlers` export
 * and re-exports them so Next.js App Router forwards all /api/auth/* requests
 * to Auth.js.
 */
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
