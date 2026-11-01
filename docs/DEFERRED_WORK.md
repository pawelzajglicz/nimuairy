# Deferred work

Specific technical work that was considered and deliberately postponed. Each entry records the
decision, so the work is not forgotten and is not picked up again without the reasons it was put
off.

This is not a backlog of ideas and does not replace GitHub Issues. An entry belongs here only when
the work is concrete and postponing it was a conscious decision.

## Maintaining this list

- Add an entry in the change that defers the work.
- Each entry has:
  - **Status**: one of
    - `Deferred`: postponed; it stays deferred until a decision is made to resume or cancel it;
    - `In progress`: the work has been resumed;
    - `Done`: the work is finished;
    - `Cancelled`: the work will not be done.
  - **Origin**: the work it came from.
  - **Current state**: what exists today, so the gap is visible.
  - **Reason for deferral**.
  - **Reconsider when**: the conditions that make the work worth doing.
  - **Potential scope when resumed**, if known.
  - **Constraints**, if any: what an eventual implementation must not do.
- Keep **Status** and **Current state** accurate when the work or the setup it describes changes.
- Do not remove entries. A finished or abandoned entry stays, with the status `Done` or
  `Cancelled`, so the decision and its reasons remain on record.

## B5 — Periodic backup restore verification

**Status:** Deferred

**Origin:** Database backup reliability work (B1–B5).

**Current state:**

- The database is backed up daily at 03:30 from cron (`/etc/cron.d/nimuairy-backup`) and before
  every deploy.
- `scripts/backup-db.sh` reads every dump back in full with `pg_restore` before keeping it as a
  backup.
- `scripts/verify-db-backup.sh` restores the newest local dump into a temporary database and runs a
  smoke test (see [Database backups](../README.md#database-backups)).
- `verify-db-backup.sh` checks a local dump only. It does not verify that the off-site copy
  downloads from R2 and decrypts.
- The deploy does not copy `verify-db-backup.sh` to the VPS; it is copied there by hand.
- A manual run on the VPS passed on 2026-10-31: PostgreSQL 18.6, `RESULT: PASSED`, the temporary
  database was dropped.
- `verify-db-backup.sh` is run by hand only. No cron entry runs it.

**Reason for deferral:** Verifying restores by hand is enough at this early stage of the project.
Running it on a schedule would put extra load on the production PostgreSQL container, because the
restore runs on the production instance and briefly holds a second copy of the data there. It
would also need a decision on how results are reported and how failures are handled.

**Reconsider when:**

- the application starts storing important user data that changes over time;
- being able to recover the database matters more operationally;
- regular, automatic verification of recovery becomes justified.

**Potential scope when resumed:**

- decide how often the verification runs;
- schedule it outside the busiest hours;
- decide how a failure is reported;
- make sure temporary databases are cleaned up;
- document the operating procedure.

**Constraints:**

- do not change the existing backup schedule unless it is necessary;
- do not run the verification at the same time as a deploy or other database maintenance;
- do not modify the production database during the test.

## S3 — Application secrets out of container environment variables

**Status:** Deferred

**Origin:** Observability production rollout, S3 (Docker socket proxy for Alloy).

**Current state:**

- `compose.prod.yaml` passes the production secrets as environment variables:
  `POSTGRES_PASSWORD` (postgres), `SPRING_DATASOURCE_PASSWORD` and `JWT_SECRET` (backend),
  `TUNNEL_TOKEN` (cloudflared).
- `GET /containers/{id}/json` returns them in `Config.Env`. Anyone with Docker access on the host
  can read them. Since S3 so can a compromised Alloy, through `docker-socket-proxy`: its allowlist
  cannot restrict which container is inspected (see
  [Docker API access](OBSERVABILITY.md#docker-api-access)).
- The proxy limits Alloy to read-only calls. It does not hide environment variables.

**Reason for deferral:** Reading secrets from files changes how the backend, Postgres and
cloudflared are configured and how the deploy workflow provisions them on the VPS. That is a
change to the application deployment that needs its own plan and tests. S3 changes only the
observability stack.

**Reconsider when:**

- the residual risk is to be removed rather than accepted before Alloy collects the app's logs on
  the VPS (S7);
- another service or person gets access to the Docker API on the VPS;
- a production secret is rotated or a new one is added.

**Potential scope when resumed:**

- Compose file secrets (`secrets:` with `file:`, mounted under `/run/secrets`) instead of
  `environment:`.
- For each consumer, verify what it supports at that time: `POSTGRES_PASSWORD_FILE` in the
  `dhi.io/postgres` image, Spring Boot's `configtree:` config import for the backend, and
  cloudflared's options for reading the tunnel token from a file.
- The deploy workflow writes the secret files on the VPS instead of `.env` entries.
- Check with `docker inspect` that no secret is left in `Config.Env`.

**Constraints:**

- do not change the deploy workflow or the VPS `.env` without a tested rollback path;
- never commit secret files; keep them out of the repository like `.env`.

## S3.3b — Alloy starting while the socket proxy is down

**Status:** Deferred

**Origin:** Observability production rollout, S3.3 (socket proxy outage check).

**Current state:**

- `scripts/observability-proxy-resilience-check.sh` covers one case: the proxy stops for 20 to 45 s
  while Alloy keeps running, and Alloy must resume without a restart (see
  [Verify](OBSERVABILITY.md#verify-1)).
- Alloy starting, or restarting, while the proxy is down is not tested. It happens after a daemon
  restart or a reboot, when restart policies start containers without the `depends_on` order (see
  [Docker API access](OBSERVABILITY.md#docker-api-access)). What is known comes from reading the
  source of Alloy v1.20.1 and its Docker client:
  - the client negotiates the API version once, with `HEAD /_ping`. Until that succeeds, it sends
    paths without a version prefix. The proxy refuses those (`403 path not allowed`), as the smoke
    test confirms for `GET /containers/json`. So refusals of Alloy's own requests are expected for
    a while;
  - when a stream ends, Alloy drops the container's saved position. A restart before the stream
    reopens reads that container's log from the start again: duplicates, or lines Loki rejects as
    too old.

**Reason for deferral:** it breaks the S3.3 check's rule that Alloy must not restart, and it runs
other code. It needs its own expectations for Alloy's refusals and for duplicates. Mixing those
into the S3.3 check would make that check harder to read and to trust.

**Reconsider when:**

- before Alloy collects logs on the VPS (S6, S7), if the start order after a daemon restart or a
  reboot matters there;
- an Alloy upgrade changes how its Docker client negotiates the API version;
- logs go missing or arrive twice after a daemon restart or a reboot.

**Potential scope when resumed:**

- A separate scenario: stop the proxy, restart Alloy, keep the proxy down for a while, then start
  it.
- Check that collection resumes and that a container started meanwhile is found.
- Report refusals of unversioned paths during the outage separately from refusals after the API
  answers, which must stay at zero.
- Report duplicates as `info`.

**Constraints:**

- keep this scenario apart from the S3.3 check, and do not weaken that check's rule that Alloy
  must not restart;
- do not widen the proxy's allowlist to unversioned paths to make the scenario pass.
