#!/usr/bin/env bash
# Self-contained browser e2e for the generic-shell core flows (sign in, org isolation, athletes, CSV import).
# Brings up its own throwaway stack, runs scripts/e2e/shell.mjs, then tears everything down:
#   - Postgres 16: a temp cluster (initdb) unless PGHOST is set (CI service container or any reachable server)
#   - GoTrue (Supabase Auth): built once from a pinned tag into $E2E_CACHE
#   - the app: `next build` + `next start`, with every optional feature OFF and no Stripe/Anthropic/SMTP config
# No Docker, no real keys, no outbound calls from the app. Fresh database each run, no demo seed.
# Usage: npm run test:e2e:shell
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD

GOTRUE_TAG=v2.197.0
CACHE=${E2E_CACHE:-$HOME/.cache/academyos-e2e}
free_port() { node -e "const s=require('net').createServer().listen(0,()=>{console.log(s.address().port);s.close()})"; }
APP_PORT=${E2E_APP_PORT:-$(free_port)}
AUTH_PORT=${E2E_AUTH_PORT:-$(free_port)}
DB=academyos_e2e
# short path on purpose: unix socket paths are limited to ~100 chars on macOS
WORK=$(mktemp -d /tmp/academyos-e2e.XXXXXX)
PIDS=()
PG_STARTED=
# `next build` with a custom NEXT_DIST_DIR rewrites tsconfig.json; put it back so the run leaves the tree clean.
cp tsconfig.json "$WORK/tsconfig.json.orig"

cleanup() {
  status=$?
  for p in ${PIDS[@]+"${PIDS[@]}"}; do kill "$p" 2>/dev/null || true; done
  cp "$WORK/tsconfig.json.orig" tsconfig.json
  rm -rf "$ROOT/.next-e2e"
  [ -n "$PG_STARTED" ] && "$PG_CTL" -D "$WORK/pg" -m immediate stop >/dev/null 2>&1 || true
  if [ $status -ne 0 ]; then echo "e2e failed; logs kept in $WORK" >&2; else rm -rf "$WORK"; fi
}
trap cleanup EXIT

