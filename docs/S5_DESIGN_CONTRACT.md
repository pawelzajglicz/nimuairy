# S5 Design Contract — Production Observability Operations Guide

**Status, 2026-11-15: S5.1 to S5.3 complete; S5.2 merged in PR #125. S5.4 closes S5 in the
repository (§8).**
- The operator accepted this contract on 2026-11-15.
- No VPS operation, deployment or application integration was performed during S5.
- **S5 does not authorize S6 or S7** (§8.4).

**Base:** `master` at `0099beb017b40114ed1189fc48460aeb216fcec6`  
**Deliverable:** `docs/OBSERVABILITY_PRODUCTION.md`

## 1. Purpose

S5 documents how to operate, inspect, update and troubleshoot the Nimuairy production observability stack after its initial deployment.

The guide is intended for the operator of the VPS. It must provide practical procedures while remaining consistent with the existing Compose configuration, security boundaries, resource budget and accepted production decisions.

S5 is a documentation stage. It does not deploy the stack, modify the running VPS or change the application's deployment process.

The production stack has **not yet been deployed to the VPS**. S6 is responsible for its first deployment and requires separate operator approval. S7, also requiring separate approval, will connect the application to the stack.

The guide must distinguish:
- the configuration and procedures prepared in the repository;
- operations that become applicable after S6;
- application telemetry that becomes available only after S7.

It must never imply that a procedure has already been executed on the VPS when it has not.

## 2. Current state and authoritative sources

S4b is complete and merged in PR #123. Its production hardening includes:
- only Grafana published on `127.0.0.1:3000`;
- Grafana production password supplied through a secret file;
- Tempo running as `10001:10001`;
- production configuration checks and CI coverage.

S4b did not change the VPS.

Use the following documents as the primary sources of truth:

| Source | Responsibility |
|---|---|
| `docs/S4b_DESIGN_CONTRACT.md` | Accepted production decisions, security properties, Grafana secret handling, deployment prerequisites and known limitations |
| `docs/OBSERVABILITY.md` | Technical architecture, Compose configuration, networks, Docker API access, volumes, checks and image updates |
| `docs/VPS_RESOURCE_BUDGET.md` | Resource limits, evidence, VPS constraints and verification procedures |
| `docs/DEFERRED_WORK.md` | Work deliberately postponed, including S3.3b and B7 |
| `docs/VPS_FIREWALL.md` | Current VPS firewall policy |
| `README.md` | Current application deployment and observability status |

Repository configuration and scripts must be inspected when writing commands. Do not rely on documentation alone if it might have drifted from the implementation.

If a procedure requires a fact that has not yet been verified, explicitly mark it as an S6 prerequisite or an unverified assumption. Do not silently turn an assumption into a production fact.

## 3. Deliverables and allowed changes

### Required deliverables

1. `docs/S5_DESIGN_CONTRACT.md` — this contract, maintained as the stage's decision record.
2. `docs/OBSERVABILITY_PRODUCTION.md` — the production operator guide.
3. A small link to the new guide from `docs/OBSERVABILITY.md`.

The new guide should complement `OBSERVABILITY.md`, not duplicate its full technical explanation.

### Allowed changes

- Add or update the two S5 documentation files.
- Add a short cross-reference in `docs/OBSERVABILITY.md`.
- Correct an existing documentation inconsistency only when it directly prevents the S5 guide from being accurate. Report such a case before expanding the scope.

### Explicitly excluded

- Changes to Compose files, scripts, application code or CI workflows.
- Changes to the application deployment workflow.
- A new observability deployment workflow.
- Any operation on the VPS.
- The first production startup or migration of existing volumes.
- Changes to `README.md` or `docs/VPS_FIREWALL.md`; these should be updated during S6 to reflect the actual deployed state.
- Implementation of deferred work, especially S3.3b, B7 and S3.
- Introduction of alerting, new dashboards or additional observability capabilities.

## 4. Required guide content

The guide should use practical sections and command examples. Commands must be consistent with the current repository and must clearly identify whether they are intended for the VPS or for local development.

### 4.1 Production architecture and operational invariants

Explain the production stack at the operator level.

Cover:
- the separate Compose project `nimuairy-observability`;
- the deployment directory `/var/nimuairy-observability`;
- the relationship between the observability stack and the application Compose project;
- the production network layout and the purpose of the individual networks;
- persistent volumes and the data stored in them;
- the production port policy.

