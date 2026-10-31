#!/usr/bin/env bash
# Tests scripts/backup-db.sh and scripts/verify-db-backup.sh against fake docker, PostgreSQL tools
# and rclone, so it needs neither Docker nor a database and changes nothing outside a temporary
# directory. scripts/db-backup-integration-test.sh runs both against a real PostgreSQL container.
# Takes under a minute. Run from the repository root:
#   bash scripts/db-backup-test.sh
set -euo pipefail

SCRIPTS=$(cd "${0%/*}" && pwd)
readonly BACKUP=$SCRIPTS/backup-db.sh VERIFY=$SCRIPTS/verify-db-backup.sh
[[ -r $BACKUP && -r $VERIFY ]] || { echo "ERROR: scripts not found next to $0" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/bin" "$work/mock"
unset BACKUP_DIR BACKUP_REMOTE KEEP_DAYS POSTGRES_CONTAINER
export PATH="$work/bin:$PATH" MOCK_LOG=$work/mock/calls MOCK_DIR=$work/mock MOCK_CONTAINER=postgres-nimuairy

# Plays `docker exec [-i] CONTAINER COMMAND...` by running COMMAND here with the postgres
# container's environment, so the scripts' sh -c code expands as it would in the container.
cat >"$work/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf 'docker %s\n' "${*//$'\n'/ }" >>"$MOCK_LOG"
[[ $1 == exec ]] || { echo "fake docker: only exec is supported" >&2; exit 125; }
shift
stdin=false
[[ $1 == -i ]] && { stdin=true; shift; }
[[ $1 == "$MOCK_CONTAINER" ]] || { echo "Error response from daemon: No such container: $1" >&2; exit 1; }
shift
export POSTGRES_USER=app POSTGRES_DB=proddb
if $stdin; then exec "$@"; else exec "$@" </dev/null; fi
EOF

# One fake for every tool: logs the call, then does what MOCK_<TOOL>_RC and friends say.
cat >"$work/bin/fake" <<'EOF'
#!/usr/bin/env bash
tool=${0##*/}
printf '%s %s\n' "$tool" "${*//$'\n'/ }" >>"$MOCK_LOG"
rc_var=MOCK_${tool^^}_RC
rc=${!rc_var:-0}
case $tool in
  pg_dump)
    printf 'PGDMP archive of %s\n' "$POSTGRES_DB"
    ((rc == 0)) || echo 'pg_dump: error: injected failure' >&2 ;;
  pg_restore)
    [[ -n ${MOCK_WATCH_DIR:-} ]] && ls -A "$MOCK_WATCH_DIR" >"$MOCK_DIR/watch"
    cat >>"$MOCK_DIR/pg_restore.stdin"
    sleep "${MOCK_PG_RESTORE_SLEEP:-0}"
    ((rc == 0)) || echo 'pg_restore: error: injected failure' >&2 ;;
  createdb)
    sleep "${MOCK_CREATEDB_SLEEP:-0}"
    ((rc == 0)) || echo "createdb: error: database creation failed: ERROR:  database \"${*: -1}\" already exists" >&2 ;;
  psql)
    if ((rc == 0)); then
      echo "${MOCK_PSQL_OUT:-18.6|2|1|0}"
    else
      echo 'ERROR:  relation "characters" does not exist' >&2
    fi ;;
  dropdb)
    sleep "${MOCK_DROPDB_SLEEP:-0}"
    ((rc == 0)) || echo 'dropdb: error: injected failure' >&2 ;;
esac
exit "$rc"
EOF
for tool in pg_dump pg_restore createdb psql dropdb rclone; do
  cp "$work/bin/fake" "$work/bin/$tool"
