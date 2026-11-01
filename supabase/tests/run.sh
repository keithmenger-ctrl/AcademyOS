#!/usr/bin/env bash
# Rebuild the test DB and run the RLS checks. Fails unless the pass marker is printed.
set -uo pipefail
cd "$(dirname "$0")/../.."
. supabase/tests/lib.sh
LOG_DIR=${TMPDIR:-/tmp}
bash supabase/tests/reset.sh > "$LOG_DIR/rls-reset.log" 2>&1 || { echo "FAIL rls reset (see $LOG_DIR/rls-reset.log)"; cat "$LOG_DIR/rls-reset.log"; exit 1; }
out=$(pg_db academyos_test -f "$PWD/supabase/tests/rls.sql" 2>&1)
status=$?
echo "$out"
[ $status -eq 0 ] && grep -q "ALL RLS CHECKS PASSED" <<<"$out"
