# PROJECT_CONTEXT.md — Travel Planner SaaS (OneDayTrip)

_Last updated: 2026-09-29_

---

## 1. Project Objectives

Travel Planner SaaS is a collaborative web application for planning day-trips and multi-day travel with a focus on Indonesian destinations. The core goals are:

- Let solo travelers and groups plan trips with day-by-day, drag-and-drop itineraries.
- Track IDR-denominated expenses, split bills among group members, and auto-compute minimum-transfer settlements.
- Provide a curated Indonesian place recommendation module with full-text search.
- Support real-time collaboration so all trip members see updates live without a full page reload.
- Secure the platform with email/password authentication and Google OAuth, with role-based access control (Owner / Editor / Viewer) per trip.

---

## 2. Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 16.3.6 (App Router, TypeScript) | Deployed to Vercel |
| Language | TypeScript 5 | Strict mode throughout |
| Styling | Tailwind CSS v4 | PostCSS config present |
| UI Components | Shadcn UI + Lucide React | `components.json` configured |
| Authentication | Auth.js v5 (NextAuth) `^5.0.0-beta.32` | JWT strategy, 24 h token |
| Auth Adapter | `@auth/prisma-adapter` | Links Auth.js to Prisma models |
| ORM | Prisma v7.10.0 | Prisma v7 breaking-change: `prisma-client` generator, adapter-based connection |
| Database | PostgreSQL (via `@prisma/adapter-pg`) | `pg_trgm` extension for place search |
| Real-time | Pusher Channels (server SDK `pusher`, client SDK `pusher-js`) | Private channels, serverless-compatible |
| Server State | TanStack Query v5 + TanStack Query Devtools | Client cache, optimistic updates, stale-while-revalidate |
| Drag-and-Drop | `@hello-pangea/dnd` | Active react-beautiful-dnd fork |
| Forms | `react-hook-form` v7 + Zod v4 | Client-side validation |
| Toasts | `sonner` v2 | User-facing action feedback |
| Rate Limiting | Upstash Redis REST API (via raw `fetch`) | Login brute-force protection |
| Password Hashing | `bcryptjs` v3, work factor 12 | Null for OAuth-only accounts |
| Testing | Vitest v5, `@vitest/coverage-v8`, `fast-check` v4 | Property-based + unit + integration tests |
| Runtime | Node.js | Environment: `node` in Vitest config |

### Currency

All monetary values are stored and processed as `bigint` (whole IDR units) — never `number` — to eliminate floating-point rounding errors. PostgreSQL `BIGINT` maps to TypeScript `bigint` through Prisma.

---

## 3. Completed Features

### 3.1 Project Scaffolding (Task 1 ✅)
- Next.js 16 app with App Router, TypeScript, Tailwind CSS, Shadcn UI, Lucide React.
- All runtime and dev dependencies installed (see `package.json`).
- `.env.local` template with all required keys.
- `vitest.config.ts` with `@` path alias matching `tsconfig.json`.

### 3.2 Prisma Schema & Migrations (Task 2 ✅)

**Schema** — `prisma/schema.prisma`:
- Generator: `prisma-client` (Prisma v7 provider name).
- Output: `src/generated/prisma`.
- Datasource URL configured in `prisma.config.ts` (Prisma v7 pattern, not inline in schema).

**Models defined:**
| Model | Purpose |
|---|---|
| `User` | Account holder; supports email/password and OAuth |
| `Account` | OAuth provider links (Auth.js requirement) |
| `Session` | Auth.js database sessions |
| `VerificationToken` | Email verification tokens |
| `Trip` | Trip with destination city, date range, type (Solo/Group), optional `budgetTarget` (BigInt IDR) |
| `TripMember` | Join table linking User ↔ Trip with role (Owner/Editor/Viewer) |
| `InvitationLink` | Time-limited (7-day) invite tokens; tracks `usedAt` |
| `ItineraryItem` | Activity item per day; `sortIndex` for drag-and-drop ordering |
| `Expense` | IDR expense record linked to payer (TripMember) |
| `ExpenseSplit` | Per-member share of an expense (BigInt IDR) |
| `Place` | Curated Indonesian POI for recommendation module |

**Migrations run:**
- `20260927155442_init` — all tables, indexes, FK constraints.
- `20260927160000_add_pg_trgm_indexes` — enables `pg_trgm` extension; adds GIN trigram indexes on `Place.name` and `Place.city` for sub-second search.

