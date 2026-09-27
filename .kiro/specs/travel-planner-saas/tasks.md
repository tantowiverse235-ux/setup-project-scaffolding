# Implementation Plan: Travel Planner SaaS

## Overview

This plan scaffolds a full-stack Next.js (App Router, TypeScript) application for collaborative Indonesian trip planning. Tasks are ordered so each step builds on the previous: project setup → schema → auth → pure utilities → server actions → real-time → UI → tests → seed. Every task references the specific requirements it satisfies.

---

## Tasks

- [x] 1. Project scaffolding and environment setup
  - Bootstrap a new Next.js project with `--app` (App Router) and `--typescript` flags
  - Install and configure Tailwind CSS, Shadcn UI (via `shadcn-ui init`), and Lucide Icons
  - Install core runtime dependencies: `prisma`, `@prisma/client`, `next-auth@beta` (`auth.js v5`), `@auth/prisma-adapter`, `bcryptjs`, `pusher`, `pusher-js`, `@tanstack/react-query`, `@tanstack/react-query-devtools`, `@hello-pangea/dnd`, `sonner`, `react-hook-form`, `zod`
  - Install dev dependencies: `vitest`, `@vitest/coverage-v8`, `fast-check`, `@types/bcryptjs`, `@types/node`
  - Create `.env.local` template with keys: `DATABASE_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER`, `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
  - Add `vitest.config.ts` with path aliases matching `tsconfig.json`
  - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

- [x] 2. Prisma schema and database migrations
  - [x] 2.1 Write the complete Prisma schema
    - Define `datasource db` (postgresql) and `generator client`
    - Add Auth.js required models: `User`, `Account`, `Session`, `VerificationToken`
    - Add trip models: `Trip` (with `TripType` enum), `TripMember` (with `TripRole` enum), `InvitationLink`
    - Add itinerary model: `ItineraryItem` (with `ItemCategory` enum); include `@@index([tripId, date, sortIndex])`
    - Add expense models: `Expense` (with `ExpenseCategory` enum, `amount BigInt`), `ExpenseSplit`
    - Add recommendation model: `Place` (with `PlaceCategory` enum)
    - Enforce all unique constraints: `TripMember(tripId, userId)`, `ExpenseSplit(expenseId, memberId)`, `Account(provider, providerAccountId)`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 17.6_

  - [x] 2.2 Create and run the initial Prisma migration
    - Run `prisma migrate dev --name init` to generate SQL migration file
    - Verify all tables and constraints exist in the database
    - _Requirements: 15.1–15.7_

  - [x] 2.3 Add pg_trgm extension and GIN indexes for place search
    - Create a second migration that enables `pg_trgm` extension
    - Add `CREATE INDEX place_name_trgm ON "Place" USING GIN (name gin_trgm_ops)`
    - Add `CREATE INDEX place_city_trgm ON "Place" USING GIN (city gin_trgm_ops)`
    - _Requirements: 14.9_

  - [x] 2.4 Create the Prisma client singleton
    - Write `src/lib/prisma.ts` that exports a single `PrismaClient` instance, reusing it across hot-reloads in development
    - _Requirements: 17.3_

- [ ] 3. Authentication infrastructure
  - [x] 3.1 Implement Redis-backed login rate limiter
    - Write `src/lib/rate-limit.ts` using Upstash Redis REST client
    - Export `checkLoginRateLimit(ip)`, `recordFailedAttempt(ip)`, `resetAttempts(ip)`
    - Block after 5 consecutive failures within 10 minutes; enforce a 15-minute block
    - _Requirements: 1.9_

  - [-] 3.2 Configure Auth.js v5
    - Write `src/lib/auth.ts` exporting `{ handlers, auth, signIn, signOut }`
    - Configure `PrismaAdapter`, `session: { strategy: 'jwt', maxAge: 86400 }`
    - Add `Google` provider and `Credentials` provider
    - In `authorize`: call `checkLoginRateLimit`, fetch user, `bcrypt.compare` password, call `recordFailedAttempt` or `resetAttempts`
    - Add `jwt` and `session` callbacks to propagate `user.id` into the token and session
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 1.9, 2.1, 2.2, 2.3_

  - [ ] 3.3 Create Auth.js route handler and Pusher auth endpoint
    - Write `src/app/api/auth/[...nextauth]/route.ts` that re-exports `handlers` from `lib/auth.ts`
    - Write `src/app/api/pusher/auth/route.ts`: validate session via `auth()`, verify `TripMember` membership for the requested channel, sign and return Pusher channel auth response with HTTP 403 for non-members
    - _Requirements: 2.1, 7.6, 16.1, 16.3_

  - [ ] 3.4 Implement route protection middleware
    - Write `src/middleware.ts` using `auth` from `lib/auth.ts`
    - Allow public paths: `/login`, `/register`, `/api/auth`
    - Redirect unauthenticated requests to `/login`
    - _Requirements: 16.1_

  - [ ] 3.5 Implement auth Server Actions
    - Write `src/actions/auth.actions.ts`
    - `registerAction(email, password)`: validate RFC 5322 email, validate password length (8–128), check for duplicate email (return `CONFLICT` error), hash with `bcrypt` work factor 12, create `User`
    - `loginAction(email, password)`: extract IP from request headers, pass to `signIn` with Credentials provider
    - Return `ActionResult<T>` discriminated union for all outcomes
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7_

- [ ] 4. RBAC guard and AppError
  - Write `src/lib/rbac.ts` exporting `withTripAccess<T>(tripId, requiredRoles, fn)`
  - Validate session via `auth()`; throw `AppError('UNAUTHORIZED')` when no session
  - Look up `TripMember`; throw `AppError('NOT_FOUND')` when not a member (avoids trip existence disclosure)
  - Throw `AppError('FORBIDDEN')` when role not in `requiredRoles`; call `fn(member)` otherwise
  - Write `src/lib/errors.ts` defining `AppError` with codes: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `CONFLICT`, `SERVICE_UNAVAILABLE`
  - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

- [ ] 5. Pusher server and client singletons
  - Write `src/lib/pusher.ts` exporting a server-side `Pusher` instance (reuse across invocations)
  - Write `src/lib/pusher-client.ts` exporting a `PusherJs` browser singleton keyed by `NEXT_PUBLIC_PUSHER_KEY`/`NEXT_PUBLIC_PUSHER_CLUSTER`
  - _Requirements: 7.2, 7.6_

- [ ] 6. Budget utility pure functions
  - [ ] 6.1 Implement `computeEqualSplit`
    - Write `src/lib/budget/split.ts`
    - `computeEqualSplit(amount: bigint, memberIds: string[]): Map<string, bigint>`
    - Divide `amount` evenly; assign remainder (`amount % BigInt(N)`) to the first member
    - Validate: amount in `[1n, 999_999_999_999n]`, memberIds length in `[2, 50]`
    - _Requirements: 12.2, 15.6, 17.7_

  - [ ] 6.2 Implement `validateCustomSplit`
    - Add `validateCustomSplit(amount, shares): Map<string, bigint>` to `src/lib/budget/split.ts`
    - Throw `SplitValidationError` if `Σ shares !== amount`; return map on success
    - _Requirements: 12.3, 15.6, 17.7_

  - [ ] 6.3 Implement `computeNetBalances` and `computeSettlements`
    - Write `src/lib/budget/settlement.ts`
    - `computeNetBalances(members, expenses): NetBalance[]` — pure, no I/O
    - `computeSettlements(balances): Settlement[]` — greedy min-flow; verify zero-sum invariant; produce ≤ N−1 settlements
    - Export `Settlement` and `NetBalance` TypeScript types
    - _Requirements: 12.4, 12.5, 12.6, 15.6, 17.7_

  - [ ] 6.4 Implement `computeAnalytics`
    - Write `src/lib/budget/analytics.ts`
    - `computeAnalytics(expenses, budgetTarget): BudgetAnalytics`
    - Compute `totalSpent`, `remaining` (`target - spent`), and `byCategory` breakdown
    - Handle `null` budget target gracefully
    - Export `BudgetAnalytics` type
    - _Requirements: 7.3, 10.4, 13.1, 13.2, 13.3, 15.6_

- [ ] 7. Property-based tests for budget utilities
  - [ ] 7.1 Write property tests for `computeEqualSplit` (Property 1)
    - Create `tests/property/budget/split.property.test.ts`
    - Use `fc.bigInt({ min: 1n, max: 999_999_999_999n })` and `fc.array(fc.uuid(), { minLength: 2, maxLength: 50 })`
    - Assert `Σ shares === amount`; run minimum 200 iterations
    - Tag: `// Feature: travel-planner-saas, Property 1: Equal-split shares are lossless`
    - _Requirements: 12.2, 15.6_

  - [ ]* 7.2 Write property tests for `validateCustomSplit` (Property 2)
    - Add to `tests/property/budget/split.property.test.ts`
    - Round-trip: valid custom splits pass through unchanged; invalid sums always throw `SplitValidationError`
    - Tag: `// Feature: travel-planner-saas, Property 2: Custom-split round-trip`
    - _Requirements: 12.3_

  - [ ] 7.3 Write property tests for `computeNetBalances` + `computeSettlements` (Properties 3 & 4)
    - Create `tests/property/budget/settlement.property.test.ts`
    - Property 3: `Σ balances === 0n` after `computeNetBalances`; after applying all settlements every balance resolves to `0n`
    - Property 4: `settlements.length <= nonZeroMembers - 1`
    - Tag: `// Feature: travel-planner-saas, Property 3: Settlement zero-sum and completeness`
    - Tag: `// Feature: travel-planner-saas, Property 4: Settlement minimality`
    - _Requirements: 12.4, 12.5, 12.6_

  - [ ]* 7.4 Write property test for settlement idempotence (Property 5)
    - Add to `tests/property/budget/settlement.property.test.ts`
    - Assert two calls with same balances produce equivalent tuple sets
    - Tag: `// Feature: travel-planner-saas, Property 5: Settlement idempotence`
    - _Requirements: 12.6_

  - [ ] 7.5 Write property test for `computeAnalytics` (Property 6)
    - Create `tests/property/budget/analytics.property.test.ts`
    - Assert `remaining === target - totalSpent`; all category spends sum to `totalSpent`
    - Tag: `// Feature: travel-planner-saas, Property 6: Budget remaining arithmetic invariant`
    - _Requirements: 7.3, 10.4, 13.3, 15.6_

  - [ ]* 7.6 Write property test for monetary no-overflow (Property 11)
    - Create `tests/property/data-integrity/monetary.property.test.ts`
    - Assert that summing up to 1,000 expenses each ≤ 999,999,999,999 stays within `bigint` 64-bit signed range
    - Tag: `// Feature: travel-planner-saas, Property 11: Monetary integer no-overflow`
    - _Requirements: 15.6_

