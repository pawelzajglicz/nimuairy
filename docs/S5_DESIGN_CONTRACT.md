# S5 Design Contract — Production Observability Operations Guide

**Status:** Accepted by the operator on 2026-11-15; S5.1 not started  
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
- The VPS kernel does not expose all peak counters used by the local resource checks.
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