### 3.3 Prisma Client Singleton (Task 2.4 ✅)

`src/lib/prisma.ts`:
- Constructs `PrismaClient` with `PrismaPg` adapter (Prisma v7 requirement).
- Stores instance on `globalThis` to survive Next.js hot-reloads.
- Calls `validateServerEnv()` at startup for fast-fail on missing env vars.
- **Note:** `src/generated/prisma/` must exist before the app starts. Run `npx prisma generate` after cloning or after any schema change.

### 3.4 Redis-Backed Login Rate Limiter (Task 3.1 ✅)

`src/lib/rate-limit.ts`:
- Communicates with Upstash Redis REST API via raw `fetch` (no extra SDK required).
- **Rules:** 5 consecutive failures within 10 min → 15 min block per IP.
- Exports: `checkLoginRateLimit(ip)`, `recordFailedAttempt(ip)`, `resetAttempts(ip)`.
- Graceful degradation: rate limiting is silently skipped when Upstash credentials are absent (safe for local dev without `.env.local`).
- Custom `RateLimitError` class for discriminated error handling.

### 3.5 Auth.js v5 Configuration (Task 3.2 ✅)

`src/lib/auth.ts`:
- Exports `{ handlers, auth, signIn, signOut }` via `NextAuth(...)`.
- Adapter: `PrismaAdapter(prisma)`.
- Session strategy: `jwt`, `maxAge: 86400` (24 hours).
- Providers:
  - **Google** OAuth 2.0 (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`).
  - **Credentials** — email + password with `bcrypt.compare` (work factor 12); forwards client IP as a credential for per-IP rate limiting inside `authorize`.
- `jwt` callback: propagates `user.id` → `token.id` on sign-in.
- `session` callback: maps `token.id` → `session.user.id` so Server Actions and components get the database user ID.
- Custom `pages.signIn = '/login'`.
- TypeScript module augmentation extends `Session` with `user.id` and `JWT` with `id`.

### 3.6 Auth.js Route Handler & Pusher Auth Endpoint (Task 3.3 ✅)

`src/app/api/auth/[...nextauth]/route.ts`:
- Re-exports `{ GET, POST }` from `handlers` in `lib/auth.ts`.
- Forwards all `/api/auth/*` requests to Auth.js.

`src/app/api/pusher/auth/route.ts`:
- Handles `POST /api/pusher/auth` — the Pusher JS client private-channel auth endpoint.
- Validates session via `auth()`; returns HTTP 403 for unauthenticated requests.
- Parses `socket_id` and `channel_name` from `application/x-www-form-urlencoded` body.
- Validates channel name matches `private-trip-{cuid}` pattern.
- Confirms the authenticated user is a `TripMember` of the trip; returns HTTP 403 (not 404) for non-members to avoid trip existence disclosure (Requirement 16.3).
- Signs and returns the Pusher channel auth response via `pusher.authorizeChannel(socketId, channelName)`.

### 3.7 Route Protection Proxy (Task 3.4 ✅)

`src/proxy.ts` (**Next.js 16 naming** — replaces the old `middleware.ts`):
- Named export `proxy` (Next.js 16 replaces the default middleware export with a named `proxy` export).
- Uses `auth(callback)` from Auth.js v5; `req.auth` holds the session inside the callback.
- Public paths (no session required): `/login`, `/register`, `/api/auth/*`.
- Any unauthenticated request to a non-public path is redirected to `/login`.
- Matcher excludes `_next/static`, `_next/image`, and `favicon.ico` to avoid blocking static assets.

### 3.8 Pusher Singletons (Task 5 ✅)

`src/lib/pusher.ts`:
- Server-side Pusher instance (server secrets only; throws if imported client-side).
- Guards for missing env vars at module load.

`src/lib/pusher-client.ts`:
- Browser-side `PusherClient` singleton using only `NEXT_PUBLIC_*` keys.
- Configures private-channel auth endpoint at `/api/pusher/auth`.
- `globalThis` singleton pattern for hot-reload stability.

### 3.9 Environment Variable Management (Task 1 / Task 2.4 ✅)

`src/lib/env.ts`:
- Centralized env validation for all required keys (server-only + client-safe).
- `validateServerEnv()` — called by Prisma and Pusher singletons at startup.
- `getMissingEnvKeys()` — for health-check or diagnostic use.
- Public accessors `getPublicPusherKey()` and `getPublicPusherCluster()` — safe for browser bundles.

---

## 4. Tasks Currently In Progress

None. All tasks up through **Task 3.4** are complete.

---

## 5. Pending Tasks (Not Yet Started)

| Task | Description |
|---|---|
| 3.5 | Auth Server Actions: `registerAction`, `loginAction` |
| 4 | RBAC guard (`src/lib/rbac.ts`) and `AppError` class (`src/lib/errors.ts`) |
| 6.1–6.4 | Pure budget utilities: `computeEqualSplit`, `validateCustomSplit`, `computeNetBalances`, `computeSettlements`, `computeAnalytics` |
| 7.1–7.6 | Property-based tests for all budget utilities (Vitest + fast-check) |
| 8 | Checkpoint: all property tests pass |
| 9.1–9.3 | Trip Server Actions: `createTripAction`, `getTripAction`, `updateTripAction`, `deleteTripAction`, invitation/membership actions |
| 10.1–10.2 | Itinerary Server Actions: CRUD + reorder with PostgreSQL advisory lock |
| 11.1–11.3 | Expense Server Actions: log, delete, settlements, budget target, analytics |
| 12 | Recommendation Server Actions: `searchPlacesAction`, `browseByCategory` |
| 13 | Checkpoint: all Server Actions compile without TypeScript errors |
| 14.1–14.2 | Real-time client hook `useTripChannel` + TanStack Query provider layout |
| 15.1–15.3 | Auth UI: `RegisterForm`, `LoginForm`, login/register pages |
| 16.1–16.2 | Trip UI: `TripCard`, `TripCreateDialog`, `TripEditDialog`, dashboard page |
| 17.1–17.2 | Core dashboard UI: `DashboardHeader`, `MemberList`, `BudgetSummaryWidget`, `ConnectionStatusBanner`, `TripDashboard`, trip page |
| 18.1–18.3 | Itinerary UI: `ItineraryItemForm`, `ItineraryItemCard`, `DayColumn`, `ItineraryPlanner` |
| 19.1–19.3 | Expense UI: `SplitConfigPanel`, `ExpenseLogForm`, `ExpenseList`, `SettlementSummary`, expenses page |
| 20.1–20.2 | Recommendation UI: `PlaceSearchBar`, `PlaceCard`, `PlaceCategoryBrowser`, recommendation page |
| 21 | Database seed: 30+ Indonesian places covering all 6 `PlaceCategory` values |
| 22 | Checkpoint: full app builds and auth flows work end-to-end |
| 23.1–23.7 | Property-based tests: itinerary reorder, place search/filter, data integrity |
| 24.1–24.3 | Unit tests: auth, trips, RBAC, itinerary validation |
| 25.1–25.3 | Integration tests: expense→split→settlement, cascade deletes, concurrent reorder |
| 26 | Final checkpoint: all tests pass |

> Tasks marked `*` in `tasks.md` are optional for a faster MVP delivery.

---

## 6. Key Files and Their Functions

### Infrastructure / Config

| File | Role |
|---|---|
| `package.json` | Dependencies, scripts (`dev`, `build`, `start`, `lint`) |
| `next.config.ts` | Next.js configuration (currently default/empty) |
| `prisma/schema.prisma` | Full database schema (Prisma v7) |
| `prisma.config.ts` | Prisma v7 CLI config — `DATABASE_URL` datasource, migrations path, seed command |
| `prisma/migrations/20260927155442_init/` | Initial DB migration SQL |
| `prisma/migrations/20260927160000_add_pg_trgm_indexes/` | `pg_trgm` extension + GIN indexes for place search |
| `vitest.config.ts` | Vitest config: `node` environment, global test APIs, V8 coverage, `@` alias |
| `tsconfig.json` | TypeScript config with `@/` → `./src` path alias |
| `components.json` | Shadcn UI configuration |
| `.env.local` | Runtime secrets (DATABASE_URL, OAuth keys, Pusher keys, Redis keys) — **not committed** |

### Source Files

| File | Role |
|---|---|
| `src/lib/env.ts` | Centralized env var validation and public accessors; `validateServerEnv()` |
| `src/lib/prisma.ts` | Prisma v7 client singleton with `PrismaPg` adapter |
| `src/lib/rate-limit.ts` | Upstash Redis rate limiter for login brute-force protection |
| `src/lib/auth.ts` | Auth.js v5 config: Google + Credentials providers, JWT callbacks, PrismaAdapter |
| `src/lib/pusher.ts` | Server-side Pusher singleton (server secrets; throws if used client-side) |
| `src/lib/pusher-client.ts` | Browser-side `PusherClient` singleton; private-channel auth endpoint wired |
| `src/app/api/auth/[...nextauth]/route.ts` | Auth.js catch-all route handler; re-exports `{ GET, POST }` from `lib/auth.ts` |
| `src/app/api/pusher/auth/route.ts` | Pusher private-channel auth; verifies session + TripMember membership |
| `src/proxy.ts` | Next.js 16 route protection proxy (named `proxy` export); redirects unauthenticated requests to `/login` |
| `src/app/layout.tsx` | Root Next.js layout with Geist font setup |
| `src/app/page.tsx` | Placeholder home page (default Next.js template; not yet replaced) |
| `src/generated/prisma/` | Auto-generated Prisma client output (do not edit manually; regenerate with `npx prisma generate`) |

### Spec / Documentation

| File | Role |
|---|---|
| `.kiro/specs/travel-planner-saas/requirements.md` | 14 detailed functional requirements with acceptance criteria |
| `.kiro/specs/travel-planner-saas/design.md` | Architecture diagram, component interfaces, API surface, RBAC matrix, settlement algorithm, real-time event catalogue |
| `.kiro/specs/travel-planner-saas/tasks.md` | 26-group implementation plan with dependency graph and property-test traceability tags |
| `CLAUDE.md` | AI agent instructions file |
| `AGENTS.md` | Next.js agent-specific rules (version-aware) |

---

## 7. Relevant Technical Configurations

### Prisma v7 Breaking Changes (Applied)
- Generator provider is `"prisma-client"` (was `"prisma-client-js"`).
- Client output is required: `src/generated/prisma`.
- `datasource url` is no longer set in `schema.prisma`; it lives in `prisma.config.ts` and is passed to `PrismaClient` via `PrismaPg` adapter at runtime.
- `prisma.config.ts` uses `defineConfig` from `prisma/config`.
- **`npx prisma generate` must be run after cloning or after any schema change.** The generated client is gitignored; it is not committed to the repo.

### Next.js 16 Breaking Changes (Applied)
- `middleware.ts` is renamed to `proxy.ts`.
- The default middleware export is replaced with a named `proxy` export.
- See `src/proxy.ts` for the implementation.

### Auth.js v5 (NextAuth beta)
- Strategy: `jwt`, `maxAge: 86400` (24 hours).
- Adapter: `@auth/prisma-adapter`.
- Providers: `Credentials` (email/password with bcrypt) + `Google` OAuth 2.0.
- `auth()` is the primary session accessor in Server Actions and middleware/proxy.
- `handlers` are re-exported from `src/app/api/auth/[...nextauth]/route.ts`.
- Client IP is passed as a credential field (`ip`) so `checkLoginRateLimit` can run inside `authorize`.

### Real-Time Architecture
- All trip-scoped channels: `private-trip-{tripId}`.
- Private channels require auth via `POST /api/pusher/auth` (**now implemented**).
- Auth endpoint verifies session and `TripMember` membership; returns HTTP 403 for non-members.
- 8 event types in the catalogue (itinerary CRUD, expense CRUD, member role change, budget update).

### RBAC Pattern
- All Server Actions touching trip data must call `withTripAccess(tripId, [roles], fn)`.
- Non-members receive `404` (not `403`) to avoid trip existence disclosure (Requirement 16.3).
- Permission matrix: Owner > Editor > Viewer; only Owner can delete trip or change member roles.
- **`src/lib/rbac.ts` not yet created** (Task 4 pending).

### Monetary Values
- All IDR amounts use `bigint` throughout — in TypeScript, Prisma schema, and database (`BIGINT`).
- Valid range: `1n` to `999_999_999_999n` IDR.
- `budgetTarget` on `Trip` is nullable (`BigInt?`) — null until explicitly set.

### Budget Settlement Algorithm
- Greedy min-flow on net balance lists.
- `computeNetBalances` → `computeSettlements`.
- Produces ≤ N−1 settlements for N members with non-zero balances.
- Pure TypeScript functions in `src/lib/budget/` (no I/O), making them property-testable with `fast-check`.
- **Not yet implemented** (Tasks 6.1–6.4 pending).

### Place Search
- PostgreSQL `ILIKE` (via Prisma `mode: 'insensitive'`) for case-insensitive containment.
- GIN trigram indexes (`pg_trgm`) on `Place.name` and `Place.city` ensure < 1 s response for ≤ 10,000 records.
- Results capped at 50, ordered by `name ASC`.

### Itinerary Reorder Concurrency
- Concurrent reorder operations on the same (tripId, date) are serialized via `SELECT pg_advisory_xact_lock(hashtext(tripId || date))` inside a Prisma `$transaction` callback.

### Environment Variables Required

| Variable | Scope | Purpose |
|---|---|---|
| `DATABASE_URL` | Server | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Server | Auth.js JWT signing secret |
| `GOOGLE_CLIENT_ID` | Server | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Server | Google OAuth client secret |
| `PUSHER_APP_ID` | Server | Pusher app ID |
| `PUSHER_KEY` | Server | Pusher server key |
| `PUSHER_SECRET` | Server | Pusher server secret |
| `PUSHER_CLUSTER` | Server | Pusher cluster region |
| `UPSTASH_REDIS_REST_URL` | Server | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Server | Upstash Redis REST token |
| `NEXT_PUBLIC_PUSHER_KEY` | Client | Pusher public key (safe for browser) |
| `NEXT_PUBLIC_PUSHER_CLUSTER` | Client | Pusher cluster (safe for browser) |

---

## 8. Known Issues & Notes

1. **`src/generated/prisma/` is not committed** — Run `npx prisma generate` after cloning or any schema change. Forgetting this causes `Module not found: Can't resolve '@/generated/prisma/client'` at build time.

2. **No RBAC guard or AppError class (Task 4 pending)** — `src/lib/rbac.ts` and `src/lib/errors.ts` are not created. All Server Actions that depend on `withTripAccess` are blocked.

3. **No Server Actions exist yet (Tasks 3.5, 9–12 pending)** — All business logic (auth registration/login, trip CRUD, itinerary, expenses, recommendations) lives only in the spec.

4. **No UI components or pages (Tasks 15–20 pending)** — The app currently shows the default Next.js placeholder page. No auth pages, dashboard, itinerary, or expense screens exist.

5. **Budget pure utilities not yet written (Tasks 6.1–6.4 pending)** — `src/lib/budget/split.ts`, `settlement.ts`, and `analytics.ts` do not exist.

6. **No tests exist yet (Tasks 7–8, 23–26 pending)** — The test infrastructure (`vitest.config.ts`) is in place but no test files have been written.

7. **Database seed not written (Task 21 pending)** — `prisma/seed.ts` and the Indonesian places dataset are absent. The `Place` table is empty.

8. **Root page is placeholder** — `src/app/page.tsx` still renders the default Next.js "Get started" page and needs to be replaced or redirected.

9. **`layout.tsx` metadata not updated** — Title is still "Create Next App"; description is still the default Next.js generated text.

---

## 9. Next Steps (Recommended Order)

These follow the dependency graph in `tasks.md`:

1. **Task 3.5** — Create `src/actions/auth.actions.ts` (`registerAction`, `loginAction`).
2. **Task 4** — Create `src/lib/rbac.ts` (RBAC guard) and `src/lib/errors.ts` (AppError).
3. **Tasks 6.1–6.4** — Implement pure budget utilities (`split.ts`, `settlement.ts`, `analytics.ts`).
4. **Tasks 7.1–7.6** — Write property-based tests for budget utilities; run checkpoint (Task 8).
5. **Tasks 9–12** — Implement all Server Actions (trips, itinerary, expenses, recommendations); run checkpoint (Task 13).
6. **Tasks 14.1–14.2** — Set up TanStack Query provider and `useTripChannel` real-time hook.
7. **Tasks 15–20** — Build all UI components and pages.
8. **Task 21** — Write the database seed with ≥30 Indonesian places.
9. **Task 22** — End-to-end build and auth flow checkpoint.
10. **Tasks 23–25** — Write remaining property-based, unit, and integration tests.
11. **Task 26** — Final checkpoint: all tests pass.

> Optional tasks (marked `*` in `tasks.md`) can be deferred for a faster MVP.