done
chmod +x "$work/bin"/*

# Runs a command, setting out (stdout and stderr), rc and log (the fake calls).
run() {
  : >"$MOCK_LOG"
  rm -f "$MOCK_DIR/pg_restore.stdin" "$MOCK_DIR/watch"
  rc=0
  out=$("$@" 2>&1) || rc=$?
  log=$(<"$MOCK_LOG")
  shown=false
}
# Same for verify-db-backup.sh, collecting its fake calls for the checks at the end.
run_verify() {
  run env "$@" bash "$VERIFY"
  printf '%s\n' "$log" >>"$work/verify-calls"
}
# Like run_verify, but sends the script SIGTERM once the fake $1 has started.
run_verify_killed() {
  local tool=$1 pid
  shift
  : >"$MOCK_LOG"
  env "$@" bash "$VERIFY" >"$work/killed.out" 2>&1 &
  pid=$!
  for _ in {1..100}; do
    grep -q "^$tool " "$MOCK_LOG" && break
    sleep 0.1
  done
  kill -TERM "$pid"
  rc=0
  wait "$pid" || rc=$?
  out=$(<"$work/killed.out") log=$(<"$MOCK_LOG") shown=false
  printf '%s\n' "$log" >>"$work/verify-calls"
}

passed=0 failed=0 shown=false
check() {
  local what=$1
  shift
  if "$@"; then
    passed=$((passed + 1))
    return
  fi
  failed=$((failed + 1))
  echo "  FAIL: $what" >&2
  if ! $shown; then
    shown=true
    echo "  Output (exit $rc):" >&2
    while IFS= read -r line; do echo "    | $line" >&2; done <<<"$out"
    echo "  Calls:" >&2
    while IFS= read -r line; do echo "    | $line" >&2; done <<<"$log"
  fi
}
has() { grep -qF -- "$1" <<<"$out"; }
lacks() { ! grep -qF -- "$1" <<<"$out"; }
called() { grep -qF -- "$1" <<<"$log"; }
not_called() { ! grep -qE -- "^$1( |$)" <<<"$log"; }
no_calls() { [[ -z $log ]]; }
exit_is() { [[ $rc == "$1" ]]; }
same() { [[ $1 == "$2" ]]; }
differ() { [[ -n $1 && -n $2 && $1 != "$2" ]]; }
matches() { [[ $1 =~ $2 ]]; }
exists() { [[ -e $1 ]]; }
missing() { [[ ! -e $1 ]]; }
section() { echo "== $*"; }
# The tools the scripts called, in order, without docker itself.
tools() { grep -v '^docker ' <<<"$log" | cut -d' ' -f1 | paste -sd' ' -; }
# The temporary database name from verify-db-backup.sh's report.
db_of() { sed -n 's/^Database:   \([^ ]*\) (temporary)$/\1/p' <<<"$1"; }
# Writes a fake dump named $2 into directory $1, modified $3 ago.
dump() {
  printf 'dump %s\n' "$2" >"$1/$2"
  touch -d "$3 ago" "$1/$2"
}

section "backup-db.sh: daily backup"
d=$work/b1-daily
mkdir "$d"
run env BACKUP_DIR="$d" MOCK_WATCH_DIR="$d" bash "$BACKUP"
name=$(ls -A "$d")
check "exits 0" exit_is 0
check "writes one dump with the daily name" matches "$name" '^nimuairy-[0-9]{8}T[0-9]{6}Z-daily\.dump$'
check "dumps the container's database, custom format, never asking for a password" \
  called "pg_dump -w -U app -d proddb -Fc"
check "uses the postgres-nimuairy container" called "docker exec postgres-nimuairy sh -c"
check "validates the whole archive in the container" called "docker exec -i postgres-nimuairy pg_restore -f /dev/null"
check "validates the dump it wrote" same "$(<"$MOCK_DIR/pg_restore.stdin")" "$(<"$d/$name")"
check "validates before the dump gets its final name" matches "$(<"$MOCK_DIR/watch")" '^nimuairy-[0-9]{8}T[0-9]{6}Z-daily\.dump\.tmp$'
check "dumps, then validates" same "$(tools)" "pg_dump pg_restore"
check "reports the dump" has "Dumped $d/$name"
check "without BACKUP_REMOTE, uploads nothing" not_called rclone

section "backup-db.sh: labels"
d=$work/b1-label
mkdir "$d"
run env BACKUP_DIR="$d" BACKUP_REMOTE= bash "$BACKUP" pre-deploy-0123456789ab
check "pre-deploy label: exits 0" exit_is 0
check "pre-deploy label: in the name" matches "$(ls -A "$d")" '^nimuairy-[0-9]{8}T[0-9]{6}Z-pre-deploy-0123456789ab\.dump$'
check "empty BACKUP_REMOTE: uploads nothing" not_called rclone
run env BACKUP_DIR="$d" bash "$BACKUP" Bad_Label
check "invalid label: exits 1" exit_is 1
check "invalid label: says so" has "Invalid label: Bad_Label"
check "invalid label: touches no container" no_calls

section "backup-db.sh: pg_dump fails"
d=$work/b1-dump-fails
mkdir "$d"
dump "$d" nimuairy-20260101T033000Z-daily.dump '30 days'
run env BACKUP_DIR="$d" BACKUP_REMOTE=r2crypt: MOCK_PG_DUMP_RC=1 bash "$BACKUP"
check "exits non-zero" exit_is 1
check "shows pg_dump's error" has "pg_dump: error: injected failure"
check "leaves no .dump or .tmp, and rotates nothing" same "$(ls -A "$d")" nimuairy-20260101T033000Z-daily.dump
check "skips validation" not_called pg_restore
check "uploads nothing" not_called rclone

section "backup-db.sh: validation fails"
run env BACKUP_DIR="$d" BACKUP_REMOTE=r2crypt: MOCK_PG_RESTORE_RC=1 bash "$BACKUP"
check "exits non-zero" exit_is 1
check "says so" has "Backup validation failed"
check "shows pg_restore's error" has "pg_restore: error: injected failure"
check "leaves no .dump or .tmp, and rotates nothing" same "$(ls -A "$d")" nimuairy-20260101T033000Z-daily.dump
check "uploads nothing" not_called rclone

section "backup-db.sh: rotation and upload"
d=$work/b1-rotation
mkdir -p "$d/sub" "$d/nimuairy-20260101T033000Z-dir.dump"
for f in nimuairy-20260101T033000Z-old.dump other.dump nimuairy-20260101T033000Z-daily.sql \
  sub/nimuairy-20260101T033000Z-old.dump nimuairy-20260101T033000Z-daily.dump.tmp; do
  dump "$d" "$f" '20 days'
done
dump "$d" nimuairy-20260301T033000Z-recent.dump '10 days'
touch -d '20 days ago' "$d/nimuairy-20260101T033000Z-dir.dump"
run env BACKUP_DIR="$d" BACKUP_REMOTE=r2crypt: bash "$BACKUP"
check "exits 0" exit_is 0
check "deletes an old dump" missing "$d/nimuairy-20260101T033000Z-old.dump"
check "keeps a recent dump" exists "$d/nimuairy-20260301T033000Z-recent.dump"
check "keeps an old file with another prefix" exists "$d/other.dump"
check "keeps an old file with another extension" exists "$d/nimuairy-20260101T033000Z-daily.sql"
check "keeps an old dump in a subdirectory" exists "$d/sub/nimuairy-20260101T033000Z-old.dump"
check "keeps an old directory named like a dump" exists "$d/nimuairy-20260101T033000Z-dir.dump"
check "keeps another run's old .tmp" exists "$d/nimuairy-20260101T033000Z-daily.dump.tmp"
check "keeps the new dump" matches "$(cd "$d" && echo nimuairy-*-daily.dump)" '^nimuairy-[0-9]{8}T[0-9]{6}Z-daily\.dump$'
check "uploads the dumps with rclone copy" called "rclone copy $d r2crypt: --include nimuairy-*.dump"
check "reports the upload" has "Uploaded to r2crypt:"

section "backup-db.sh: POSTGRES_CONTAINER"
d=$work/b1-container
mkdir "$d"
run env BACKUP_DIR="$d" POSTGRES_CONTAINER=pg-other MOCK_CONTAINER=pg-other bash "$BACKUP"
check "exits 0" exit_is 0
check "dumps from that container" called "docker exec pg-other sh -c"
check "validates in that container" called "docker exec -i pg-other pg_restore"

section "verify-db-backup.sh: nothing to verify"
run_verify BACKUP_DIR="$work/missing"
check "missing directory: exits 1" exit_is 1
check "missing directory: says so" has "ERROR: backup directory not found: $work/missing"
check "missing directory: touches no container" no_calls
d=$work/b2-empty
mkdir -p "$d/nimuairy-20261031T033000Z-dir.dump"
dump "$d" nimuairy-20261031T033000Z-daily.dump.tmp '1 hour'
dump "$d" other.dump '1 hour'
run_verify BACKUP_DIR="$d"
check "no dump: exits 1" exit_is 1
check "no dump: says so" has "ERROR: no nimuairy-*.dump backup in $d"
check "no dump: touches no container" no_calls

section "verify-db-backup.sh: success"
d=$work/b2
mkdir "$d"
dump "$d" nimuairy-20261029T033000Z-daily.dump '3 days'
dump "$d" nimuairy-20261030T033000Z-daily.dump '1 hour'
dump "$d" nimuairy-20261031T033000Z-daily.dump '2 days'
dump "$d" nimuairy-20261031T040000Z-daily.dump.tmp '1 minute'
newest=$d/nimuairy-20261030T033000Z-daily.dump
files_before=$(ls -lA --time-style=full-iso "$d")
run_verify BACKUP_DIR="$d"
db=$(db_of "$out")
check "exits 0" exit_is 0
check "names the newest dump by mtime, never a .tmp" has "Verifying $newest"
check "restores the newest dump" same "$(<"$MOCK_DIR/pg_restore.stdin")" "$(<"$newest")"
check "uses a fresh temporary name" matches "$db" '^nimuairy_verify_[0-9]{14}_[0-9]+_[0-9]+$'
check "creates, restores, queries, drops" same "$(tools)" "createdb pg_restore psql dropdb"
check "creates the temporary database" called "createdb -w -U app $db"
check "restores into it, stopping at the first error" called "pg_restore -w -U app -d $db --exit-on-error --no-owner"
check "restores through stdin" called "docker exec -i postgres-nimuairy sh -c"
check "queries it" called "psql -X -w -U app -d $db -v ON_ERROR_STOP=1 -At -F | -c SELECT"
check "drops it" called "dropdb -w --force -U app $db"
check "reports the counts" has "Smoke test: OK (2 changesets, 1 users, 0 characters)"
check "reports the server version" has "Container:  postgres-nimuairy (PostgreSQL 18.6)"
check "reports the cleanup" has "Cleanup:    dropped $db"
check "passes" has "RESULT: PASSED"
check "no warning" lacks "WARNING"
run_verify BACKUP_DIR="$d" MOCK_PSQL_OUT='18.6|2|0|0'
check "empty tables: pass" has "RESULT: PASSED"
check "empty tables: counted" has "Smoke test: OK (2 changesets, 0 users, 0 characters)"

section "verify-db-backup.sh: failures"
run_verify BACKUP_DIR="$d" MOCK_PG_RESTORE_RC=3
db=$(db_of "$out")
check "restore fails: exits with pg_restore's status" exit_is 3
check "restore fails: shows pg_restore's error" has "pg_restore: error: injected failure"
check "restore fails: reported" has "RESULT: FAILED at restore (exit 3)"
check "restore fails: no smoke test" not_called psql
check "restore fails: drops the database" called "dropdb -w --force -U app $db"
run_verify BACKUP_DIR="$d" MOCK_PSQL_RC=3
db=$(db_of "$out")
check "query fails: exits with psql's status" exit_is 3
check "query fails: shows the SQL error" has 'relation "characters" does not exist'
check "query fails: reported" has "RESULT: FAILED at smoke (exit 3)"
check "query fails: drops the database" called "dropdb -w --force -U app $db"
run_verify BACKUP_DIR="$d" MOCK_PSQL_OUT='18.6|0|0|0'
check "no changesets: exits 1" exit_is 1
check "no changesets: says why" has "ERROR: databasechangelog is empty"
check "no changesets: reported" has "RESULT: FAILED at smoke (exit 1)"
check "no changesets: drops the database" called "dropdb -w --force"
run_verify BACKUP_DIR="$d" MOCK_PSQL_OUT='garbage'
check "unexpected output: exits 1" exit_is 1
check "unexpected output: says so" has "ERROR: unexpected smoke test output: garbage"
run_verify BACKUP_DIR="$d" MOCK_CREATEDB_RC=1
check "createdb fails: exits non-zero" exit_is 1
check "createdb fails: shows createdb's error" has "already exists"
check "createdb fails: reported" has "RESULT: FAILED at create (exit 1)"
check "createdb fails: restores nothing" not_called pg_restore
check "createdb fails: drops nothing" not_called dropdb

section "verify-db-backup.sh: cleanup fails"
run_verify BACKUP_DIR="$d" MOCK_PG_RESTORE_RC=3 MOCK_DROPDB_RC=4
db=$(db_of "$out")
check "after a failed restore: keeps pg_restore's status" exit_is 3
check "after a failed restore: still reports the restore" has "RESULT: FAILED at restore (exit 3)"
check "after a failed restore: warns with the name" has "WARNING: could not drop the temporary database $db"
check "after a failed restore: shows how to drop it" has "--force $db'"
run_verify BACKUP_DIR="$d" MOCK_DROPDB_RC=4
db=$(db_of "$out")
check "after a good restore: exits 1" exit_is 1
check "after a good restore: restore was fine" has "Restore:    OK"
check "after a good restore: smoke test was fine" has "Smoke test: OK"
check "after a good restore: warns with the name" has "WARNING: could not drop the temporary database $db"
check "after a good restore: reported" has "RESULT: FAILED at cleanup (exit 1)"

section "verify-db-backup.sh: SIGTERM"
run_verify_killed pg_restore BACKUP_DIR="$d" MOCK_PG_RESTORE_SLEEP=2
db=$(db_of "$out")
check "during the restore: exits 143" exit_is 143
check "during the restore: reported" has "RESULT: FAILED at restore (exit 143)"
check "during the restore: drops the database" called "dropdb -w --force -U app $db"
run_verify_killed createdb BACKUP_DIR="$d" MOCK_CREATEDB_SLEEP=2
db=$(db_of "$out")
check "during createdb: exits 143" exit_is 143
check "during createdb: reported" has "RESULT: FAILED at create (exit 143)"
check "during createdb: warns with the name" has "WARNING: interrupted while creating $db"
check "during createdb: restores nothing" not_called pg_restore
check "during createdb: drops nothing, it may not be this run's" not_called dropdb
run_verify_killed dropdb BACKUP_DIR="$d" MOCK_DROPDB_SLEEP=2
db=$(db_of "$out")
check "during the cleanup: finishes the drop" has "Cleanup:    dropped $db"
check "during the cleanup: still reports" has "RESULT: PASSED"
check "during the cleanup: exits 0" exit_is 0

section "verify-db-backup.sh: parallel runs"
: >"$MOCK_LOG"
for i in 1 2; do
  (
    rc=0
    env BACKUP_DIR="$d" MOCK_PG_RESTORE_SLEEP=1 bash "$VERIFY" >"$work/parallel$i.out" 2>&1 || rc=$?
    echo "$rc" >"$work/parallel$i.rc"
  ) &
done
wait
log=$(<"$MOCK_LOG") out=$(cat "$work"/parallel*.out) rc="$(<"$work/parallel1.rc") $(<"$work/parallel2.rc")" shown=false
printf '%s\n' "$log" >>"$work/verify-calls"
db1=$(db_of "$(<"$work/parallel1.out")") db2=$(db_of "$(<"$work/parallel2.out")")
check "both pass" exit_is "0 0"
check "they use different databases" differ "$db1" "$db2"
for db in "$db1" "$db2"; do
  check "creates $db" called "createdb -w -U app $db"
  check "drops $db" called "dropdb -w --force -U app $db"
done

section "verify-db-backup.sh: POSTGRES_CONTAINER"
run_verify BACKUP_DIR="$d" POSTGRES_CONTAINER=pg-other MOCK_CONTAINER=pg-other
check "exits 0" exit_is 0
check "works in that container" called "docker exec pg-other sh -c"
check "restores in that container" called "docker exec -i pg-other sh -c"
check "names it" has "Container:  pg-other"

section "verify-db-backup.sh: production left alone (every run above)"
log=$(<"$work/verify-calls") out='' rc=- shown=false
targets=$(grep -E '^(createdb|pg_restore|psql|dropdb) ' <<<"$log" |
  sed -E 's/.* -d ([^ ]+) .*/\1/; s/^(createdb|dropdb) .* ([^ ]+)$/\2/')
check "every database used is a temporary one" same "$(grep -cv '^nimuairy_verify_' <<<"$targets")" 0
check "the production database is never named" same "$(grep -c proddb <<<"$log")" 0
check "never dumps" not_called pg_dump
check "only runs docker exec, never creates a container" same "$(grep '^docker ' <<<"$log" | grep -cv '^docker exec ')" 0
check "never changes a backup file" same "$(ls -lA --time-style=full-iso "$d")" "$files_before"

echo "$passed passed, $failed failed"
((failed == 0))
