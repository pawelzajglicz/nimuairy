# nimuairy
turn based game java+angular

## Setup

Enable repo git hooks (keeps `.claude/skills` and `.junie/skills` in sync with `.agents/skills`):

```
git config core.hooksPath .githooks
```

## Running with Docker

The frontend and backend images are built on
[Docker Hardened Images](https://www.docker.com/products/hardened-images/) (`dhi.io`) base
images, and Postgres runs the DHI image directly, so a one-time setup is needed first:

1. Have a Docker Hub account and enroll it in the free Hardened Images **Community** tier at
   [docker.com/products/hardened-images](https://www.docker.com/products/hardened-images/#compare)
   ("Start building").
2. `docker login dhi.io` (separate from a regular `docker login`).

Then:

```bash
docker compose up --build
```

Then open [http://localhost:4200](http://localhost:4200). The browser only ever talks to the
frontend container; nginx proxies `/api/*` to the backend internally.

`docker compose up` merges `compose.yaml` with `compose.override.yaml`, which publishes the
ports for local development: frontend (`localhost:4200`), backend (`localhost:8000`) and
Postgres (`localhost:5432`). `compose.yaml` on its own publishes nothing.

### Production

```bash
docker compose -f compose.yaml -f compose.prod.yaml up -d --build
```

Passing files explicitly skips `compose.override.yaml`, so no host ports are published.
The app is reachable only through a Cloudflare Tunnel: the `cloudflared` container opens an
outbound connection to Cloudflare, and the tunnel's route points at `http://frontend:8080`.
Production also runs `cloudflare/cloudflared`, the only image not from DHI.
The VPS firewall (UFW and the provider's) and `scripts/configure-ufw.sh` are described in
[docs/VPS_FIREWALL.md](docs/VPS_FIREWALL.md). Fail2ban, which bans addresses that keep failing SSH
logins, and `scripts/configure-fail2ban.sh` are described in [docs/VPS_FAIL2BAN.md](docs/VPS_FAIL2BAN.md).
Automatic Ubuntu security updates and `scripts/configure-unattended-upgrades.sh` are described in
[docs/VPS_UNATTENDED_UPGRADES.md](docs/VPS_UNATTENDED_UPGRADES.md).

The VPS runs prebuilt images instead: `build-and-push.yml` pushes
`ghcr.io/pawelzajglicz/nimuairy-{api,frontend}:<commit SHA>` on every master push, and the manual
`release.yml` workflow deploys a chosen SHA over SSH (`deploy-on-vps.yml`), recording it as
`APP_SHA` in the VPS `.env` and rolling back if the smoke test fails. `APP_SHA` is required by
`compose.prod.yaml`; for a local production build use any value, e.g. `APP_SHA=local`.

`.env` must define `POSTGRES_PASSWORD`, `JWT_SECRET` and `CLOUDFLARED_TOKEN`; the stack
refuses to start without them instead of falling back to the dev placeholders.
`.env.example` leaves them empty on purpose, so a copied `.env` fails fast until real
values are filled in. `JWT_SECRET` must be at least 32 characters.

Stop production:

```bash
docker compose -f compose.yaml -f compose.prod.yaml down
```

On a dedicated production host, set `COMPOSE_FILE=compose.yaml:compose.prod.yaml` in `.env`.
Plain `docker compose up`/`down`/`ps` then use the production files, so the dev override
(and its published ports) can't be picked up by accident.

Stop the dev stack:

```bash
docker compose down
```

Stop the stack and delete the Postgres data volume:

```bash
docker compose down -v
```

### Database backups

`scripts/backup-db.sh` dumps the database (`pg_dump -Fc`) into `/var/nimuairy/backups`, keeps
14 days locally and, with `BACKUP_REMOTE` set, copies the dumps to Cloudflare R2 through an
rclone `crypt` remote, so they leave the VPS already encrypted. A dump gets its final name only
after `pg_restore` has read it back in full inside the container, so a truncated or corrupt dump
fails the run, and with it the deploy, and is never kept or uploaded. It runs daily from cron and
before every rollout in `deploy-on-vps.yml`: rolling back `APP_SHA` reverts the code but not
Liquibase migrations, so that pre-deploy dump is the way back to the previous schema. The deploy
copies the script to the VPS; cron and rclone are set up once by hand.

One-time setup on the VPS, after the first deploy that copied the script:

1. In Cloudflare, create the R2 bucket `nimuairy-backups` with a lifecycle rule deleting objects
   after 90 days and a 30-day bucket lock rule (dumps cannot be deleted even with a stolen token),
   and an R2 API token with *Object Read & Write* on that bucket only.
2. As root: `apt install rclone`.
3. As `deploy` (`su - deploy`); `read -rs` keeps the values out of the shell history. Store the
   crypt password in a password manager: without it the off-site dumps cannot be decrypted.
   ```bash
   read -rs R2_KEY_ID; read -rs R2_SECRET; read -rs CRYPT_PASSWORD
   rclone config create r2 s3 provider=Cloudflare access_key_id="$R2_KEY_ID" \
     secret_access_key="$R2_SECRET" endpoint=https://<ACCOUNT_ID>.r2.cloudflarestorage.com \
     no_check_bucket=true no_head=true
   rclone config create r2crypt crypt remote=r2:nimuairy-backups password="$CRYPT_PASSWORD" --obscure
   BACKUP_REMOTE=r2crypt: bash /var/nimuairy/scripts/backup-db.sh manual
   rclone ls r2crypt:
   ```
   `no_check_bucket` is needed because a bucket-scoped token may not create buckets. `no_head`
   skips rclone's check after each upload: with a bucket lock R2 versions objects, and that check
   asks for a specific version, which R2 answers with `501 Not Implemented` although the upload
   succeeded.
4. As root, `/etc/cron.d/nimuairy-backup` (output goes to the journal:
   `journalctl -t nimuairy-backup`):
   ```
   BACKUP_REMOTE=r2crypt:
   30 3 * * * deploy bash /var/nimuairy/scripts/backup-db.sh 2>&1 | logger -t nimuairy-backup
   ```

`backup-db.sh` shows that a dump is a complete archive; `scripts/verify-db-backup.sh` shows that
it restores. It takes the newest `nimuairy-*.dump` in `/var/nimuairy/backups` (by modification
time) and, in the running `postgres-nimuairy` container:

1. creates a temporary database with a unique name, `nimuairy_verify_<UTC time>_<PID>_<random>`;
2. restores the dump into it with `pg_restore --exit-on-error --no-owner`, so any error fails it;
3. runs a smoke test: `users`, `characters` and Liquibase's `databasechangelog` must exist and be
   readable, and `databasechangelog`, where Liquibase records every applied changeset, must have
   rows; the other tables may be empty, their row counts are only reported;
4. drops the temporary database, also after a failure or Ctrl-C.

It never touches the production database, stops nothing and starts no container, but the restore
runs on the production instance and briefly holds a second copy of the data there, so run it
outside busy hours. The deploy copies only `backup-db.sh`, so copy this script by hand, and again
whenever it changes:

```bash
scp -P <port> scripts/verify-db-backup.sh deploy@<host>:/var/nimuairy/scripts/
ssh -p <port> deploy@<host> bash /var/nimuairy/scripts/verify-db-backup.sh
```

The report at the end names the dump, the PostgreSQL version and the result of every step.
`RESULT: PASSED` (exit status 0) means the dump restored, the smoke test passed and the temporary
database is gone. `RESULT: FAILED at <stage>` (non-zero) names the step that failed: `create`, the
temporary database could not be created; `restore`, the dump does not restore, so do not count on
it and find out why before the next deploy; `smoke`, it restored but tables or data are missing;
`cleanup`, the test passed but the temporary database is still there. A `WARNING` names a temporary
database that is left behind, with the command that drops it. A run killed outright (`kill -9`, a
reboot) can also leave one; the script drops only the database it created in that run, never older
`nimuairy_verify_*` ones, so drop those by hand. `BACKUP_DIR` and `POSTGRES_CONTAINER` override the
directory and the container. No cron entry runs it yet.

It tests the local copy only, not that the off-site copy downloads from R2 and decrypts. For that,
bring a dump back into an empty directory as for a production restore below and point the script
at it: `BACKUP_DIR=/tmp/restore bash /var/nimuairy/scripts/verify-db-backup.sh`.

`bash scripts/db-backup-test.sh` tests both scripts against fake `docker`, PostgreSQL tools and
`rclone`. `bash scripts/db-backup-integration-test.sh` runs them against a throwaway container of
the production PostgreSQL image (needs Docker and `docker login dhi.io`).

Restoring production (an off-site dump first comes back with
`rclone copy r2crypt: /tmp/restore --include '<file name>'`):

```bash
cd /var/nimuairy
docker compose stop backend frontend
docker exec -i postgres-nimuairy sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < <dump file>
docker compose up -d
```

### Container architecture

```text
browser
   |
   |  dev:  localhost:4200
   |  prod: Cloudflare -> cloudflared (outbound tunnel)
   v
frontend (nginx, :8080)
   |
   | /api/*            network: frontend
   v
backend (Spring Boot, :8000)
   |
   |                   network: backend (internal, no outside access)
   v
postgres
```

Configuration is read from environment variables (see `.env.example`); copy it to `.env` to
override the defaults. For local development `.env` is optional: values left empty fall
back to the dev placeholders in `compose.yaml`. Production requires real values (see
[Production](#production)).

The backend and frontend runtime images are the hardened, distroless-style DHI tags: no
shell, no package manager, and they run as a non-root user by default. That's why the
backend's healthcheck is a small Java program (`nimuairy-api/docker/HealthCheck.java`)
calling `/actuator/health` instead of `curl`, and why nginx listens on 8080 instead of 80
(a non-root process can't bind a privileged port). The frontend starts only once the
backend reports healthy, which includes a working database connection.

For backend/frontend development outside Docker, see `nimuairy-api/CLAUDE.md` and
`frontend/CLAUDE.md`.

### Observability

`observability/` holds a local Prometheus, Tempo, Loki, Alloy and Grafana stack, and
`compose.observability*.yaml` attach the backend to it with the OpenTelemetry Java agent. Neither
is used by a plain `docker compose up` or in production. How to run, verify and update it, and
the earlier local tracing stage, are in `docs/OBSERVABILITY.md`.
