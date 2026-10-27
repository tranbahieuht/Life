# Validation record

## 27 October 2026 — Complete Vietnamese/English interface

The i18n update passed strict TypeScript checks, an optimized production build, **67 unit/API tests across 6 files**, and **26 production browser acceptance tests** (17 existing English regressions plus 9 Vietnamese/default/switching/responsive cases). Production acceptance used the isolated Edge test contexts against port 3002; the existing development server was preserved.

There are **742 matching messages per locale**. Static JSX/resource coverage checks guard untranslated fixed copy and missing literal keys. Tests verify Vietnamese date/duration formatting, relative dates and natural-time parsing, explicit clarification for ambiguous hours, locale persistence through reloads and existing cloud snapshot contracts, and unchanged event/task/meal/workout/log values when switching languages.

Both languages were checked at 375, 390, 768, 1024 and 1440 px. User-authored content and database enums are preserved. Supabase/Gemini tests use route/provider fixtures where credentials are absent; live sign-in and actual provider output remain unverified. Native date/time-picker chrome follows browser/device capabilities. See [I18N.md](I18N.md) for architecture, configuration and maintenance.

Vietnamese visual evidence is available under `docs/previews/vi-*.png`.

## Earlier baseline

Date: **26 October 2026** (Asia/Ho_Chi_Minh).

## Automated results

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS, TypeScript strict |
| `npm test` | PASS, 42 tests across 4 files |
| `npm run build` | PASS, optimized Next.js production build |
| Production browser acceptance | PASS, 17 Playwright tests using installed Microsoft Edge, isolated contexts |
| Live Supabase RLS script | SKIPPED explicitly: no project/test-account credentials supplied |
| Live Gemini generation | NOT RUN: no API key supplied |
| Vercel deployment | NOT RUN: no project provisioned/configured |

Browser acceptance was run against `npm start` on `http://127.0.0.1:3001`, rather than relying solely on development-mode rendering. The normal developer command uses port 3000.

## Browser coverage

- Add, edit/reschedule, complete/reopen, skip, undo and confirm deletion of activities.
- Persistence through a full page reload and next/previous-day navigation.
- Explicit overlap review and conflict labels; overnight visibility on the next date.
- Weekly class expansion, one-occurrence room changes and the university timetable filter.
- Task estimates reflected in scheduled working time, independently of the deadline.
- Meal template → scheduled meal → completion history.
- Workout plan → session → actual logged sets → completion on the timeline.
- URL reload and browser Back navigation between modules.
- AI proposal confirmation UI, with a provider fixture used only inside tests: preview/cancel leave saved data unchanged; acceptance persists the checked proposal.
- Mobile access to Nutrition, personal settings and the activity bottom sheet.
- Foreground reminders and transitions from upcoming → active → unconfirmed with a controlled browser clock. Time passing never marks an activity completed.
- Quick entry for tomorrow's activity, including exact reviewed start/end dates and a 90-minute duration.
- Separate local/demo workspaces and dark-theme reload persistence.
- No document-level horizontal overflow at **375, 390, 768, 1024 and 1440 px**, covering Today, Calendar, Tasks, Nutrition, Workout, AI Planner and Settings; month-calendar layouts were also checked.

This is Chromium/Edge viewport testing. It does not establish physical iPhone/Safari compatibility, native notification delivery, or background execution.

## Domain/API coverage

The unit suite covers date/time conversion and DST, recurrence exclusions and materialized UUIDs, overnight intervals, touching/overlapping times, protected commitments, routine/deadline constraints, weekly planning bounds, following-day conflicts, malformed provider output, missing configuration, authentication, origins, revision conflicts, account-transition safeguards and unsynced-cache recovery decisions.

Authentication/provider test doubles exercise the real route handlers. They do not establish successful external-service calls or live PostgreSQL RLS behavior.

## Visual evidence

Representative captured views are copied to `docs/previews/`:

- `today-desktop.png` — 1440 px desktop viewport.
- `today-mobile.png` — 390 px phone viewport.
- `calendar-mobile.png` — 390 px month calendar.
- `dark-desktop.png` — dark appearance.
- `activity-mobile.png` — activity editing bottom sheet.

The full Playwright HTML report and per-test screenshots/traces are generated under ignored `playwright-report/` and `test-results/` directories. They can be regenerated using `npm run test:e2e` with the server running.

## Live acceptance still required

Database schema update (2026-10-27): `npm test` passes 111 tests, including 32 PostgreSQL/PGlite checks that execute both migrations, preserve legacy rows, reject an incompatible upgrade atomically, verify all-table owner/anonymous CRUD policies, tenant foreign keys, timestamps, canonical metadata, snapshot round-trips, stale revisions and rollback. `npm run typecheck` and `npm run build` pass. `supabase/verify_schema.sql` is also executed by the tests. No production migration or live write test has been run. See [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) for the SQL Editor procedure.

Apply the migration and configure Supabase/Gemini using [README.md](../README.md). Run the provided RLS script with two disposable test accounts, exercise confirmation/reset emails on the final origin, verify real cloud reload/conflict recovery, and generate feasible/infeasible day/week proposals against the chosen Gemini model. Add a distributed quota limiter before a broad public release. Web Push, Google OAuth, dedicated food recommendations and ongoing AI chat are outside the implemented scope; see [PROJECT_AUDIT.md](PROJECT_AUDIT.md).
