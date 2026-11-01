#!/usr/bin/env bash
# Rebuild the local test database (plain Postgres + auth stub) and load migrations + seed.
# Connects with PG* env vars (PGHOST, PGPORT, PGUSER, PGPASSWORD) or, as root, via `su postgres`. See lib.sh.
set -euo pipefail
DB=${1:-academyos_test}
cd "$(dirname "$0")/../.."
. supabase/tests/lib.sh
run() { pg_db "$DB" -f "$PWD/$1"; }
pg_admin -c "drop database if exists $DB with (force)" -c "create database $DB"
run supabase/tests/auth_stub.sql
for f in supabase/migrations/*.sql; do run "$f"; done
run supabase/seed.sql
