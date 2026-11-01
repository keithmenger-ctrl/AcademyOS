# Academy shell

An operating system for independent sports-performance facilities, built around athlete development rather than just memberships and booking.

```
PROGRAM → LEVEL → CURRICULUM → SESSION → ATHLETE → ASSESSMENT → PROGRESS
```

This repo is an **MVP** meant to be put in front of 3–5 facility owners. It is not the long-term company.

## Scope

**In (MVP):** athlete management, programs/levels/curriculum, sessions + attendance, coach "Today" view (mobile-first), assessments, athlete progress timeline, parent progress reports, owner dashboard, basic Stripe memberships (with a dev/mock mode), predefined read-only AI queries.

**Out (on purpose):** payroll, accounting, CRM/marketing, website builder, POS, nutrition, athlete workout logging, wearables, franchise tools, native apps, agentic AI, lending/marketplace features.

## Roles
| Role | Can |
|---|---|
| owner | everything in their organization, plus facility settings and adding/removing admins |
| admin | everything except facility settings and admin management |
| coach | see athletes + sessions, mark attendance, add notes, record assessments, edit notes/plan on own sessions. No billing unless the owner/admin turns on "Can see billing" (read-only membership status) |
| parent | only their own athletes: schedule, attendance, assessments, shareable notes, shared reports, own membership |

## Architecture
Single Next.js (App Router, TypeScript, Tailwind) monolith on Supabase (Postgres + Auth + RLS) with Stripe.

- **Tenancy:** every tenant table has `organization_id`. Composite FKs `(organization_id, id)` make cross-org references impossible at the database level.
- **Authorization:** enforced by Postgres RLS (`supabase/migrations/0002_rls.sql`) using `auth_org_id()` / `auth_role()` / `is_guardian_of()`. The app talks to the DB with the signed-in user's session so RLS always applies. The service-role key is used only for invites, the Stripe webhook and seeding. Server code also checks roles; nothing trusts the client.
- **Timeline:** DB triggers write `athlete_progress_events` for assessments, notes and program/level changes.
- **AI:** `src/lib/ai/queries.ts` is a registry of typed, read-only queries (inactive 14 days, due for reassessment, almost full, open capacity, draft progress report, 60-day summary) that reuse the app's own query functions under RLS. Questions are routed by deterministic keyword + athlete-name matching (no model call). When `ANTHROPIC_API_KEY` is set, Claude (`claude-opus-5-5`, low effort, default refusal fallback) only turns structured facts into prose; any failure falls back to a template. Nothing is written until a staff member clicks "Save as draft report", and drafts are never shared automatically. Not implemented: free-form LLM routing / open-ended questions; the live Claude call is untested here (no key in this environment).

## Database
Migrations live in `supabase/migrations`:
`organizations, profiles, user_roles, locations, sports, coaches, guardians, athletes, athlete_guardians, programs, program_levels, curriculum_items, sessions, session_athletes, attendance, coach_notes, assessment_types, assessment_results, athlete_progress_events, membership_plans, memberships, payments, progress_reports`.

Seed data (`supabase/seed.sql`): "Sample Facility", 3 programs × 3 levels, 36 curriculum items, 3 coaches, 30 athletes, 26 guardians, ~140 sessions (8 weeks back through next week, pattern anchored to *today* so every coach has sessions on demo day), attendance, notes, ~400 assessment results, memberships and payments. Demo logins (password `academyos-demo`): `owner@`, `alex@`, `mike@`, `sarah@`, `parent1@`…`parent6@` `demo-academy.test`. The seed is optional and is not run by migrations; load it only into dev/demo databases.

## Verify your changes
From a clean clone (`npm ci` first), no prior build needed:

```bash
npm run lint
npm run typecheck   # next typegen && tsc --noEmit
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder npm run build
```

Suites that need local services:

| Command | Needs | Checks |
| --- | --- | --- |
| `npm run test:db` | Postgres 16 and superuser access: `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD` env vars, or run as root to use `su postgres`. CI runs it against a `postgres:16` service | `supabase/tests/run.sh`: rebuilds `academyos_test`, runs the 59 tenant/role isolation checks in `rls.sql`; exits non-zero on any error or if the pass marker is missing |
| `npm run test:e2e` | Postgres 16, GoTrue (via `scripts/dev-up.sh`), dev server on :3000 | `scripts/regress.sh`: every Playwright suite in `scripts/e2e/`, RLS, lint, typecheck |