- [ ] 8. Checkpoint — Run `vitest --run` and confirm all property tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Trip Server Actions
  - [ ] 9.1 Implement `createTripAction` and `getTripAction`
    - Write `src/actions/trip.actions.ts`
    - `createTripAction(input)`: validate destination (non-empty, ≤100 chars), type enum, date range (start ≤ end, duration 1–365, start not in past), create `Trip` + `TripMember(Owner)` in one transaction
    - `getTripAction(tripId)`: use `withTripAccess`; return trip with members and budget summary
    - Return `ActionResult<T>`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 16.1, 16.3_

  - [ ] 9.2 Implement `updateTripAction` and `deleteTripAction`
    - `updateTripAction(tripId, input)`: `withTripAccess([Owner, Editor])`; partial update; reject if new date range would orphan existing `ItineraryItems`; validate date range
    - `deleteTripAction(tripId)`: `withTripAccess([Owner])`; cascade delete via Prisma (FK cascades); return confirmation
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 16.2, 16.4_

  - [ ] 9.3 Implement invitation and membership actions
    - `generateInvitationAction(tripId, role)`: `withTripAccess([Owner, Editor])`; validate role ∈ {Editor, Viewer}; create `InvitationLink` expiring in 7 days
    - `acceptInvitationAction(token)`: validate expiry and used-status; create `TripMember` with link's role; mark link as used
    - `changeMemberRoleAction(tripId, memberId, newRole)`: `withTripAccess([Owner])`; enforce single-Owner invariant
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_