The guide must explicitly state:

- Every production create or recreate operation must use exactly `observability/compose.yaml` and `observability/compose.prod.yaml`.
- `observability/compose.test.yaml` is for CI and local tests only. It must never be used on the VPS.
- Grafana's `127.0.0.1:3000` is the only published host port.
- Removing published ports is not a network isolation boundary against processes running on the VPS host. The host can reach container bridge addresses.
- The application and observability stack are separate Compose projects. Starting, stopping or removing the application must not be described as an operation on observability.

### 4.2 Delivering files to the VPS

Document the accepted manual distribution method:

- files are transferred using `git archive`;
- no observability deployment workflow exists;
- the target directory is `/var/nimuairy-observability`;
- the directory structure must preserve the `observability/` path expected by the Compose files.

Explain how repository updates are transferred without overwriting or deleting the untracked production configuration and secret files.

In particular:
- `observability/.env` is not tracked;
- `observability/secrets/grafana_admin_password` is not tracked;
- an update of tracked configuration must preserve these files.

Commands must be checked for their actual extraction and overwrite behaviour. Do not assume that an archive operation also removes obsolete files from the destination.

### 4.3 Host-specific configuration and Grafana secret

Document the two required production configuration items.

**Docker socket group**

On a Linux host, `DOCKER_SOCKET_GID` must match the group ID of the Docker socket:

```bash
stat -c %g /var/run/docker.sock
```

The resulting value belongs in the untracked `observability/.env` file.

Explain the observable symptom of a wrong value: the Docker socket proxy cannot access the socket and the stack cannot become healthy as expected.

**Grafana password**

The secret file is:

```text
/var/nimuairy-observability/observability/secrets/grafana_admin_password
```

Document its requirements:
- it must be a regular file;
- it must not be empty;
- it must not contain the development password `admin`;
- it must be readable by UID 472 inside the Grafana container;
- its parent directory must have mode `0700`;
- it must not be stored in Git or printed in command output.

The initial secret creation belongs to S6. S5 should describe the operator requirements and the safe handling principles.

The precise file owner and mode on the VPS remain an S6 decision. S6 must first resolve the relevant UID mapping and choose a mode that permits Grafana to read the file.

Do not print the secret or Grafana's `/proc/1/environ` in diagnostic commands.

### 4.4 Accessing Grafana

Document access through an SSH tunnel to the published loopback endpoint.

The intended path is:

```text
local browser
    |
    | http://127.0.0.1:3000
    |
local SSH tunnel
    |
    | SSH connection
    |
VPS 127.0.0.1:3000
    |
Grafana container
```

Provide an OpenSSH command example and instructions applicable to PuTTY.

The guide must make clear that:
- Grafana is not exposed directly to the internet;
- no additional UFW rule is required for this tunnel;
- the production Grafana credentials are different from the development `admin`/`admin` credentials.

### 4.5 Diagnostics without publishing additional ports

Document how to inspect services without adding host port mappings.

Include:
- Grafana Explore and datasource status;
- Prometheus targets and queries;
- Loki readiness and basic API checks;
- Tempo readiness and trace availability;
- Alloy logs and component status;
- Docker socket proxy logs;
- container health and restart counts.

Use commands executed from existing containers on the appropriate Docker network where possible. For example:

```bash
docker exec prometheus wget -qO- http://loki:3100/ready
```

**Alloy UI access**

Alloy's port `12345` is not published in production. Do not add a permanent port mapping to make its UI accessible.

Preferred approach:
1. Obtain Alloy's current IP address on `nimuairy-observability_stack` using `docker inspect`.
2. Use an SSH local port forward to that container address and port `12345`.
3. Open the UI through the local forwarded endpoint.
4. Re-read the IP after a container recreation, because it may change.

This approach uses the host's ability to reach container bridge addresses. It does not add a published Docker port. The guide must explain the distinction and mark the actual VPS path for verification during S6.

If this procedure cannot be verified from the repository's network model or the S6 environment, document the limitation rather than introducing a new permanent port mapping.

### 4.6 Day-to-day lifecycle operations

Document the normal lifecycle:
- inspect status;
- start or recreate the stack;
- stop individual services when justified;
- stop the entire stack;
- bring it back up;
- inspect logs after a restart.

