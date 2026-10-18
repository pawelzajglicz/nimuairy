#!/usr/bin/env bash
# Dumps the production database on the VPS: daily from cron and from deploy-on-vps.yml before each
# rollout (see README, Backups). The optional argument is a label added to the file name.
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-$(cd "$(dirname "$0")/.." && pwd)/backups}
KEEP_DAYS=${KEEP_DAYS:-14}
# rclone remote for the off-site copy (r2crypt: in the cron entry); empty keeps backups local only.
BACKUP_REMOTE=${BACKUP_REMOTE:-}
LABEL=${1:-daily}

if [[ ! "$LABEL" =~ ^[a-z0-9-]+$ ]]; then
  echo "Invalid label: $LABEL" >&2
  exit 1
fi

# Dumps hold user data (e-mails, password hashes).
umask 077
mkdir -p "$BACKUP_DIR"
file="$BACKUP_DIR/nimuairy-$(date -u +%Y%m%dT%H%M%SZ)-$LABEL.dump"
trap 'rm -f "$file.tmp"' EXIT

# Runs inside the container: postgres is only on an internal network the host cannot reach, and its
# local socket needs no password. The variables expand from the container's own environment.
docker exec postgres-nimuairy sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$file.tmp"
# Only a complete dump gets a name that rotation and upload pick up.
mv "$file.tmp" "$file"
echo "Dumped $file ($(du -h "$file" | cut -f1))"

find "$BACKUP_DIR" -name 'nimuairy-*.dump' -mtime +"$KEEP_DAYS" -delete

# copy, not sync: local rotation must not delete off-site copies; the R2 bucket's lifecycle rule
# handles their retention.
if [ -n "$BACKUP_REMOTE" ]; then
  rclone copy "$BACKUP_DIR" "$BACKUP_REMOTE" --include 'nimuairy-*.dump'
  echo "Uploaded to $BACKUP_REMOTE"
fi
