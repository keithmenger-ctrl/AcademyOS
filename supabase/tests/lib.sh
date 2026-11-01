# Shared by reset.sh and run.sh. Source it; do not execute.
# Admin psql: with PGHOST set (CI service container, or any reachable server) or when not root, use the standard PG*
# env vars; otherwise fall back to `su postgres` (the root-in-a-sandbox setup used by scripts/dev-up.sh).
if [ -n "${PGHOST:-}" ] || [ "$(id -u)" != 0 ]; then
  export PGDATABASE_ADMIN="${PGDATABASE:-postgres}"
  pg_admin() { PGDATABASE="$PGDATABASE_ADMIN" psql -v ON_ERROR_STOP=1 -q "$@"; }
  pg_db() { local db=$1; shift; PGDATABASE="$db" psql -v ON_ERROR_STOP=1 -q "$@"; }
else
  pg_admin() { su postgres -c "psql -v ON_ERROR_STOP=1 -q $(printf '%q ' "$@")"; }
  pg_db() { local db=$1; shift; su postgres -c "psql -v ON_ERROR_STOP=1 -q $db $(printf '%q ' "$@")"; }
fi