Every production Compose example must use the base and production files explicitly.

Clearly distinguish:
- `stop`, which stops containers;
- `down`, which removes containers and the Compose network but retains named volumes;
- `down -v`, which also removes persistent volumes and destroys stored telemetry and Grafana state.

The guide must warn against `down -v` and manual volume deletion as routine maintenance.

Do not recommend restarting the entire stack as the default response to every service problem.

### 4.7 Health checks and routine inspection

Provide a concise operational checklist covering:

- Compose service status and health;
- container restarts and OOM state;
- recent logs of individual services;
- Grafana datasource availability;
- Prometheus target status;
- Loki and Tempo readiness;
- Alloy log collection status;
- available disk space and Docker disk usage;
- current resource consumption and relevant cgroup counters.

Use `docs/VPS_RESOURCE_BUDGET.md` as the source of resource values and verification commands. Do not duplicate its full resource analysis in the production guide.

Important constraints:
- The VPS's checks found `memory.peak` and `pids.peak` absent; the local resource checks read both.
- Do not recommend running `observability-limits-check.sh runtime` directly on the VPS. Use the documented read-only VPS verification procedure from the S4.4 contract.
- `observability-prod-check.sh runtime` is supported on the VPS, but each invocation makes one failed `admin:admin` login attempt. Grafana limits failed logins, so this check must be run deliberately and not repeated as a routine health probe.
- Do not present CI checks as proof that the live VPS is healthy.

### 4.8 Updating images and configuration

Explain the update process for the production stack.

Cover:
- Dependabot's image update PRs;
- reading release notes;
- updating one image at a time;
- the existing `observability` CI job and the checks it performs;
- resource-limit implications of an image update;
- manual delivery of the updated repository files to the VPS;
- pulling updated images and recreating the affected containers with the production Compose files;
- post-update checks.

The guide must state explicitly that there is no automatic observability deployment workflow.

Post-update verification should include, as applicable:
- service status and health;
- recent service logs;
- Grafana authentication and datasource availability;
- Prometheus targets;
- Alloy and socket proxy behaviour;
- resource consumption;
- persistence of data across ordinary container recreation.

Explain that CI runs the stack briefly and nearly idle. Passing CI does not prove that a new image fits the VPS resource budget under production load.

Include version-specific risks already documented in `OBSERVABILITY.md`, especially:
- changes to Alloy's Docker API calls;
- changes to Alloy's UID or storage layout;
- changes to Tempo's UID or storage layout;
- changes to Grafana's login behaviour;
- changes to Prometheus configuration and its restart requirement.

Do not introduce automatic cleanup or broad image/volume pruning as part of the update procedure.

### 4.9 Grafana password rotation

Document the distinction between the password file and the password stored in Grafana's existing database.

Changing the secret file alone does not change the password in an existing `grafana.db`.

The documented mechanism for updating an existing Grafana database is:

```bash
grafana cli admin reset-admin-password --password-from-stdin
```

The guide must describe how to invoke it through `docker exec -i` without passing the password as a command-line argument.

After a successful rotation, the file must be updated to the same password so that a future empty `grafana-data` volume is initialized with the current credential.

Explain:
- the safe order of operations;
- how to verify the new credential;
- how to avoid printing or storing the password in shell history;
- what happens if the CLI operation fails;
- why a simple container restart is not a password rotation.

Do not invent a different Grafana password-reset mechanism.

### 4.10 Retention, persistent data and data loss

Document the configured retention periods:

| Component | Retention |
|---|---:|
| Prometheus | 15 days |
| Loki | 168 hours |
| Tempo | 168 hours (7 days) |

Explain that these are time-based retention settings, not a guarantee of a maximum disk size.

List the persistent volumes and what they hold:
- `prom-data`;
- `loki-data`;
- `tempo-data`;
- `grafana-data`;
- `alloy-data` (log collection positions, not the collected logs themselves).

State explicitly:
- there are no regular backups of production telemetry data;
- telemetry data and Grafana state can be lost if their volumes are removed;
- `down -v` is destructive;
- the application PostgreSQL backup process is separate and does not back up observability data;
- container JSON logs have no configured rotation and can grow independently of telemetry retention;
- the stack's image versions can also accumulate on disk because the application deploy process does not manage observability images.