- [ ] 10. Itinerary Server Actions
  - [ ] 10.1 Implement `createItineraryItemAction` and `updateItineraryItemAction`
    - Write `src/actions/itinerary.actions.ts`
    - `createItineraryItemAction(tripId, input)`: `withTripAccess([Owner, Editor])`; validate date within trip range, duration 1–1440, field lengths; append item with next `sortIndex` for the day; trigger Pusher `itinerary:item-created`
    - `updateItineraryItemAction(itemId, input)`: `withTripAccess([Owner, Editor])`; validate fields; trigger `itinerary:item-updated`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.6, 8.7, 8.9_

  - [ ] 10.2 Implement `deleteItineraryItemAction` and `reorderItineraryItemsAction`
    - `deleteItineraryItemAction(itemId)`: `withTripAccess([Owner, Editor])`; remove item; trigger `itinerary:item-deleted`; return updated ordered day list
    - `reorderItineraryItemsAction(payload: ReorderPayload)`: `withTripAccess([Owner, Editor])`; acquire PostgreSQL advisory lock via `SELECT pg_advisory_xact_lock(hashtext(tripId || date))`; re-assign contiguous `sortIndex` values within a transaction; trigger `itinerary:reordered`
    - _Requirements: 8.5, 8.8, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [ ] 11. Expense Server Actions
  - [ ] 11.1 Implement `logExpenseAction`
    - Write `src/actions/expense.actions.ts`
    - Validate amount (1–999,999,999,999), category enum, description (≤255 chars), payer is TripMember
    - Accept `SplitInput`; call `computeEqualSplit` or `validateCustomSplit`; create `Expense` + `ExpenseSplit` records in one transaction
    - Trigger Pusher `expense:created` with updated `totalSpent`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 12.1, 12.2, 12.3, 12.7, 12.8, 12.9_

  - [ ] 11.2 Implement `deleteExpenseAction`, `computeSettlementsAction`, `getBudgetSummaryAction`
    - `deleteExpenseAction(expenseId)`: `withTripAccess([Owner, Editor])`; delete expense + splits; recalculate total spent; trigger `expense:deleted`
    - `computeSettlementsAction(tripId)`: `withTripAccess([TripMember])`; load expenses + splits; call `computeNetBalances` then `computeSettlements`; return `Settlement[]`
    - `getBudgetSummaryAction(tripId)`: `withTripAccess([TripMember])`; return target, spent, remaining
    - _Requirements: 11.7, 11.8, 12.4, 12.5, 12.6, 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ] 11.3 Implement `setBudgetTargetAction` and `getAnalyticsAction`
    - `setBudgetTargetAction(tripId, amount)`: `withTripAccess([Owner, Editor])`; validate range (1–999,999,999,999); persist `budgetTarget`; trigger `budget:target-updated`
    - `getAnalyticsAction(tripId)`: `withTripAccess([TripMember])`; load expenses; call `computeAnalytics`; return `BudgetAnalytics`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 13.1, 13.2, 13.3, 13.4_

