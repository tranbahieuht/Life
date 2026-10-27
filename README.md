# LIFE OS

Your life. Beautifully organized.

A Next.js personal planning application centered on a block-based daily timeline. Classes, focus sessions, tasks, meals, workouts, and rest share one event source. The application starts with an empty personal workspace; sample content is available only through **demo mode**.

## Run locally

Requires Node.js 22.12+ (Node 24 LTS recommended for development and tests). The checked-in lockfile records the tested dependency versions.

```powershell
npm ci
npm run dev
```

Open **http://127.0.0.1:3000**. Without credentials, this is a real browser-local workspace with persistence, backup export/import, and all manual planning tools. It does not claim cloud synchronization or AI generation.

```powershell
npm run typecheck
npm test
npm run build
npm start
```

The launcher selects Next.js's official WebAssembly compiler on Windows machines where application control prevents loading its native compiler. Webpack is used for compatibility with that fallback. On other machines, the normal native compiler remains available. No operating-system security policy is changed.

## Connect Supabase

1. Create a Supabase project.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local`, preserving any existing environment settings. The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` remains supported. Never use a service-role key in the browser. Run `npm run check:supabase` for a read-only connection check; see [connection status and proposed schema](docs/SUPABASE_CONNECTION.md). Authentication can be connected before business tables are created.
3. Follow [the SQL Editor deployment guide](docs/DATABASE_DEPLOYMENT.md). Apply missing migrations in order: [baseline](supabase/migrations/202610260001_life_os.sql), [hardening](supabase/migrations/202610270001_schema_hardening.sql), [final audit fixes](supabase/migrations/202610270002_final_audit.sql). Never replay installed migrations. Run [read-only verification](supabase/verify_schema.sql) afterwards. No migration runs automatically. See [audit findings](docs/DATABASE_AUDIT.md).
4. Enable email/password authentication. Set the Site URL and allow `http://127.0.0.1:3000/auth/callback` and your deployed `https://YOUR_DOMAIN/auth/callback` as redirect URLs. Use the same host consistently for your sign-in/reset flow.
5. Restart Next.js, open your profile, and create an account or sign in. Cloud and local workspaces are separate. To transfer existing local work, export it, sign in, and import the backup after reviewing the replacement confirmation.

Sign-up confirmation and reset emails use Supabase's configured email provider. Google OAuth is not currently implemented. Supabase data requests verify the signed-in user on the server; RLS is not bypassed. Cloud saves use revision checks, retain unsynced device changes, and ask which copy to keep after a conflict.

For detailed schema, security, and live verification instructions, read [BACKEND.md](docs/BACKEND.md).

## Connect Gemini

Add `GEMINI_API_KEY` to `.env.local`. Optionally set `GEMINI_MODEL` to a supported model in your Google project. Restart Next.js.

AI Planner supports one-day and seven-day proposals, three planning modes, existing commitments, task deadlines, and routine preferences. Proposals are validated and previewed before **Accept plan** writes any changes. Fixed commitments stay protected; omitted activities remain in the calendar. Gemini's key stays on the server.

Local development can use Gemini before Supabase is configured. Production AI requires a verified Supabase sign-in. Provider availability, quota, and valid credentials are required; manual tools work when AI is unavailable. The current rate limiter is per process: add a durable distributed limiter before a broad public launch.

## Browser testing

```powershell
npm run test:e2e
```

Start the app first. Tests use an isolated Playwright browser context and the installed Microsoft Edge browser; they never use your personal browser profile or modify your personal workspace. Set `PLAYWRIGHT_CHANNEL=chrome` or install Playwright Chromium and select the appropriate channel on other machines. Set `PLAYWRIGHT_BASE_URL` to test a different local port. Screenshots/traces are written under `test-results/` and the HTML report under `playwright-report/`.

Tests cover timeline CRUD, state changes, reload persistence, overlaps, overnight events, recurring class exceptions, tasks, lifestyle flows, and responsive layouts at 375, 390, 768, 1024, and 1440 px. Provider/auth test doubles verify failure behavior and preview rules; they are **not** live Gemini or Supabase verification.

For actual RLS verification against a disposable test project:

```powershell
node --env-file=.env.local supabase/tests/rls.mjs
```

Read the script's prerequisites in [BACKEND.md](docs/BACKEND.md). It needs two dedicated test accounts; it skips explicitly when they are absent.

## Deploy to Vercel

Import this folder into a Vercel project, choose the Next.js preset, and configure the same Supabase public variables, `GEMINI_API_KEY`, and optional `GEMINI_MODEL` in Vercel. The build command is `npm run build`; there is no static-export step. Apply the Supabase migration before using cloud sync and configure authentication redirects for the final domain. Redeploy after changing public environment values. Verify sign-up/reset callbacks, cross-account isolation, cloud reloads, and real AI proposals on the deployed domain.

No cloud project or public deployment is created automatically by this repository. Deployment and service acceptance need the account configuration above.

## Structure

| Location | Responsibility |
| --- | --- |
| `src/components/life-os.tsx` | App shell, dashboard, timeline, details, authentication UI |
| `src/components/event-editor.tsx` | Validated activity form, recurrence edits, overlap review |
| `src/components/modules.tsx` | Calendar, tasks, nutrition, workouts, AI Planner, preferences |
| `src/hooks/use-life-data.ts` | Separate workspaces, persistence, account-safe synchronization, recovery |
| `src/lib/schedule.ts` | Timezone conversion, recurrence, conflicts, AI constraints |
| `src/app/api/` | Authenticated cloud sync and server-only Gemini planning |
| `supabase/` | Migration and executable RLS verification |
| `tests/` | Domain, API, persistence, and browser acceptance tests |

## Current limits

Reminders run while the app is open. There is no background Web Push worker. Vietnamese is the default interface language; English is optional in Settings. Language changes preserve existing records. See [I18N.md](docs/I18N.md) for the resource system, persistence, and verification. The calendar offers a recurring-study filter, rather than a separate subject-directory or academic import system. Meal nutrition values are optional estimates; no food database or medical nutrition service is included.

See [FEATURES.md](docs/FEATURES.md) for phase-by-phase coverage and [VALIDATION.md](docs/VALIDATION.md) for the final verification record. Live Supabase, Gemini, notification delivery on physical devices, and production deployment must be verified with configured services.