Do not imply that telemetry data can be restored from a backup.

### 4.11 Troubleshooting and recovery

Create a practical troubleshooting section organised by observable symptoms.

At minimum, cover:
- a service that is unhealthy or repeatedly restarting;
- Grafana unavailable or login rejected;
- missing metrics, traces or logs;
- Prometheus target down;
- Alloy unable to discover containers or read logs;
- Docker socket proxy unavailable;
- permission errors caused by volume ownership;
- low disk space or resource pressure.

Use existing technical explanations in `OBSERVABILITY.md` and `DEFERRED_WORK.md`.

Important constraints:
- S3.3b, Alloy starting while the socket proxy is down, remains deferred and untested.
- The controlled proxy outage test does not prove recovery from every daemon restart or reboot scenario.
- A manually stopped socket proxy stays stopped; `restart: unless-stopped` does not automatically restart a container that was deliberately stopped with `docker stop`.
- Do not describe deferred behaviour as solved.
- Do not instruct the operator to run ownership migrations on production volumes without a separate, justified procedure.
- Distinguish known benign startup warnings from errors that indicate unavailable functionality.

Troubleshooting should prefer targeted inspection and recovery over blanket restarts.

### 4.12 Security and telemetry data

Explain the actual production security boundaries and limitations.

The guide must cover:
- Grafana as the only published host endpoint;
- SSH tunnel access;
- the Docker socket proxy as the only service mounting the Docker socket;
- the fact that Docker access is effectively root-equivalent;
- the fact that Alloy can inspect environment variables and logs of every container through the Docker API proxy;
- the fact that the `observability.logs=true` label filter is not a security boundary of the Docker API;
- the fact that members of the host's `docker` group can access Docker data;
- the sensitive information that can appear in collected telemetry.

Explicitly mention:
- nginx access logs include client IP addresses;
- server spans can include `client.address` and `user_agent.original`;
- application secrets currently passed through container environment variables remain accessible to Alloy through container inspection (S3 remains deferred).

Also state that `cap_drop: [ALL]` and `no-new-privileges` for Tempo, Prometheus, Loki and Grafana remain deferred under B7.

Do not overstate the security guarantees provided by the port policy or the socket proxy.

### 4.13 What is monitored, and what is not

Explain the boundaries between S6 and S7.

**After S6:**
- the observability containers are running;
- Grafana is available through the SSH tunnel;
- stack-level diagnostics and internal telemetry are available as supported by the current configuration;
- the application has not yet been integrated merely because the stack is running.

**After S7:**
- the backend's traces are connected to Tempo;
- backend metrics are scraped by Prometheus;
- application logs are collected by Alloy according to the configured labels;
- the frontend's logs are included if the S7 application integration confirms that configuration.

Verify these statements against the actual Compose files and application configuration before documenting them.

The guide must explicitly state the current alerting and notification capabilities. Do not imply that Grafana dashboards or Prometheus metrics automatically notify the operator. Do not implement alerting in S5.

## 5. Documentation style

The guide should:
- be written in English, consistent with existing repository documentation;
- favour task-oriented procedures over repeated architecture explanations;
- show the exact production commands, with placeholders clearly marked;
- distinguish commands executed on the VPS from commands executed locally;
- clearly mark destructive operations;
- link to the existing technical documentation rather than duplicating long explanations;
- avoid claims about VPS behaviour that have not yet been verified.

Keep it useful as an operator reference, not as a second design contract or a full copy of `OBSERVABILITY.md`.

## 6. Implementation plan

Work in small, reviewable steps.

### S5.1 — Repository fact audit

Inspect the current Compose files, scripts and documentation relevant to every procedure.

Produce a short report containing:
- the facts required for the guide;
- the exact commands and paths verified in the repository;
- any discrepancies between documentation and implementation;
- any assumptions that must remain marked for S6.

Do not modify implementation files.

### S5.2 — Production guide

Create `docs/OBSERVABILITY_PRODUCTION.md` with the agreed structure.

Use the S5.1 findings. Do not silently resolve new architectural decisions or extend the scope.

### S5.3 — Operational and documentation review