- [ ] 12. Recommendation Server Actions
  - Write `src/actions/recommendation.actions.ts`
  - `searchPlacesAction(query)`: validate length 2–100; Prisma `findMany` with `OR [name, city]` using `mode: 'insensitive'`; `take: 50`, `orderBy: { name: 'asc' }`
  - `browseByCategory(category)`: validate category enum; Prisma `findMany` filtered by category; `take: 50`, `orderBy: { name: 'asc' }`
  - Return `ActionResult<Place[]>` in both cases
  - _Requirements: 14.2, 14.3, 14.4, 14.5, 14.6, 14.8, 14.9_

- [ ] 13. Checkpoint — Ensure all Server Actions compile without TypeScript errors
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Real-time client hook and TanStack Query setup
  - [ ] 14.1 Implement `useTripChannel` hook
    - Write `src/hooks/useTripChannel.ts`
    - Subscribe to `private-trip-{tripId}` on mount; unsubscribe on unmount
    - Bind all events from the event catalogue (itinerary:*, expense:*, member:*, budget:*); call `queryClient.invalidateQueries` with appropriate query keys
    - Track `connected` state via `pusherClient.connection` `unavailable`/`connected` events
    - Return `{ connected }`
    - _Requirements: 7.2, 7.6_

  - [ ] 14.2 Set up TanStack Query provider
    - Create `src/app/(app)/layout.tsx` (authenticated layout)
    - Wrap children in `<QueryClientProvider>` and Auth.js `<SessionProvider>`
    - _Requirements: 17.4_

