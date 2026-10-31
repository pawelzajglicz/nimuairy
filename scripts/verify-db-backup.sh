#!/usr/bin/env bash
# Proves that the newest local dump can be restored: restores it into a temporary database in the
# running postgres container, queries it and drops it again (see README, Database backups). The
# production database is never read or written, and no backup file is changed.
# The code passed to pg() is single-quoted on purpose: it expands in the container.
# shellcheck disable=SC2016
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-$(cd "$(dirname "$0")/.." && pwd)/backups}
POSTGRES_CONTAINER=${POSTGRES_CONTAINER:-postgres-nimuairy}

# The tables of nimuairy-api/src/main/resources/db/changelog, plus Liquibase's history, which has a
# row for every applied changeset: any database the backend ran against has some, so an empty
# history means the dump did not bring the data back. The other tables may legitimately be empty.
readonly SMOKE_SQL="SELECT current_setting('server_version'),
  (SELECT count(*) FROM databasechangelog),
  (SELECT count(*) FROM users),
  (SELECT count(*) FROM characters)"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[[ -d $BACKUP_DIR ]] || fail "backup directory not found: $BACKUP_DIR"
backup=
for f in "$BACKUP_DIR"/nimuairy-*.dump; do
  [[ -f $f && ! -L $f ]] || continue
  # Newest by mtime, the age rotation goes by; on a tie the later name, whose timestamp is later.
  if [[ -z $backup || ! $backup -nt $f ]]; then
    backup=$f
  fi
done
[[ -n $backup ]] || fail "no nimuairy-*.dump backup in $BACKUP_DIR"
size=$(du -h "$backup" | cut -f1)
mtime=$(date -u -r "$backup" '+%Y-%m-%d %H:%M:%S UTC')
echo "Verifying $backup"

# The PID keeps parallel runs apart. createdb refuses a name that exists, so even a collision can
# never take over another database.
db=nimuairy_verify_$(date -u +%Y%m%d%H%M%S)_$$_$RANDOM
db_state=none
stage=create
version=unknown
restore_result='not run'
smoke_result='not run'
cleanup_result='nothing to clean up'

# Runs $1 with sh in the container, where $POSTGRES_USER is the container's own; the database name
# arrives as $1 and further arguments as $2..., never spliced into the code.
pg() {
  local code=$1
  shift
  docker exec "$POSTGRES_CONTAINER" sh -c "$code" sh "$db" "$@"
}

report() {
  echo
  echo "== Backup restore verification"
  echo "Backup:     $backup ($size, modified $mtime)"
  echo "Container:  $POSTGRES_CONTAINER (PostgreSQL $version)"
  echo "Database:   $db (temporary)"
  echo "Restore:    $restore_result"
  echo "Smoke test: $smoke_result"
  echo "Cleanup:    $cleanup_result"
  if ((rc == 0)); then
    echo "RESULT: PASSED"
  else
    echo "RESULT: FAILED at $stage (exit $rc)"
  fi
}

# Drops only a database this run created, and keeps the exit status of whatever failed first.
cleanup() {
  rc=$?
  # Otherwise a second Ctrl-C would end the script inside this handler, before the drop, the warning
  # and the report.
  trap '' INT TERM HUP
  set +e
  case $db_state in
    created)
      # --force: docker exec does not pass signals on, so after an interrupt pg_restore may still be
      # connected to the database. It ends only the sessions on this database.
      if pg 'dropdb -w --force -U "$POSTGRES_USER" "$1"'; then
        cleanup_result="dropped $db"
      else
        cleanup_result="FAILED, $db is left behind"
        echo "WARNING: could not drop the temporary database $db in $POSTGRES_CONTAINER. Drop it with:" >&2
        echo "  docker exec $POSTGRES_CONTAINER sh -c 'dropdb -U \"\$POSTGRES_USER\" --force $db'" >&2
        if ((rc == 0)); then
          rc=1
          stage=cleanup
        fi
      fi
      ;;
    creating)
      cleanup_result="unknown, interrupted while creating $db"
      echo "WARNING: interrupted while creating $db, so this run cannot tell whether it exists or who" \
        "created it, and leaves it alone. If it exists, drop it with:" >&2
      echo "  docker exec $POSTGRES_CONTAINER sh -c 'dropdb -U \"\$POSTGRES_USER\" --force $db'" >&2
      ;;
  esac
  report
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

db_state=creating
if ! pg 'createdb -w -U "$POSTGRES_USER" "$1"'; then
  db_state=none
  fail "could not create the temporary database $db"
fi
db_state=created

stage=restore
restore_result=FAILED
start=$SECONDS
# The dump goes in through stdin, so nothing is written into the container. --no-owner matches the
# README's production restore, so this tests the restore that would really be run.
docker exec -i "$POSTGRES_CONTAINER" \
  sh -c 'pg_restore -w -U "$POSTGRES_USER" -d "$1" --exit-on-error --no-owner' sh "$db" < "$backup"
restore_result="OK ($((SECONDS - start)) s)"

stage=smoke
smoke_result=FAILED
out=$(pg 'psql -X -w -U "$POSTGRES_USER" -d "$1" -v ON_ERROR_STOP=1 -At -F "|" -c "$2"' "$SMOKE_SQL")
IFS='|' read -r version changesets users characters <<<"$out"
[[ $changesets =~ ^[0-9]+$ && $users =~ ^[0-9]+$ && $characters =~ ^[0-9]+$ ]] ||
  fail "unexpected smoke test output: $out"
((changesets > 0)) || fail "databasechangelog is empty, so the dump holds no applied migrations"
smoke_result="OK ($changesets changesets, $users users, $characters characters)"
stage=finished