Review the complete guide against:
- `docs/S4b_DESIGN_CONTRACT.md`;
- `docs/OBSERVABILITY.md`;
- `docs/VPS_RESOURCE_BUDGET.md`;
- `docs/DEFERRED_WORK.md`;
- the relevant Compose and script implementations.

Check all commands, paths, retention values, secret requirements, Compose file combinations and cross-references.

Add a short link to the guide from `docs/OBSERVABILITY.md`.

### S5.4 — Close-out

Update the S5 status in the contract with:
- files changed;
- verification performed;
- any remaining S6 prerequisites or unverified assumptions;
- explicit confirmation that no VPS operation or deployment was performed.

Do not modify unrelated documentation.

## 7. Acceptance criteria

S5 is complete when:

1. `docs/OBSERVABILITY_PRODUCTION.md` exists and covers all 13 required areas.
2. Its architecture and procedures match the accepted S4b decisions and current implementation.
3. Every production Compose command uses exactly the base file and production overlay.
4. No production procedure uses `compose.test.yaml`.
5. No guide instruction requires publishing another production host port.
6. Grafana access and password rotation are documented correctly.
7. Secret handling does not expose passwords through shell history, command arguments, process diagnostics or logs.
8. The retention periods, volume behaviour and absence of telemetry backups are stated accurately.
9. The guide distinguishes S6 from S7 and does not claim that application telemetry is already available.
10. Deferred work remains explicitly deferred.
11. The VPS resource checks and production runtime check are described with their actual limitations.
12. All Markdown links and command examples are reviewed.
13. `docs/OBSERVABILITY.md` contains only a concise cross-reference to the new operator guide.
14. No application, Compose, script, CI or deployment workflow changes are introduced.
15. No VPS operation or deployment is performed.

**S5 does not authorize S6 or S7.** Each remains a separate stage with its own design, acceptance criteria and explicit operator approval.

## 8. Stage results and close-out

### 8.1 S5.1 — Repository fact audit

Completed on 2026-11-15. The audit was read-only and changed nothing in the repository. Its report
is not part of the repository.

It inspected the Compose files, scripts and documentation behind each procedure. It found four
discrepancies between the documentation and the implementation:

| ID | Discrepancy | Where |
|---|---|---|
| C1 | The smoke test's header says that CI runs it after a base-file-only `docker compose -f observability/compose.yaml up -d --wait`. CI starts the stack with three Compose files | `scripts/observability-smoke-test.sh`, header |
| C2 | The repair hints that the smoke test and the proxy outage check print use only the base Compose file | `scripts/observability-smoke-test.sh`, `scripts/observability-proxy-resilience-check.sh` |
| C3 | An outdated statement that `.gitignore` does not cover `observability/secrets/`. S4b.2 added that entry | `docs/S4b_DESIGN_CONTRACT.md`, §3.2 |
| C4 | The list of changes that run CI's `observability` job is incomplete compared with the path filter in `.github/workflows/ci.yml` | `docs/OBSERVABILITY.md`, Verify |

C1 to C4 were deliberately not fixed in S5, and they remain open:
- none of them prevents the production guide from being accurate;
- fixing them would expand the agreed scope (§3).

For C2, the guide warns not to reuse those repair hints on the VPS (its Conventions section).

S5.1 left four operator decisions open: Q1, Q3, Q9 and Q11. The operator settled them before S5.2
(§8.2).

### 8.2 S5.2 — Production guide

Completed and merged in PR #125:
- squash merge `9d42d45a4264baa96cf0f3ff48700f43b1d655ec`;
- final PR commit before the merge: `64a1db8cfacac33b407dd8bb213f40d9bbc72b00`.

`docs/OBSERVABILITY_PRODUCTION.md` is the operator guide for the stack on the VPS. It covers how to
deliver the stack, reach Grafana, and inspect, update and troubleshoot the stack, and what the
stack does and does not cover. It complements `docs/OBSERVABILITY.md` and links to it instead of
repeating it.
- Facts about the VPS that S5 could not confirm are marked **Verify at S6**. They are collected in
  the guide's "Open items for S6 and later" table.
- The Grafana password rotation is a candidate procedure marked **Not validated**.

S5.2 also added a one-sentence cross-reference to the guide at the top of `docs/OBSERVABILITY.md`.

The guide documents manual delivery:
- a `git archive` of `observability/` and `scripts/observability-prod-check.sh`, from an explicit
  commit SHA;