- [ ] 15. Auth UI components
  - [ ] 15.1 Implement `RegisterForm`
    - Write `src/components/auth/RegisterForm.tsx`
    - Use `react-hook-form` + Zod for client-side validation (email format, password 8–128)
    - Call `registerAction` on submit; display field-level errors and toast notifications via Sonner
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ]* 15.2 Implement `LoginForm`
    - Write `src/components/auth/LoginForm.tsx`
    - Credentials form + Google OAuth button (`signIn('google')`)
    - Call `loginAction` on submit; display rate-limit and generic auth errors via Sonner
    - _Requirements: 1.5, 1.6, 1.7, 1.9, 2.1, 2.4, 2.5_

  - [ ] 15.3 Create auth pages
    - Write `src/app/(auth)/login/page.tsx` rendering `<LoginForm />`
    - Write `src/app/(auth)/register/page.tsx` rendering `<RegisterForm />`
    - _Requirements: 1.1, 1.5_

- [ ] 16. Trip UI components
  - [ ] 16.1 Implement `TripCard`, `TripCreateDialog`, `TripEditDialog`
    - Write `src/components/trips/TripCard.tsx`: display destination, date range, type; link to `/trips/[tripId]`
    - Write `src/components/trips/TripCreateDialog.tsx`: form calling `createTripAction`; validate fields client-side
    - Write `src/components/trips/TripEditDialog.tsx`: pre-populated form calling `updateTripAction`; show date-range conflict errors
    - _Requirements: 4.1–4.8, 5.1–5.7_

  - [ ] 16.2 Create Trip dashboard page and trip list (dashboard)
    - Write `src/app/(app)/dashboard/page.tsx`: fetch user's trips; render list of `<TripCard />`; include `<TripCreateDialog />` trigger
    - _Requirements: 7.1_

- [ ] 17. Core dashboard UI components
  - [ ] 17.1 Implement `DashboardHeader`, `MemberList`, `BudgetSummaryWidget`, `ConnectionStatusBanner`
    - `src/components/dashboard/DashboardHeader.tsx`: render trip name, destination, dates, type
    - `src/components/dashboard/MemberList.tsx`: render TripMembers with roles; show role-change controls for Owner
    - `src/components/dashboard/BudgetSummaryWidget.tsx`: display target, spent, remaining; call `getBudgetSummaryAction` via TanStack Query
    - `src/components/dashboard/ConnectionStatusBanner.tsx`: render banner when `connected === false`
    - _Requirements: 7.1, 7.3, 7.4, 7.6_

  - [ ] 17.2 Implement `TripDashboard` and trip page
    - Write `src/components/dashboard/TripDashboard.tsx`
    - Use `useTripChannel(tripId)` to subscribe to real-time events
    - Render `DashboardHeader`, `MemberList`, `BudgetSummaryWidget`, tab navigation to itinerary/expenses
    - Show `<ConnectionStatusBanner />` conditionally
    - Write `src/app/(app)/trips/[tripId]/page.tsx` fetching initial data server-side and passing to `<TripDashboard />`
    - _Requirements: 7.1, 7.2, 7.4, 7.5, 7.6_

