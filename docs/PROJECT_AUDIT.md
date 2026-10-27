# Recovery audit — 26 October 2026

The continuation brief was applied to the existing codebase. No project reinitialization, destructive cleanup, user-data deletion, or Git reset was performed. The directory has no `.git` repository, so commit history and a Git diff are unavailable.

The recovered stack is Next.js 16 App Router, React 19, strict TypeScript, Tailwind 4, Radix/shadcn-style UI primitives, Lucide, Motion, React Hook Form/Zod, Supabase SSR clients, and server-only Gemini structured output. Dependencies already installed were preserved. The Windows launcher uses official WASM compilation when the native compiler is blocked by application control.

| Module | Final classification | Evidence / remaining scope |
| --- | --- | --- |
| Authentication | PARTIALLY COMPLETED | Real Supabase sign-up/sign-in/reset/update/sign-out UI and server verification exist; credentials and email-provider acceptance remain unverified. Google OAuth is NOT IMPLEMENTED. |
| Dashboard | COMPLETED locally | Browser-tested totals, empty state, current/next activity and clock transitions. |
| Block Timeline | COMPLETED locally | Browser-tested CRUD, completion, skip/undo, overlap review, overnight events, reloads and recurrence exceptions. |
| Calendar | COMPLETED locally | Day/week/month UI, shared event data, date navigation; responsive browser checks. |
| University timetable | PARTIALLY COMPLETED | Recurring study events, lecturer/location, dated exceptions and a calendar filter work. Dedicated subject directory and academic import are NOT IMPLEMENTED. |
| Tasks | COMPLETED locally | CRUD, priorities, deadlines, estimates, completion/search, separate scheduled sessions. Browser-tested estimated-duration scheduling. |
| Nutrition | COMPLETED for manual planning | Daily/weekly views, favorite templates, optional estimated macros and history. Browser-tested template→timeline→history. Food database and dedicated AI meal recommendations are NOT IMPLEMENTED. |
| Workouts | COMPLETED for manual planning | Reusable plans, exercises, scheduling, session start, actual logs and history. Browser-tested saved set counts and completion. Rest countdown is NOT IMPLEMENTED. |
| AI Planner | PARTIALLY COMPLETED | Day/week, modes, constraints, structured API output and explicit proposal acceptance implemented. API/unit/UI fixture tests pass; live Gemini generation remains unverified. Ongoing chat and persisted proposal history are NOT IMPLEMENTED. |
| Settings | COMPLETED with language limit | Name, timezone, appearance, time format, routine, fitness and food preferences. Most copy remains English; greeting/AI language supports Vietnamese. |
| Database | PARTIALLY COMPLETED | RLS migration and revision-safe tenant RPCs exist. Live migration/RLS/transaction tests explicitly skip without configuration. |
| Responsive design | COMPLETED in tested Chromium sizes | Browser assertions cover 375/390/768/1024/1440 px. Physical iPhone/Safari testing remains unverified. |
| Dark mode | COMPLETED in tested browser | Theme toggling and reload persistence tested; dark palette applied to module event cards. |
| Notifications | PARTIALLY COMPLETED | Foreground in-app reminders clock-tested; browser permission UI exists. Actual OS delivery needs device acceptance. Background Web Push is NOT IMPLEMENTED. |

## Recovery fixes

- Removed a date-format runtime crash when leaving Today.
- Restored recurring classes in the university filter after occurrence expansion.
- Made category choices accessible without an invalid enclosing label.
- Materialized edited recurrence occurrences to UUIDs before cloud persistence.
- Kept unsynced device changes across reloads, with explicit cloud/device recovery choices.
- Prevented stale account requests and captured UI actions from crossing workspace identities.
- Matched task estimates to the activity editor's proposed working duration.
- Fixed reset-link routing and made personal settings accessible on mobile.
- Preserved overnight dates when quick entry fills tomorrow's draft.
- Added shareable view/date URLs with reload and Back navigation.
- Added a seven-day AI planning scope and checked overnight proposals against the following day's events.

Exact commands, test totals, screenshots, and external-service limits are recorded in [VALIDATION.md](VALIDATION.md). Configuration is in [README.md](../README.md) and [BACKEND.md](BACKEND.md).
