# Cloud setup and verification

Life OS runs without cloud credentials in explicitly labeled local mode. Local records stay in the current browser. Cloud synchronization and AI are real integrations; neither is replaced by a mock service.

## Supabase

Current connection-only status and the proposed schema are in [SUPABASE_CONNECTION.md](SUPABASE_CONNECTION.md). No migration is applied by application startup or the read-only `npm run check:supabase` command. The steps below describe the later full cloud-sync setup.

1. Follow [DATABASE_DEPLOYMENT.md](DATABASE_DEPLOYMENT.md): preflight, then missing migrations in order `202610260001_life_os.sql`, `202610270001_schema_hardening.sql`, `202610270002_final_audit.sql`. Each transaction is applied once. Never replay installed migrations. Run `supabase/verify_schema.sql` afterwards. See [DATABASE_AUDIT.md](DATABASE_AUDIT.md) for local test evidence. Nothing deploys automatically.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local`. The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also supported. Preserve existing environment values; never use a service-role key.
3. In Authentication → URL configuration, set the Site URL to your deployment URL. Add `http://127.0.0.1:3000/auth/callback` and your deployed `/auth/callback` URL to allowed redirect URLs. Add a localhost callback too if you browse through localhost.
4. Configure your email provider and email confirmation settings. Google OAuth is optional; enable and configure it in Supabase before offering Google sign-in.
5. Restart the development server after changing environment variables. Sign up, verify the email if required, sign in, and use the app's cloud sync controls.

The browser and server clients use the cookie/PKCE integration from [Supabase's SSR guide](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&queryGroups=framework). The proxy refreshes the session. Server data routes call `getUser()` to validate authentication. Responses carrying user data use `Cache-Control: private, no-store`.

### Storage contract

`GET /api/data` returns `{ data: AppData, revision: number, userId: string }`. A new account receives empty app data at revision zero. `PUT /api/data` accepts `{ data: AppData, revision: number, userId: string }` and returns the new revision and authenticated user ID. Requests whose captured user ID differs from the server session are rejected, preventing a sign-in transition from writing one account's pending data into another account. The database locks the user's revision row and writes the whole snapshot in one transaction. A stale revision returns HTTP 409; the app keeps its local copy instead of overwriting newer cloud data.

Persisted record IDs are UUIDs. Recurrence occurrence IDs such as `master-uuid::2026-10-26` are view identifiers; detach an edited occurrence to a fresh UUID and add the original date to the master's exclusions before syncing it. Times remain local clock values interpreted in the saved IANA timezone. Deadlines remain separate from event working times.

The canonical records are events, tasks, user preferences, meal templates, workout plans and exercise logs. Weekly rules, exceptions and plan exercises are stored in child tables and reconstructed on load. All six app collections are synchronized. Class/meal/workout metadata, proposal-history and notification tables provide tenant-isolated extension points; those optional tables are not separate timeline data sources or a background reminder service. Historical exercise logs retain their event/exercise reference strings so deleting a plan does not erase recorded performance.

Every user table has RLS. Tenant-owned foreign keys include `user_id`, preventing a child row from referencing another user's event or plan. Both RPCs use `SECURITY INVOKER`, an empty search path and `auth.uid()`. No administrator key is used in the app.

### Required live checks

Migrations/RLS have passed local PGlite and native PostgreSQL tests. Direct writes also lock and advance revision; the new value may exceed N+1. Internal user_sync_state cannot be deleted/reset through the API. Before releasing cloud sync, verify these using real JWTs in a disposable Supabase staging project:

- Create two accounts A and B. As A, save a snapshot containing an event, task, weekly recurrence with an exclusion, meal template, workout plan and exercise log; load it and compare all fields. Repeat after a reload and after sign-out/sign-in.
- As B, query each table for A's user ID using B's authenticated browser client. SELECT must return no rows. Attempts to INSERT or UPDATE a row with A's `user_id` must fail. The RPC must only load B's data.
- Load revision N on two clients. Save client 1 with N, then client 2 with N. Client 2 must receive HTTP 409 and retain its unsynced local copy.
- Force an invalid row inside a snapshot write and verify the transaction rolls back rather than partially deleting records.
- Exercise email confirmation, password recovery, sign-out and any enabled OAuth provider on the exact deployed origin.

An executable live check is provided at `supabase/tests/rls.mjs`. Create **two different disposable confirmed accounts**, then set these environment variables without putting credentials into shell command arguments: `LIFE_OS_RUN_LIVE_TESTS=1`, `LIFE_OS_TEST_EMAIL_A`, `LIFE_OS_TEST_PASSWORD_A`, `LIFE_OS_TEST_EMAIL_B`, `LIFE_OS_TEST_PASSWORD_B`. With Supabase public settings in `.env.local`, run `node --env-file=.env.local supabase/tests/rls.mjs`. The script signs in with the two ordinary account sessions, verifies denied cross-account reads/writes and tenant foreign keys, then tests revision conflicts and transaction rollback through the real RPCs. It restores the test snapshot and removes marker events. A new test account may retain initialized default preferences and a higher revision. The script uses no service-role key and skips explicitly if configuration is absent. It is intended only for disposable accounts without concurrent editing.

The normal `npm test` suite includes mocked-provider/auth route checks in `tests/backend-plan.test.ts` and `tests/backend-data.test.ts`. These exercise actual handler validation and error behavior; they do not substitute for the live database checks above.

## Gemini

Set `GEMINI_API_KEY` on the server and optionally `GEMINI_MODEL` to a structured-output capable model available to your account. The default is `gemini-2.5-flash`; it is configurable because model availability varies by account and time. Never expose this secret through a `NEXT_PUBLIC_` variable or browser code.

`POST /api/plan` accepts `{ prompt, mode, scope?: "day" | "week", date, events, tasks, preferences }` and returns `{ proposal: { id, summary, events, warnings, changes } }`. The request uses Google's [structured JSON output API](https://ai.google.dev/gemini-api/docs/generate-content/structured-output). Generated content is separately validated with Zod and the local constraint engine. Invalid output, protected-event edits, conflicts, dates outside the reviewed range and deadline/routine violations return an error and leave the calendar untouched. Accepted responses are previews; only the user's explicit Accept Plan action changes app data.

Only the reviewed date range?s event scheduling fields, open task scheduling fields, and routine preferences are sent as context. Private event notes, locations, profile name and exercise logs are excluded. The user-entered planning request itself is sent to Gemini. AI has no database write access.

Hosted AI requests require an authenticated Supabase user. Local development without Supabase is allowed only on loopback hosts when `NODE_ENV` is not `production`. Each process limits requests to five per user per fifteen minutes, bounds request sizes, and aborts Gemini requests after 45 seconds. This in-memory limit is a development safeguard, not a distributed quota: configure a durable platform rate limiter and budget controls before a public release.

Without a key, AI returns HTTP 503 with a setup message; ordinary scheduling remains usable. Without Supabase on a hosted deployment, AI requires cloud authentication setup. Real provider responses, quota handling and configured model compatibility remain unverified until a valid key is supplied.

## Vercel

Import this Next.js repository in Vercel, set the same environment variables, deploy, and add the exact deployed callback URL to Supabase. Redeploy after changing public environment variables because Next.js embeds public values during its build. The SQL migration must be applied independently. No Vercel project, Supabase project, API key or deployment has been provisioned automatically.

## Notifications

The app's foreground reminders depend on an open app tab. Browser notification permission, when enabled in the app, does not provide a background scheduler. Web Push and an unattended delivery worker are not implemented by these routes or database tables.