- [ ] 18. Itinerary UI components
  - [ ] 18.1 Implement `ItineraryItemForm`
    - Write `src/components/itinerary/ItineraryItemForm.tsx`
    - `react-hook-form` + Zod: placeName (≤100), address (≤255), category, notes (≤1000), duration (1–1440), optional mapsUrl
    - Read `?prefill` URL params on mount to pre-populate fields from place recommendation
    - Call `createItineraryItemAction` or `updateItineraryItemAction`
    - _Requirements: 8.1, 8.2, 8.7, 8.9, 14.7_

  - [ ] 18.2 Implement `ItineraryItemCard` and `DayColumn`
    - Write `src/components/itinerary/ItineraryItemCard.tsx`: render item details; include edit/delete controls for Owner/Editor; wrap in `<Draggable>`
    - Write `src/components/itinerary/DayColumn.tsx`: render a single calendar day; wrap in `<Droppable>`; call `deleteItineraryItemAction`
    - _Requirements: 8.4, 8.5, 8.6, 9.1_

  - [ ] 18.3 Implement `ItineraryPlanner`
    - Write `src/components/itinerary/ItineraryPlanner.tsx`
    - Wrap with `@hello-pangea/dnd` `<DragDropContext>`; render one `<DayColumn>` per calendar day in trip range
    - `onDragEnd` handler: apply optimistic update locally, call `reorderItineraryItemsAction`, reconcile on `itinerary:reordered` event
    - Disable drag for Viewer role
    - Write `src/app/(app)/trips/[tripId]/itinerary/page.tsx`
    - _Requirements: 9.1, 9.2, 9.4, 9.5, 17.5_

- [ ] 19. Expense UI components
  - [ ] 19.1 Implement `SplitConfigPanel`
    - Write `src/components/expenses/SplitConfigPanel.tsx`
    - Toggle between equal-split and custom-split modes
    - Equal mode: call `computeEqualSplit` client-side for live preview
    - Custom mode: per-member amount inputs with live sum validation showing mismatch error
    - _Requirements: 12.1, 12.2, 12.3_

  - [ ] 19.2 Implement `ExpenseLogForm`
    - Write `src/components/expenses/ExpenseLogForm.tsx`
    - `react-hook-form` + Zod: amount (1–999,999,999,999), category, description (≤255), date, payer selection
    - Embed `<SplitConfigPanel />` for group splits
    - Call `logExpenseAction` on submit
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.6_

  - [ ] 19.3 Implement `ExpenseList` and `SettlementSummary`
    - Write `src/components/expenses/ExpenseList.tsx`: list expenses with delete control for Owner/Editor
    - Write `src/components/expenses/SettlementSummary.tsx`: call `computeSettlementsAction`; render each `Settlement` tuple as a readable card; show empty state when all balanced
    - Write `src/app/(app)/trips/[tripId]/expenses/page.tsx`
    - _Requirements: 11.7, 11.8, 12.4, 12.5, 12.6_

- [ ] 20. Place recommendation UI components
  - [ ] 20.1 Implement `PlaceSearchBar` and `PlaceCard`
    - Write `src/components/recommendations/PlaceSearchBar.tsx`: debounced input; call `searchPlacesAction` via TanStack Query; show validation error for <2 and >100 chars
    - Write `src/components/recommendations/PlaceCard.tsx`: display name, city, category, description, optional image; include "Add to Itinerary" button that navigates to itinerary page with prefill params
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.7_

  - [ ] 20.2 Implement `PlaceCategoryBrowser` and recommendation page
    - Write `src/components/recommendations/PlaceCategoryBrowser.tsx`: category tabs/pills; call `browseByCategory` via TanStack Query; render `<PlaceCard />` grid
    - Write a recommendations page or modal reachable from the itinerary view
    - _Requirements: 14.5, 14.6, 14.9_