- extracted into `/var/nimuairy-observability`;
- with a `REVISION` marker.

S5 introduced no automated deployment workflow.

The operator decisions from S5.1, as applied:
- **Q1, delivery:** the archive above, built from a verified SHA.
- **Q3, account:** `deploy` owns and operates `/var/nimuairy-observability`.
- **Q9, tunnel:** Grafana is reached through `ssh -N -o ExitOnForwardFailure=yes` on local port
  `13000`. A PuTTY equivalent is given.
- **Q11, resources:** general read-only checks only. The verification of the stack's resources
  belongs to S6.

No VPS operation was performed.

### 8.3 S5.3 — Operational and documentation review

Completed on 2026-11-15. It was an independent review of the guide against:
- `docs/S4b_DESIGN_CONTRACT.md`;
- `docs/OBSERVABILITY.md`;
- `docs/VPS_RESOURCE_BUDGET.md`;
- `docs/DEFERRED_WORK.md`;
- the Compose files in `observability/`, the observability scripts in `scripts/` and
  `.github/workflows/ci.yml`.

**Outcome:** no architectural or operational blocker, and one wording correction.

**Correction.** The guide's "Build the archive" section said that a failed check prints `STOP` and
runs no `git archive`.
- That holds for the four checks before the archive:
  - the SHA format;
  - `git fetch origin`;
  - the commit lookup;
  - the ancestry on `origin/master`.
- It does not hold when `git archive` itself fails, or when the commit ID comparison after it
  fails.

The section now separates the three cases:
- a failed check runs no `git archive`;
- a failed `git archive` may leave a partial or empty file, to be deleted;
- a commit ID mismatch leaves an archive, to be deleted.

No failure produces a usable archive, and only the `OK` line marks success. The correction was
made together with this close-out. The shell block is unchanged.

S5.4's verification found a second inaccuracy in the same section, in its listing check. It is
corrected too (§8.4).

**Verified results.** They come from the S5.2 verification: PR #125's description and the test
runs behind it. S5.4 re-ran the Compose, shell syntax and link checks on the final text (§8.4).
- **Compose.**
  - All 18 occurrences of `docker compose` in the guide pass exactly
    `observability/compose.yaml` and then `observability/compose.prod.yaml`.
  - The count covers code blocks, inline code and tables, including the template under
    Conventions.
  - None of them uses `observability/compose.test.yaml`, `-p` or `COMPOSE_PROJECT_NAME`.
- **Shell syntax.** All 26 `bash` code blocks pass `bash -n`, with the placeholders substituted.
- **Archive build.** The block was tested in an isolated Git setup with a local bare origin:
  - failing checks: each ended with a non-zero status and no archive;
  - a commit on `origin/master`: the block ended with status 0, and the stored commit ID
    matched.
- **Extraction and `REVISION`, and the Grafana secret check.** Each block was tested verbatim, with
  and without `set -e`.
- **Links**, from PR #125's verification.
  - 140 relative links were checked, and 0 failed. A control that contained a broken link failed
    as expected.
  - The checker counts every Markdown link outside a code block whose target is not a URL, once per
    occurrence: 67 in the guide and 73 in `docs/OBSERVABILITY.md`.
  - It checks that the file exists and, for an anchor, that a matching GitHub heading slug exists.

**Sequencing deviation.** §6 places the cross-reference in `docs/OBSERVABILITY.md` in S5.3. It was
added in S5.2 instead, in PR #125. S5.3 reviewed it and added no further link.

### 8.4 S5.4 — Close-out

S5.1, S5.2 and S5.3 are complete. S5.4 records them, in the status and in this section. It also
makes the S5.3 correction and a second one that its own verification found.

**Second correction: the listing check.** The guide said that `tar -tf` must list only
`observability/…` and `scripts/observability-prod-check.sh`. The archive also holds the directory
entry `scripts/`. `git archive` of the merge commit `9d42d45a4264baa96cf0f3ff48700f43b1d655ec`
lists 18 entries:
- the directory `observability/`, with 7 directories and 8 files under it;
- `scripts/`;
- `scripts/observability-prod-check.sh`.

An operator following the old wording strictly would have stopped on a valid archive. The check
now allows those entries and no other path, and it names `scripts/observability-prod-check.sh` as
the only file under `scripts/`. The shell block is unchanged.