## Testing the database locally
Needs a local Postgres 16 (no Supabase required; an auth stub stands in for Supabase's `auth` schema). `npm run test:db` does both steps. Point it at any superuser connection, e.g. `PGHOST=localhost PGUSER=postgres PGPASSWORD=... npm run test:db` (as root without `PGHOST` it uses `su postgres`):

```bash
bash supabase/tests/reset.sh                       # rebuild db, run migrations + seed
psql -q academyos_test -f supabase/tests/rls.sql   # 59 tenant/role isolation checks
```

## Development plan
- [x] 0. Repo + Next.js scaffold
- [x] 1. Schema, RLS, seed, isolation tests
- [x] 2. Auth, org signup, role routing, app shells
- [x] 3. Athletes (list/search/filter, create/edit, full profile incl. attendance, assessment history, notes, timeline, parent invite links)
- [x] 4. Programs / levels / curriculum (create/edit/archive programs, levels with capacity, weekly curriculum with drills, cues, objectives, video link)
- [x] 5. Sessions + attendance (week schedule, create with curriculum week → focus/plan, weekly repeat, auto-enroll up to capacity, enroll/remove, coaches page with app-access links)
- [x] 6. Coach Today (own sessions today, session plan + focus + cues, one-tap attendance with optimistic saves, mark rest present, athlete + session notes)
- [x] 7. Assessments (metrics admin, due-for-reassessment list, recent results, phone recorder by session or level with previous value + live delta)
- [x] 8. Athlete progress + parent portal (advance level, milestones, parent home/schedule/progress with RLS-enforced visibility)
- [x] 9. Parent progress reports (generate from data snapshot + draft text, edit, share/unshare, parent view, print/save PDF)
- [x] 10. Owner dashboard (today stats + sessions, program capacity + 30-day growth, activity + 14-day disengagement list, reassessment due, MRR / active / past-due memberships)
- [x] 11. Stripe memberships (plans, assign, cancel, past-due; Stripe Checkout + billing portal + webhook sync; dev mode with labelled payment simulation; settings: facility, timezone, locations)
- [x] 12. AI queries (Assistant page: 6 predefined read-only queries, keyword routing with athlete-name matching, Claude-drafted text when ANTHROPIC_API_KEY is set, human-confirmed save as draft)

### After the 12 phases
- [x] Per-prospect demo academies with Owner / Coach / Parent view switcher
- [x] CSV import of athletes + parents
- [x] Pilot feedback button, usage events, weekly readout
- [x] Upcoming rosters follow level/status changes
- [x] Forgot password + emailed invites (any SMTP provider)
- [x] Admins + per-coach "Can see billing"
- [x] Assessment sparklines (profile + report), "Test due" chips
- [x] 404 / error / loading states
- [x] Security review fixes (see docs/DEPLOY.md → Security notes)

Anything not checked above is **not implemented**. Known limits: no native apps, no charts beyond sparklines, no emailed/PDF-attached reports (parents open them in the portal and can print/save as PDF), live Stripe/Claude/hosted Supabase not exercised from the build sandbox.

## Email
Invites (parents, coaches, admins) and "Forgot password?" send one-time sign-in links when `SMTP_URL`, `MAIL_FROM` and `APP_URL` are set (any SMTP provider). The same link is always shown to the owner as a fallback. Locally, `scripts/dev-up.sh` starts an SMTP sink that stores mail in `/tmp/academyos-mail`.

## Importing athletes
Athletes → **Import CSV** (owners/admins). Download the template or use any export with recognizable headers (e.g. "First Name", "DOB", "Parent Email"; unknown columns are ignored and listed). Dates can be `YYYY-MM-DD` or `M/D/YYYY`. Every row is validated in a preview (bad dates, unknown program/level, invalid emails, duplicates) before anything is saved. The import then re-parses the file server-side, imports only valid rows in one transaction, reuses parents by email, creates unknown sports, and skips athletes already in the system (same name, and matching or missing birthdate), so re-importing a file is safe.

## Pilot feedback and usage
- Every shell has a **Send feedback** button (stored in `feedback` with page + role).
- Key actions write `usage_events` (logins by role, attendance, notes, assessments, reports generated/shared, imports, demos created). Tracking never blocks the action.
- Both tables are write-only from the app (RLS: insert own rows only, no reads). Weekly readout: `psql "$DATABASE_URL" -f scripts/pilot-readout.sql`.
- Not implemented: emailing feedback to the founder (needs a mail provider).

## Demo academies
- Signup has **Start with demo data** (unchecked by default; only shown when `FEATURE_DEMO=true`). It creates the prospect's own organization, then fills it with `seed_demo_org()` (migrations 0007 and 0011): 30 athletes, 3 coaches, 6 parents, curriculum, ~8 weeks of history anchored to *today*. Each prospect gets an isolated copy.
- Demo orgs (`organizations.is_demo`) show a **Demo academy · view as Owner / Coach / Parent** bar. Switching signs in as that org's demo user through a one-time link, so every view is the real one (same routes, same RLS). Non-demo orgs never see the bar, and the switch action refuses them.
- Demo coach/parent logins get random passwords and `@academyos.demo` addresses; they are only reachable through the switcher. `supabase/seed.sql` creates the shared "Sample Facility" demo org the same way (with the fixed `@demo-academy.test` logins).

## Billing
- **Dev mode** (no `STRIPE_SECRET_KEY`): memberships/payments are database rows; the Billing page shows a "Dev mode" banner and "Sim. paid / Sim. failed" buttons to demo past-due flows. Parents see status and payment history but no pay button.
- **Stripe mode**: saving a plan creates a Stripe Product/Price (a changed amount creates a new Price). Starting a membership creates it as *Awaiting payment* plus a Stripe Checkout link for the parent (also available as "Complete payment" in the parent portal). `/api/stripe/webhook` (signature-verified, idempotent) syncs `checkout.session.completed`, `customer.subscription.*` and `invoice.paid/payment_failed` into memberships and payments. Parents manage cards through the Stripe billing portal.
- Point a Stripe webhook endpoint at `https://<host>/api/stripe/webhook` with those events and set `STRIPE_WEBHOOK_SECRET`.
- Tested here: dev mode end-to-end, and webhook processing with locally signed events (`node scripts/e2e/stripe-webhook.mjs` against a Stripe-mode dev server). **Not tested here:** live calls to Stripe's API (Checkout, Products/Prices, billing portal), because this environment's network blocks api.stripe.com.

## Data access design
Supabase Auth handles identity (`@supabase/ssr` cookies, verified with `auth.getUser()` on every request). Data is read/written with plain SQL through `pg`, inside a transaction that first sets the caller's identity and switches to the `authenticated` role (`src/lib/db.ts → withUser`). Row level security therefore applies to every query the app makes, while dashboards/reports can use real SQL joins and aggregates. `withServiceRole` (bypasses RLS) exists only for server-side jobs (invites, Stripe webhook).

## Deploying
See [docs/DEPLOY.md](docs/DEPLOY.md) (Supabase + Vercel + Stripe checklist).

## Local development
Against a real Supabase project: copy `.env.example` to `.env.local`, fill it in, run the SQL in `supabase/migrations` then `supabase/seed.sql` (SQL editor or `supabase db push`), `npm install && npm run dev`.

Without Docker/Supabase (what this repo's CI-less dev loop uses): `bash scripts/dev-up.sh` starts Postgres + a locally built GoTrue with the migrations and seed loaded. Then create `.env.local` with the values from `scripts/dev-keys.mjs` (see `.env.example`; `DEV_GOTRUE_URL` proxies `/auth/v1` to it) and `npm run dev`. Browser checks (dev server running): `node scripts/e2e/phase2.mjs`, `node scripts/e2e/phase3.mjs`, `node scripts/e2e/phase4.mjs`, `node scripts/e2e/phase5.mjs`, `node scripts/e2e/phase7.mjs`, `node scripts/e2e/phase8.mjs`, `node scripts/e2e/phase9.mjs`, `node scripts/e2e/phase10.mjs`, `node scripts/e2e/phase11.mjs`, `node scripts/e2e/phase12.mjs`, `node scripts/e2e/demo.mjs`, `node scripts/e2e/import.mjs`, `node scripts/e2e/pilot.mjs`, `node scripts/e2e/rosters.mjs`, `node scripts/e2e/email.mjs`. Or everything at once: `bash scripts/regress.sh`.

Billing, the assistant, pilot feedback/usage tracking and demo data are optional features, off unless `FEATURE_BILLING`, `FEATURE_ASSISTANT`, `FEATURE_PILOT_FEEDBACK` or `FEATURE_DEMO` is `true` (see `.env.example`). The browser suites exercise those features, so start the dev server with all four set to `true` before running them.