- [ ] 21. Database seed — Indonesian places dataset
  - Write `src/prisma/seed.ts`
  - Define a static array of at least 30 Indonesian `Place` objects covering all 6 `PlaceCategory` values and multiple cities/provinces
  - Use `prisma.place.createMany` with `skipDuplicates: true`
  - Add `"prisma": { "seed": "ts-node prisma/seed.ts" }` to `package.json`
  - _Requirements: 14.1, 14.8_

- [ ] 22. Checkpoint — Ensure full app builds and auth flows work end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 23. Property-based tests for itinerary reorder, search, and data integrity
  - [ ] 23.1 Write property test for itinerary reorder invariants (Property 7)
    - Create `tests/property/itinerary/reorder.property.test.ts`
    - Generate arbitrary item lists and arbitrary reorder operations; assert permutation invariant (same IDs) and strict-increasing sortIndex
    - Tag: `// Feature: travel-planner-saas, Property 7: Itinerary reorder permutation invariant`
    - _Requirements: 9.1, 9.2, 9.4_

  - [ ]* 23.2 Write property test for place search subset invariant (Property 8)
    - Create `tests/property/recommendations/search.property.test.ts`
    - For a fixed dataset, assert every returned place contains the query in name or city (case-insensitive)
    - Tag: `// Feature: travel-planner-saas, Property 8: Place search subset invariant`
    - _Requirements: 14.2_

  - [ ]* 23.3 Write property test for category filter invariant (Property 9)
    - Add to `tests/property/recommendations/search.property.test.ts`
    - Assert every returned place has `category === requestedCategory`
    - Tag: `// Feature: travel-planner-saas, Property 9: Place category filter invariant`
    - _Requirements: 14.5_

  - [ ]* 23.4 Write property test for search monotonicity (Property 10)
    - Add to `tests/property/recommendations/search.property.test.ts`
    - Assert that result set of prefix Q ⊇ result set of extension Q'
    - Tag: `// Feature: travel-planner-saas, Property 10: Search monotonicity`
    - _Requirements: 14.9_

  - [ ] 23.5 Write property test for Single Owner invariant (Property 12)
    - Create `tests/property/data-integrity/owner-invariant.property.test.ts`
    - Assert that no role change can produce 0 or 2+ Owners; test the guard in `changeMemberRoleAction` logic
    - Tag: `// Feature: travel-planner-saas, Property 12: Single Owner invariant`
    - _Requirements: 6.9_

  - [ ]* 23.6 Write property test for trip date validation boundary (Property 13)
    - Create `tests/property/data-integrity/date-validation.property.test.ts`
    - Assert `startDate > endDate` always rejected; duration > 365 always rejected
    - Tag: `// Feature: travel-planner-saas, Property 13: Trip date validation boundary`
    - _Requirements: 4.3, 5.7_

  - [ ]* 23.7 Write property test for display name round-trip (Property 14)
    - Create `tests/property/data-integrity/profile.property.test.ts`
    - Assert valid names (1–64 chars) persist unchanged; invalid lengths always rejected
    - Tag: `// Feature: travel-planner-saas, Property 14: Display name round-trip`
    - _Requirements: 3.3, 3.4_

