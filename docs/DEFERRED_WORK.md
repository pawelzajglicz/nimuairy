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
