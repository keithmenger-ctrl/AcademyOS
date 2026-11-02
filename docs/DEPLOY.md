# Deploying AcademyOS (Supabase + Vercel)

Everything here was built and tested against a local Postgres + GoTrue (Supabase Auth). These are the steps to run the
same thing on hosted Supabase and Vercel. Items marked **verify** could not be exercised from the build sandbox.

## 1. Supabase project
1. Create a project (region close to your facilities). Save the database password.
2. SQL editor: run every file in `supabase/migrations` in order, `0001_schema.sql` through `0011_demo_org_neutral.sql`. Do **not** run `supabase/tests/*` stub files; Supabase
   already has the `auth` schema and the `anon` / `authenticated` roles.
3. Do **not** run `supabase/seed.sql` on production: its logins use a publicly documented password. Use it only on a
   separate staging/demo project. Nobody needs it: the shell works with empty states, and (only if the dormant `FEATURE_DEMO` is on) signup can create a demo academy.
4. Authentication → URL configuration: Site URL = your production URL; add `https://<domain>/auth/confirm` to redirect URLs.
5. Authentication → Providers → Email: decide on "Confirm email". If on, new owners finish setup at `/onboarding` after
   confirming (already handled).

## 2. Environment variables (Vercel → Settings → Environment Variables)
| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (Settings → API) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key (server only) |
| `DATABASE_URL` | Settings → Database → **Transaction pooler** connection string (port 6543) |
| `APP_URL` | `https://<your domain>` (**required** for emailed links) |
| `SMTP_URL`, `MAIL_FROM` | optional; any SMTP provider, e.g. `smtps://resend:<API key>@smtp.resend.com:465` and `AcademyOS <noreply@yourdomain.com>`. Enables emailed invites + "Forgot password?" |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | dormant billing only; leave empty |
| `ANTHROPIC_API_KEY` | dormant assistant only; leave empty |
| `ANTHROPIC_MODEL` | dormant assistant only; leave empty |
| `NEXT_PUBLIC_APP_NAME` | optional; product name shown in the browser title, app shell and emails (defaults to `AcademyOS`) |
| `FEATURE_BILLING` | dormant; leave unset. `true` turns on memberships, plans, Stripe and parent billing |
| `FEATURE_ASSISTANT` | dormant; leave unset. `true` turns on the AI assistant |
| `FEATURE_PILOT_FEEDBACK` | dormant; leave unset. `true` turns on the feedback button and usage-event tracking |
| `FEATURE_DEMO` | dormant; leave unset. `true` shows "Start with demo data" at signup and the demo view switcher |

The `FEATURE_*` flags gate dormant code that is not part of the shell's scope. They are off unless set to exactly `true`; the default deployment should leave all of them unset. `NEXT_PUBLIC_*` values are baked in at build time, so redeploy after
changing them.

Local/dev only, never set in production: `DEV_GOTRUE_URL` (proxies `/auth/v1` to a local GoTrue),
`NEXT_PUBLIC_DEMO_LOGINS` (shows seeded demo credentials on the sign-in page) and `NEXT_DIST_DIR` (alternate build
output folder for the local test scripts). `NODE_ENV` is set by Next.js/Vercel; don't set it yourself.

Why the transaction pooler works: every data access runs in one transaction that sets the caller's JWT claims and
`set local role authenticated` (`src/lib/db.ts`), and `pg` uses unnamed prepared statements. **Verify** with the smoke
test below.

## 3. Vercel
Import the GitHub repo, framework = Next.js, no build overrides. Deploy.

## 4. Stripe (dormant; skip for the shell)
Only relevant if the dormant billing feature is deliberately enabled with `FEATURE_BILLING=true`. The generic shell does not use Stripe.

1. Test mode first. Set `STRIPE_SECRET_KEY` (sk_test_…).
2. Developers → Webhooks → add endpoint `https://<domain>/api/stripe/webhook` with events
   `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`,
   `invoice.payment_failed`. Copy the signing secret to `STRIPE_WEBHOOK_SECRET`.
3. Settings → Billing → Customer portal: enable it (used by "Manage payment method").
4. In AcademyOS Billing, re-save each plan once (creates the Stripe Product/Price).
5. **Verify**: start a membership, open the checkout link, pay with `4242 4242 4242 4242`, confirm it turns Active and a
   payment appears; then use `4000 0000 0000 0341` to see past-due.

## 5. Smoke test the deployment
From a machine with Node + Playwright's Chromium:
```bash
BASE_URL=https://<domain> node scripts/e2e/phase2.mjs   # auth + role isolation
```
`scripts/e2e/demo.mjs` (signup with demo data + view switcher) only applies if the dormant `FEATURE_DEMO` is on.
Most other suites assume the shared seed (`supabase/seed.sql`); `pilot.mjs`, `phase12.mjs` and `stripe-webhook.mjs` also
need direct database access (`DATABASE_URL`). Run the RLS test suite only against a throwaway database.

## Security notes
- Supabase's REST API exposes the `public` schema to every signed-in user, so RLS and grants are the real boundary.
  Internal notes (`athletes.notes`, `sessions.notes`) are excluded from the `authenticated` column grants and read by
  staff through `athlete_internal_notes()` / `session_internal_notes()`. **New columns on `athletes` or `sessions`
  must be added to the grant lists in migration 0010**, or nobody can read them.
- `organizations.is_demo` can only be changed with the service role.
- Invite emails: none from demo academies, max 50 per academy per 24h (links still shown on screen).
- Security headers (no framing, nosniff, referrer policy) are set in `next.config.ts`.

## 6. Before real families use it
- Email: set `SMTP_URL`, `MAIL_FROM` and `APP_URL` (above). AcademyOS sends its own emails (invites, password reset) with
  one-time links to `/auth/confirm`, so no Supabase email-template changes are needed. Without SMTP, invites fall back to
  copy-paste links and "Forgot password?" tells users to ask their academy. **Verify** by sending yourself a reset email.
  Emailed links always use `APP_URL`, never the request's Host header (prevents token-leak via forged Host).
- Rate limiting: Supabase Auth rate-limits sign-in; add limits for invite creation if exposed widely.
- Privacy policy and parental consent language (athletes are minors).