- [ ] 24. Unit tests for auth, trips, and RBAC
  - [ ]* 24.1 Write unit tests for registration and login flows
    - Create `tests/unit/auth/register.test.ts` and `tests/unit/auth/login.test.ts`
    - Cover: valid registration, duplicate email, invalid email format, password too short/long, successful login, wrong password, unknown email, rate-limit block
    - _Requirements: 1.1–1.9_

  - [ ]* 24.2 Write unit tests for trip creation and RBAC
    - Create `tests/unit/trips/create.test.ts` and `tests/unit/trips/rbac.test.ts`
    - Cover: valid creation, invalid date range, past start date, destination too long; Owner/Editor/Viewer permission matrix
    - _Requirements: 4.1–4.8, 16.1–16.6_

  - [ ]* 24.3 Write unit tests for itinerary item validation
    - Create `tests/unit/itinerary/validation.test.ts`
    - Cover: duration bounds, out-of-range date, field length limits, Viewer rejection
    - _Requirements: 8.1–8.9_

- [ ] 25. Integration tests
  - [ ]* 25.1 Write integration test for full expense → split → settlement workflow
    - Create `tests/integration/expense-settlement.test.ts`
    - Seed a trip with members; log multiple expenses with splits; assert settlement output resolves all balances to zero
    - _Requirements: 12.4, 12.5, 12.6_

  - [ ]* 25.2 Write integration test for cascade deletes
    - Create `tests/integration/cascade-delete.test.ts`
    - Create trip with itinerary items, expenses, splits; delete trip; assert all child records removed
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

  - [ ]* 25.3 Write integration test for concurrent reorder serialization
    - Create `tests/integration/concurrent-reorder.test.ts`
    - Simulate two concurrent `reorderItineraryItemsAction` calls on same day; assert final state is consistent (no duplicate/missing IDs)
    - _Requirements: 9.3, 9.6_

- [ ] 26. Final checkpoint — Ensure all tests pass
  - Run `vitest --run` and verify zero failing tests
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP delivery
- All monetary values use `bigint` throughout — never `number` — to eliminate floating-point rounding errors
- All Server Actions return `ActionResult<T>` (discriminated union); never throw across the server/client boundary
- Non-member requests always return 404 (not 403) to prevent trip existence disclosure (Requirement 16.3)
- The `withTripAccess` guard must be called in every Server Action that touches trip-scoped data
- Pusher events must be triggered **after** a successful database write, never before
- `@hello-pangea/dnd` requires the component tree to be wrapped in `<DragDropContext>` at the `ItineraryPlanner` level, not higher
- Property test files must tag each test with `// Feature: travel-planner-saas, Property N: <title>` for traceability
- The PostgreSQL advisory lock in `reorderItineraryItemsAction` must be acquired **inside** a Prisma `$transaction` callback so it is automatically released on commit or rollback

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1"] },
    { "id": 1, "tasks": ["2.2", "2.4"] },
    { "id": 2, "tasks": ["2.3", "3.1"] },
    { "id": 3, "tasks": ["3.2", "5"] },
    { "id": 4, "tasks": ["3.3", "3.4", "3.5", "4"] },
    { "id": 5, "tasks": ["6.1", "6.2", "6.3", "6.4"] },
    { "id": 6, "tasks": ["7.1", "7.3", "7.5", "7.6"] },
    { "id": 7, "tasks": ["7.2", "7.4"] },
    { "id": 8, "tasks": ["9.1", "10.1", "11.1", "12"] },
    { "id": 9, "tasks": ["9.2", "9.3", "10.2", "11.2", "11.3"] },
    { "id": 10, "tasks": ["14.1", "14.2"] },
    { "id": 11, "tasks": ["15.1", "15.2", "15.3", "16.1", "16.2"] },
    { "id": 12, "tasks": ["17.1", "17.2"] },
    { "id": 13, "tasks": ["18.1", "19.1", "20.1"] },
    { "id": 14, "tasks": ["18.2", "19.2", "20.2"] },
    { "id": 15, "tasks": ["18.3", "19.3"] },
    { "id": 16, "tasks": ["21"] },
    { "id": 17, "tasks": ["23.1", "23.5"] },
    { "id": 18, "tasks": ["23.2", "23.3", "23.4", "23.6", "23.7", "24.1", "24.2", "24.3"] },
    { "id": 19, "tasks": ["25.1", "25.2", "25.3"] }
  ]
}
```