# ---- Postgres -------------------------------------------------------------------------------------------------
if [ -z "${PGHOST:-}" ]; then
  for d in "$(command -v initdb >/dev/null && dirname "$(command -v initdb)")" /opt/homebrew/opt/postgresql@16/bin \
           /usr/local/opt/postgresql@16/bin /usr/lib/postgresql/*/bin; do
    [ -n "$d" ] && [ -x "$d/initdb" ] && PGBIN=$d && break
  done
  [ -n "${PGBIN:-}" ] || { echo "Postgres not found: install postgresql@16 or set PGHOST/PGPORT/PGUSER/PGPASSWORD" >&2; exit 1; }
  PG_CTL=$PGBIN/pg_ctl
  PGPORT=${E2E_PGPORT:-$(free_port)}
  "$PGBIN/initdb" -D "$WORK/pg" -U postgres --auth=trust -E UTF8 --no-locale >/dev/null
  "$PG_CTL" -D "$WORK/pg" -l "$WORK/postgres.log" -w -o "-p $PGPORT -k $WORK -c listen_addresses=127.0.0.1 -c fsync=off" start >/dev/null
  PG_STARTED=1
  export PGHOST=127.0.0.1 PGPORT PGUSER=postgres
  export PATH="$PGBIN:$PATH"
fi
export PGUSER=${PGUSER:-postgres}
PGAUTH=$PGUSER${PGPASSWORD:+:$PGPASSWORD}
psql_admin() { PGDATABASE=postgres psql -X -v ON_ERROR_STOP=1 -q "$@"; }
psql_db() { PGDATABASE=$DB psql -X -v ON_ERROR_STOP=1 -q "$@"; }
psql_admin -c "drop database if exists $DB with (force)" -c "create database $DB"
psql_db -f supabase/tests/roles_stub.sql

# ---- GoTrue ---------------------------------------------------------------------------------------------------
if [ ! -x "$CACHE/gotrue-$GOTRUE_TAG" ]; then
  command -v go >/dev/null || { echo "Go is required once to build GoTrue ($GOTRUE_TAG)" >&2; exit 1; }
  echo ">> building GoTrue $GOTRUE_TAG (one-time)"
  mkdir -p "$CACHE"
  rm -rf "$CACHE/gotrue-src"
  git clone -q --depth 1 --branch "$GOTRUE_TAG" https://github.com/supabase/auth "$CACHE/gotrue-src"
  (cd "$CACHE/gotrue-src" && go build -o "$CACHE/gotrue-$GOTRUE_TAG" .)
fi
cat > "$WORK/gotrue.env" <<ENV
GOTRUE_DB_DRIVER=postgres
DATABASE_URL="postgres://$PGAUTH@$PGHOST:$PGPORT/$DB?sslmode=disable&search_path=auth,public"
GOTRUE_DB_NAMESPACE=auth
DB_NAMESPACE=auth
GOTRUE_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long
GOTRUE_JWT_EXP=3600
GOTRUE_JWT_AUD=authenticated
GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
GOTRUE_SITE_URL=http://localhost:$APP_PORT
API_EXTERNAL_URL=http://localhost:$AUTH_PORT
GOTRUE_API_HOST=127.0.0.1
PORT=$AUTH_PORT
GOTRUE_DISABLE_SIGNUP=false
GOTRUE_MAILER_AUTOCONFIRM=true
GOTRUE_EXTERNAL_EMAIL_ENABLED=true
GOTRUE_SMTP_HOST=127.0.0.1
ENV
# GoTrue needs its own migrations first (they create the auth schema tables the app migrations reference).
(cd "$CACHE/gotrue-src" && set -a && . "$WORK/gotrue.env" && set +a && "$CACHE/gotrue-$GOTRUE_TAG" migrate > "$WORK/gotrue-migrate.log" 2>&1) \
  || { cat "$WORK/gotrue-migrate.log" >&2; exit 1; }
# App migrations only. seed.sql (demo data) is deliberately not loaded.
for f in supabase/migrations/*.sql; do psql_db -f "$f" >/dev/null; done
(cd "$CACHE/gotrue-src" && set -a && . "$WORK/gotrue.env" && set +a && exec "$CACHE/gotrue-$GOTRUE_TAG" serve > "$WORK/gotrue.log" 2>&1) &
PIDS+=($!)
for _ in $(seq 1 30); do curl -sf -m 2 "localhost:$AUTH_PORT/health" >/dev/null && break; sleep 1; done
curl -sf -m 2 "localhost:$AUTH_PORT/health" >/dev/null || { echo "GoTrue did not start"; cat "$WORK/gotrue.log"; exit 1; }

# ---- App ------------------------------------------------------------------------------------------------------
eval "$(node scripts/dev-keys.mjs | sed 's/^/export /')"
export NEXT_PUBLIC_SUPABASE_URL=http://localhost:$APP_PORT
export DEV_GOTRUE_URL=http://localhost:$AUTH_PORT
export DATABASE_URL=postgres://$PGAUTH@$PGHOST:$PGPORT/$DB
export APP_URL=http://localhost:$APP_PORT
export NEXT_DIST_DIR=.next-e2e NEXT_TELEMETRY_DISABLED=1
# Everything optional stays off and unconfigured, whatever the caller's shell has set.
export FEATURE_BILLING= FEATURE_ASSISTANT= FEATURE_PILOT_FEEDBACK= FEATURE_DEMO=
export STRIPE_SECRET_KEY= STRIPE_WEBHOOK_SECRET= ANTHROPIC_API_KEY= SMTP_URL= MAIL_FROM=
# Built per run on purpose: the (random) ports are baked into the build via NEXT_PUBLIC_SUPABASE_URL and the auth rewrite.
echo ">> next build"
npx next build > "$WORK/build.log" 2>&1 || { tail -40 "$WORK/build.log" >&2; exit 1; }
npx next start -p "$APP_PORT" > "$WORK/app.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 30); do curl -sf -m 2 -o /dev/null "localhost:$APP_PORT/login" && break; sleep 1; done
curl -sf -m 2 -o /dev/null "localhost:$APP_PORT/login" || { echo "App did not start"; tail -40 "$WORK/app.log"; exit 1; }

# ---- Browser suite --------------------------------------------------------------------------------------------
echo ">> running scripts/e2e/shell.mjs against http://localhost:$APP_PORT"
BASE_URL=http://localhost:$APP_PORT node scripts/e2e/shell.mjs