**Files changed across S5:**
- `docs/OBSERVABILITY_PRODUCTION.md`: new in S5.2; its archive explanation and listing check
  corrected in S5.4;
- `docs/OBSERVABILITY.md`: the cross-reference, in S5.2;
- `docs/S5_DESIGN_CONTRACT.md`: this close-out.

No Compose file, script, application code or CI workflow changed in S5, and neither did
`README.md` or `docs/VPS_FIREWALL.md`.

**Verification in S5.4**, local only, without Docker, SSH or the VPS:
- **The archive explanation.** The block from the guide ran verbatim in an isolated Git setup.
  - First with a commit that passes the four checks but lacks
    `scripts/observability-prod-check.sh`. `git archive` failed. The block printed
    `STOP: git archive failed…`, ended with status 1 and left an empty archive file (0 bytes).
  - Then with the script added. The block printed `OK`, ended with status 0 and listed the
    archive and its checksum. The stored commit ID matched.
  - The commit ID mismatch was not exercised.
- **The listing check.** The corrected rule was applied to the `tar -tf` output of the
  `9d42d45` archive and passed for all 18 entries. Three controls failed it, as expected:
  - an extra `scripts/other.sh`;
  - an extra `README.md`;
  - the listing without `scripts/`.
- **Links.** The same checker ran on the guide, `docs/OBSERVABILITY.md` and this contract: 140
  checked, 0 failed. This contract has no links. The broken-link control failed as expected. The
  headings added here have unique anchors.
- **Shell syntax.** The 26 `bash` blocks pass `bash -n` again. A control with a syntax error fails.
- **Compose.** The 18 occurrences are unchanged.
- **Diff.** The S5.4 change touches only `docs/OBSERVABILITY_PRODUCTION.md` and this contract.
  `git diff --check` reports nothing.
- **SHAs.** The PR #125 merge and head commits above match GitHub's merge record
  (`gh pr view 125`).

**Remaining S6 prerequisites and unverified assumptions.** The guide's "Open items for S6 and
later" table remains the operator's list. It includes:
- the Compose render on the VPS, which must publish only Grafana's port, and the
  `DOCKER_SOCKET_GID` in `observability/.env`;
- `deploy`'s ownership of `/var/nimuairy-observability`, its Docker access, its shell (Bash), and
  the modes that extraction leaves;
- the account that copies the archive to `deploy`'s home;
- the Grafana secret:
  - its owner and mode;
  - whether UID 472 can read it through the bind mount;
  - the LXC mapping of UIDs 472, 473 and 10001;
  - the production check's access to the file;
- before the first start: no existing `nimuairy-observability_*` volumes, and no host listener on
  `127.0.0.1:3000` or on the removed ports;
- SSH forwarding for the tunnel account, and the Alloy UI tunnel to a container address;
- the tools and permissions the production checks need:
  - `bash`, `docker`, `curl`, `timeout` and `od` for the production check, with the operator's
    consent per run;
  - `sudo` for the optional container-log size check;
- the Grafana password reset with `grafana cli admin reset-admin-password --password-from-stdin`,
  still **Not validated**;
- Grafana's failed-login threshold and lockout time, not determined;
- Docker's JSON log rotation, and the disk growth of logs, volumes and images;
- the stack's real resource consumption and limits on the VPS;
- whether a restart picks up a bind-mounted configuration file that extraction replaced;
- no untrusted users or services on the host (U8), and a public IPv6 address and its firewall
  (U12).

**Remaining S7 work**, the application integration:
- a production variant of the application's observability overlay;
- a change to the application's deployment;
- a backend image that contains the OpenTelemetry agent;
- the address that nginx logs behind the Cloudflare Tunnel, and the application's telemetry in
  general.

**Still deferred** (`docs/DEFERRED_WORK.md`):
- S3: the application's secrets in container environment variables;
- S3.3b: Alloy starting while the socket proxy is down;
- B7: `cap_drop` and `no-new-privileges` for Prometheus, Loki, Tempo and Grafana.

**No VPS operation, deployment or application integration was performed during S5.** The stack is
still not deployed to the VPS, and the application is not connected to it.

**S5 does not authorize S6 or S7.** Neither has started. Each remains a separate stage with its own
design, acceptance criteria and explicit operator approval.
