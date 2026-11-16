# S6 Design Contract — First production deployment of the observability stack

**Status, 2026-11-16: draft for review (revision 5). Nothing in it has been run on the VPS.**
- S6 is the first start of the six-service stack on the VPS. S7, which connects the application to
  the stack, is a separate stage with its own design and approval.
- **This contract authorizes no VPS operation.** Every operation it describes needs the operator's
  consent at the point §4 names. Accepting or merging the contract is not such a consent.
- No S6 step has started. Nothing has been delivered to the VPS, created there or started there,
  and no VPS command has been run for S6.
- The operator decisions D1 to D7 (§13.3) are open.

**Base:** `master` at `4877a75b4c9985752d16bdd9150658498fac5686`

Revisions:
- **1** (2026-11-15): the draft for review.
- **2** (2026-11-15), the review corrections of PR #129:
  - the sampler fails closed: it writes a sample only when every required value was read and is a
    number, and marks any other sample `INVALID`. The readout is a file of its own, rejects every
    incomplete or malformed record, and checks each entity's coverage. A missing log, a stopped
    sampler or an incomplete window is INCONCLUSIVE, never PASS (§10.3);
  - the readout uses POSIX awk only, and a self-test with pinned output runs on the VPS before any
    of its results count. P10 records the VPS's awk (§6, §10.3);
  - G13, a pre-start resource gate, runs before the pull and the first `up`. Its thresholds are
    part of D3 (§8, §13.3);
  - G12: cgroup v2 with Docker's `systemd` driver is a pre-start requirement, because R1 and the
    sampler depend on it (§8);
  - P7 and G6 cover the scheduled work and the privileged accounts in full, and say what the
    operator reviews and what counts as PASS, INCONCLUSIVE and STOP (§6, §8);
  - V11 compares the real, effective, saved and file-system IDs, and the supplementary groups
    (§10.1).
- **3** (2026-11-15), the second review of PR #129:
  - an executable order without a circular dependency: G1 to G10 and G12 pass, D3 and D4 are
    decided, C5 is given, the sampler starts, G11 completes with it running, then G13 (§4.1);
  - the pull and the first `up` have separate consents, C3a and C3b. G13 is evaluated twice:
    G13a before the pull, and G13b after it, on samples that include the pull and on the pull's own
    memory stall (R-p). C3b is given only after G13b passes, and lapses if the `up` does not follow
    within 15 min (§4, §8, §9);
  - G6's inventory shows every queued `at` job's script, every SSH key by its fingerprint with its
    options, from the effective `AuthorizedKeysFile` per account, any `AuthorizedKeysCommand`,
    principals or certificate authority, and the user-level services and timers of every user
    manager. Each listing says whether its source is absent, empty or unreadable (§6, §8);
  - the readout requires the exact expected entity set (`-v expect`); a missing, duplicated or
    unexpected entity is INCONCLUSIVE. The readout wrapper checks the sampler before and after the
    readout. The sampler refuses a container named twice (§10.3);
  - P9 evaluates `sshd -T -C` with the session's real connection context, and lists the `Match`
    and `Include` lines that the context may not represent (§6).
- **4** (2026-11-16), the third review of PR #129:
  - P7a's enumeration fails closed (§6):
    - `getent passwd` is read once and checked. A failed enumeration, or one without a UID 0
      account, is `UNREAD`, and no account's keys are listed as complete.
    - `getent group` tells a missing group (exit status 2, `absent`) from a failed lookup
      (`UNREAD`). Revision 5 corrects this: exit status 2 alone is no proof.
    - `passwd -S -a` must list `root`.
    - `keys_of` no longer reads a failed `sudo` as a missing key file.
    - P9 tells a missing account from a failed lookup;
  - the blocks that expand the Grafana password turn Bash's xtrace off first: §7.5's creation and
    V7's data source health. §10.2 starts the production check without `SHELLOPTS` and
    `BASH_ENV`, through which a child Bash could start with xtrace on (§7.5, §10.1, §10.2);
  - the readout wrapper reads a stable snapshot, the log's first bytes as `stat` counts them, and
    takes the reading time after it. A line appended during the readout is not read, and a
    snapshot that ends inside a record is INCONCLUSIVE (§10.3).
- **5** (2026-11-16), a review note on revision 4:
  - `getent`'s exit status 2 is no proof that an account or a group is missing. glibc's `getent`
    exits 2 whenever no entry was returned, also when a source failed, and 0 after any enumeration.
    A new helper, `nss_sources`, accepts NSS's sources only if accounts and groups come from
    `/etc/passwd` and `/etc/group`, then at most from nss-systemd without records of its own
    beyond dynamic users, and nscd does not run. `absent:` now needs that, and a direct read of
    the file; anything else is `UNREAD` (§5, §6);
  - P7a's account list is complete only if it also holds every entry of `/etc/passwd`, read
    directly, and `nss_sources` accepted the sources. An nss-systemd drop-in account was missing
    from `getent passwd`'s list, and a drop-in membership from `getent group` [LOCAL, systemd 259]
    (§6, G6);
  - P7a lists, for each privileged group, the accounts whose primary group it is, which
    `getent group` does not list (§6, G6).

## 1. Purpose and scope

S6 brings the stack in `observability/` to the VPS and starts it there for the first time:
1. a read-only preflight of the VPS (S6.1);
2. the delivery of the files and the host-specific configuration (S6.2);
3. the gates that must pass before the first start (S6.3);
4. the first start, with exactly the two production Compose files (S6.4);
5. the verification of the running stack, including its idle resource use next to the application
   (S6.5);
6. recovery guidance and STOP conditions (S6.6);
7. after a successful deployment, the documents that S6 makes stale (S6.7).

S6 runs only the configuration that S4b produced and S5 documented. It adds no port, network,
resource limit or service, changes no Compose file, script, CI workflow or application file, and
implements no deferred work (§16).

Evidence labels as in [S4b_DESIGN_CONTRACT.md](S4b_DESIGN_CONTRACT.md#1-purpose-and-scope): VPS,
LOCAL, USER-REPORTED, ESTIMATE, UNKNOWN, CONFIG (read in this repository), S (read in upstream
source), PLAN (the operator's planning notes, kept outside the repository) and CI. `[inference]`
marks a conclusion that nothing has shown directly.

| Stage | What it does | Changes on the VPS | Consent (§4) |
|---|---|---|---|
| S6.1 | Reads the VPS's current state | Nothing | C1 |
| S6.2 | Creates the directory, delivers the archive, writes `observability/.env` and the Grafana secret | Files only | C2 |
| S6.3 | Pre-start gates G1 to G13, in the order of §4.1; G11 and G13 read the pre-start sampler | The sampler and readout files and the sampler's log in `deploy`'s home | C5 for the sampler; the gates only read |
| S6.4 | Pulls the six images; after G13b, runs the first `up` | Images; then networks, volumes, containers | C3a for the pull, C3b for the `up` |
| S6.5 | Verifies the stack; one run of the production check; an idle sampling window | The sampler's log; one failed Grafana login | C4, C5 |
| S6.6 | Recovery | Only what each action names | Per action |
| S6.7 | Documentation close-out | Nothing (repository only) | Normal review |

## 2. Sources and current state

### 2.1 Sources read for this contract

| Source | Used for |
|---|---|
| [S4b_DESIGN_CONTRACT.md](S4b_DESIGN_CONTRACT.md) §§4.4, 6.3–6.7, 7.3, 8.4, 12.1, 12.3, 13 | The production properties, the secret's handling, the volume rules, the production check, U1 to U13, what S6 needs |
| [S5_DESIGN_CONTRACT.md](S5_DESIGN_CONTRACT.md) §8 | S5's results and the remaining S6 prerequisites |
| [OBSERVABILITY_PRODUCTION.md](OBSERVABILITY_PRODUCTION.md) | The operator procedures S6 reuses, its "Verify at S6" items and its open-items table |
| [OBSERVABILITY.md](OBSERVABILITY.md) | Networks, Docker API access, resource limits, the checks |
| [VPS_RESOURCE_BUDGET.md](VPS_RESOURCE_BUDGET.md) | T, the budget model, the limits, the reserve, the post-upgrade readings |
| [S4.4_DESIGN_CONTRACT.md](S4.4_DESIGN_CONTRACT.md) §8, §10.4, §13, Appendix A.3 | The VPS verification method for limits and OOM counters, which §10.3 adapts |
| [VPS_FIREWALL.md](VPS_FIREWALL.md), [DEFERRED_WORK.md](DEFERRED_WORK.md), [README.md](../README.md) | Firewall policy, deferred items, the application's deployment and backups |
| `observability/compose.yaml`, `compose.prod.yaml`, `compose.test.yaml` | What the production render contains |
| `scripts/observability-prod-check.sh`, `scripts/observability-limits-check.sh` | What each check needs, and where it may run |
| `.github/workflows/ci.yml`, `deploy-on-vps.yml`, `.gitignore` | CI's phase B, the secret file in CI, what the application deploy touches |

### 2.2 Repository state [CONFIG, CI]

- `master` = `origin/master` = `4877a75`. CI on that push succeeded (run 43741821811).
- The two archived paths, `observability/` and `scripts/observability-prod-check.sh`, last changed
  in `ff0139a` (S4b.4, #122). CI run #348 (43713463685) ran phase B on exactly these files: a
  recreate from `compose.yaml` + `compose.prod.yaml`, then `prod-check runtime`, `limits-check
  runtime` and `prod-check verify`.
- Open Dependabot PRs bump four of the stack's images and the application's tunnel:
  #104 Tempo 3.1.1, #105 Alloy v1.21.2, #107 Prometheus v3.15.1, #108 Loki 3.7.9, #103 cloudflared
  2026.10.3. None is merged. D4 (§13.3) proposes holding them until S6 closes.
- No S6 contract or plan existed before this one.

### 2.3 VPS facts measured earlier

**None of these is assumed to be current.** S6.1 reads each one again, and the new reading
replaces the old one for every S6 decision.

| Fact | Last reading | Source |
|---|---|---|
| OS and isolation | Ubuntu 24.04.5 LTS in an unprivileged LXC container [VPS, 2026-11-10] | [Budget, Before the upgrade](VPS_RESOURCE_BUDGET.md#before-the-upgrade) |
| Kernel | `5.15.158-2-pve`, the provider's; it changed once with the upgrade, for a reason not determined [VPS, 2026-11-12] | [S4.4 §13, Rollout record](S4.4_DESIGN_CONTRACT.md#13-app-rollout-and-rollback-h11-option-b1) |
| Docker Engine, Compose, runc | Engine 29.8.2; Compose `v5.6.0`; runc `v1.5.1-0-g8f2685a4` [VPS, 2026-11-12] | S4.4 §11, §13 |
| systemd | `255.4-1ubuntu8.18` [VPS] | [S4.4 §8](S4.4_DESIGN_CONTRACT.md#8-oom-behaviour-and-oom_score_adj-h2) |
| cgroup | v2 with the `systemd` driver; `memory.events.local` present; no `memory_localevents` mount option; no `memory.peak` or `pids.peak` [VPS] | [S4.4 §10.4](S4.4_DESIGN_CONTRACT.md#104-vps-the-operator-runs-these-read-only) |
| `memory.stat` fields | The filtered output had no `kernel` field; the full list was not read [VPS] | [Budget, Outstanding verification](VPS_RESOURCE_BUDGET.md#outstanding-verification) |
| Memory | `MemTotal` 4352 MiB from LXCFS; root `memory.max=max`; T = 4352 MiB is an inference, its enforcement [UNKNOWN]; `MemAvailable` 3384 MiB before the app rollout | [Budget, After the upgrade](VPS_RESOURCE_BUDGET.md#after-the-upgrade) |
| CPU | One CPU; `cpu.max max 100000` at the root; `nr_throttled` 0 | the same |
| Swap | `SwapTotal` 0, but `/proc/swaps` lists `none virtual 4G`; the host side [UNKNOWN] | the same |
| Disk | 45 GB, 40 GiB available [VPS, 2026-11-12] | the same; S4.4 §13 |
| Container logs | `json-file`, no rotation options in `/etc/docker/daemon.json` [VPS, 2026-11-10] | [Budget, Risks](VPS_RESOURCE_BUDGET.md#risks) |
| App limits | Applied by hand on 2026-11-12; 35 h of sampling without a memory or PID event; four app containers with `memory.oom.group` 0, `Delegate=yes`, `OOMPolicy=continue` [VPS] | [Budget, With the app's limits](VPS_RESOURCE_BUDGET.md#with-the-apps-limits-s444) |
| The stack on the VPS | Never started. Whether `nimuairy-observability_*` volumes exist was left unconfirmed by P0 [PLAN] | [S4b §7.3](S4b_DESIGN_CONTRACT.md#73-volumes) |
| `jq` on the VPS | Not guaranteed | [S4b §12.3](S4b_DESIGN_CONTRACT.md#123-dependencies-for-s6-and-s7) |
| `awk` on the VPS | Never recorded. Ubuntu's default is mawk; which implementation and version the VPS runs is [UNKNOWN] until P10 | — |
| UFW | Configured by `scripts/configure-ufw.sh`, which requires `IPV6=yes` [CONFIG]; its current state was not read for S6 | [VPS_FIREWALL.md](VPS_FIREWALL.md#policy) |

### 2.4 Implementation facts S6 relies on [CONFIG]

- **The production render** (`observability/compose.yaml` + `observability/compose.prod.yaml`):
  - six services with fixed container names: `prometheus`, `loki`, `tempo`, `alloy`,
    `docker-socket-proxy`, `grafana`;
  - one host port, `127.0.0.1:3000` for Grafana; the overlay removes the others with
    `ports: !reset []`;
  - three networks: `nimuairy-observability`, `nimuairy-observability_stack` and the internal
    `nimuairy-observability_docker-api`;
  - five named volumes, `nimuairy-observability_{prom,loki,tempo,grafana,alloy}-data`;
  - users set in the base file: Tempo `10001:10001`, Alloy `473:473`, the proxy
    `65534:${DOCKER_SOCKET_GID:-0}`; the images' own users for Prometheus (`nobody`), Loki (10001)
    and Grafana (472) [LOCAL, S4b Appendix A];
  - health checks only on Prometheus, Grafana and the proxy;
  - Grafana's start guard and its file secret `./secrets/grafana_admin_password`, mounted at
    `/run/secrets/grafana_admin_password`.
- **`DOCKER_SOCKET_GID` defaults to `0`.** Without `observability/.env` the render still succeeds,
  with the proxy as `65534:0`, and the proxy then fails closed on a Linux socket owned by the
  `docker` group. So a successful render alone does not show that `.env` was read; G4 checks the
  value.
- **`observability-prod-check.sh runtime`** needs [CONFIG, the script]:
  - `bash`, `docker`, `curl`, `timeout` and `od`; `ss` only for an `info` line;
  - the working directory `/var/nimuairy-observability`, because it renders
    `observability/compose.yaml` and `observability/compose.prod.yaml` by relative path;
  - `GRAFANA_AUTH` and `OBSERVABILITY_COMPOSE_FILES` unset. It then reads
    `observability/secrets/grafana_admin_password` and stops with `FATAL` unless the running
    account can read it as a regular file (`load_credentials`);
  - exactly one running container for each of the six services, and nothing listening on
    `127.0.0.1` 9090, 3100, 3200, 4317, 4318 or 12345.
- **`observability-limits-check.sh runtime` cannot run on the VPS.** It needs `jq`, and its probe
  reads `memory.peak` and `pids.peak`, which the VPS's kernel lacks, and fails on an unreadable
  file. §10.3 adapts S4.4's read-only method instead.
- **CI writes the secret with mode 0644** into an `observability/secrets/` directory that
  `mkdir -p` creates with the runner's default mode. CI therefore never ran the secret in a 0700
  directory (§7.5).
- **The application deploy never touches the stack.** `deploy-on-vps.yml` copies the
  application's two Compose files and its backup script to `/var/nimuairy`, and its image prune
  matches only images labelled as built from this repository.

## 3. Decisions this contract builds on

These are accepted and are not reopened here.

| Decision | Source | Effect on S6 |
|---|---|---|
| S4.4 H1: every VPS command that creates or recreates the stack's containers passes exactly `observability/compose.yaml` and `observability/compose.prod.yaml` | [S4.4 §3](S4.4_DESIGN_CONTRACT.md#3-layout-h1) | §9; never `compose.test.yaml`, `-p` or `COMPOSE_PROJECT_NAME` |
| S4.4: the resource values; no CPU limits or weights | [Budget, Container limits](VPS_RESOURCE_BUDGET.md#container-limits) | S6 measures them and changes none |
| B2, B3: the file secret, read through `GF_SECURITY_ADMIN_PASSWORD__FILE`, and the start guard | [S4b §13.1](S4b_DESIGN_CONTRACT.md#131-accepted-by-the-operator-2026-11-14) | §7.5; only the file's owner and mode are S6's to decide (D1) |
| B4, B5: Tempo runs as `10001:10001`, set in the base file | the same | G1, V12 |
| B6: the migration without a backup covers development volumes only | the same | An existing production `tempo-data` is a STOP, not a migration (G1) |
| B7: capability drops for Tempo, Prometheus, Loki and Grafana stay deferred | the same | Not in S6 |
| B8: `prod-check runtime` is part of S6's procedure, each run with consent | the same | V6, C4 |
| S5 Q1: delivery by a `git archive` of two paths from a verified SHA, with a `REVISION` marker | [S5 §8.2](S5_DESIGN_CONTRACT.md#82-s52--production-guide) | §7.3 |
| S5 Q3: `deploy` owns and operates `/var/nimuairy-observability` | the same | §7.2 |
| S5 Q9: Grafana through `ssh -N -o ExitOnForwardFailure=yes` on local port 13000 | the same | V7 |
| S5 Q11: the stack's resource verification belongs to S6 | the same | §10.3 |
| Q5 of the rollout: the operator runs every VPS command; S6 and S7 each need separate approval | [S4b §3.1](S4b_DESIGN_CONTRACT.md#31-decisions-this-contract-builds-on), PLAN | §4 |
| No regular backups of telemetry data; no deployment workflow for the stack | [S4b §14](S4b_DESIGN_CONTRACT.md#14-out-of-scope) | S6 adds neither |
| S2 D3: the `nimuairy-observability` network's definition stays unchanged | [OBSERVABILITY.md, Networks](OBSERVABILITY.md#networks) | Not touched |

## 4. Approval boundaries

- **Nothing in this contract authorizes a VPS operation.** That includes the read-only ones: the
  operator runs every VPS command, and the agent never connects to the VPS.
- **The consents**, each given by the operator for that step, at that time, in this order:

  | Consent | Covers | Requires first |
  |---|---|---|
  | C1 | The read-only preflight of S6.1 | This contract accepted |
  | C2 | Creating or changing files on the VPS in S6.2: `/var/nimuairy-observability`, the archive in `deploy`'s home, its extraction, `REVISION`, `observability/.env`, `observability/secrets/` | S6.1 recorded with no open STOP; D1 and D2 decided |
  | C5 | The sampling of §10.3: saving `~/s6-sampler.sh` and `~/s6-readout.awk` in `deploy`'s home, the readout's self-test, and running the sampler in the background, first before the start (G11, G13) and then for the window, with its logs in that home | G1 to G10 and G12 passed, with G9 resolved by D7 where G9 asked for it; D3 and D4 decided. C5 does not depend on G11 or G13: they depend on it |
  | C3a | The image `pull` of S6.4, step 4, and nothing else | G11 passed; then, immediately before the pull, G1 to G3 repeated and G13a passed |
  | C3b | The **first `docker compose up`** of S6.4, step 6 | The pull done with its readings, and G13b passed, R-p included. It is given only after G13b, for an `up` that starts within 15 min of G13b's reading; otherwise it lapses, and G13b runs again before a new C3b. Neither C3a nor any earlier statement stands in for it |
  | C4 | **One** run of `scripts/observability-prod-check.sh runtime` (V6) | V1 to V5 passed |

- **Every recovery action that changes state** (§11) needs its own consent, even when this
  contract names it.
- **Anything that could delete or migrate existing data** needs a separate design and a separate
  approval. S6 contains no such operation: no `down -v`, no `docker volume rm`, no broad prune, no
  ownership change of a volume.
- **A failed or inconclusive gate blocks the consent that follows it** until it is resolved
  explicitly and the resolution is recorded.
- **S6 does not authorize S7.** It connects nothing to the stack and changes nothing in the
  application.
- **Read-only checks** need no consent of their own, but they run only inside an S6 session that
  the operator has started under C1, C2, C5, C3a or C3b.

### 4.1 The order of S6

Each step needs every step above it. No step needs a step below it, so the order has no cycle.

| # | Step | Needs |
|---|---|---|
| 1 | C1, then the preflight P1 to P10 (S6.1) | This contract accepted |
| 2 | D1 and D2 decided, C2, then the delivery and the host configuration (S6.2) | 1 |
| 3 | G1 to G10 and G12 (S6.3), read-only; G9 resolved by D7 where it asks for it | 2 |
| 4 | D3 and D4 decided, then C5 | 3 |
| 5 | Save the sampler and the readout, run the self-test, take R0's first reading, start the pre-start sampler (§10.3) | 4 |
| 6 | G11, with the sampler running: timing, the release freeze, the self-test's result | 5 |
| 7 | At least 30 min of sampling, then G1 to G3 again and G13a | 6 |
| 8 | C3a, then the pull with its pressure readings (S6.4, step 4) | 7 |
| 9 | G13b, on the samples that include the pull and on the pull's own stall (S6.4, step 5) | 8 |
| 10 | C3b, then the first `up` within 15 min of G13b, its readiness and its logs (S6.4, steps 6 to 8) | 9 |
| 11 | V1 to V5; C4; V6; V7 to V16; R1; the window's sampler; R3 and R4 (S6.5) | 10 |
| 12 | The close-out (S6.7), after S6.5's acceptance | 11 |

A step that does not pass stops the order there. Its resolution is recorded before the order goes on,
and a resolution that changes state needs its own consent (§11).

## 5. Conventions

- **Who runs what.** The operator runs every VPS command and sends the output back for review. The
  agent writes no VPS command into a shell.
- **P7's and P9's output is the exception.** Their account, key, address, sudoers, cron, `at` and
  service listings stay with the operator, who reviews them on the VPS. Only G6's conclusion and
  P9's verdict are shared, and an entry the operator wants discussed is shared with its secrets,
  addresses and names removed.
- **The words of P7 and P9.** A line starting `absent:` says that the source does not exist, such
  as an account without an authorized-keys file. For an account or a group, `absent:` also needs
  NSS's sources confirmed (`nss_sources`, P7), because `getent` gives the same answer for a missing
  entry and a failed source. `empty:` says that the source was read and holds
  nothing. `UNREAD:` says that a command failed or a source could not be read, so nothing about it
  is known. `REVIEW:` names something that the listing cannot show on its own, such as keys from an
  `AuthorizedKeysCommand`.
- **Block labels**, as in the guide's
  [Conventions](OBSERVABILITY_PRODUCTION.md#conventions): *VPS, read-only*; *VPS, changes files*;
  *VPS, changes runtime state*; *Local*. A block labelled *admin* runs as an administrative account
  with `sudo` (D2); all others run as `deploy`.
- **The shell.** Bash, interactive, without `set -e`. The blocks report each failure with `STOP` and
  do not rely on errexit.
- **No shell trace around the password.** With `set -x`, Bash prints each command after expansion,
  the password included. The blocks that expand it turn xtrace off themselves (§7.5, V7). §10.2
  keeps the production check's own Bash from inheriting xtrace. Neither protects against a reader
  with root or `ptrace` rights, which can read a process's memory anyway.
- **Every production Compose command names exactly two files, in this order**:
  `docker compose -f observability/compose.yaml -f observability/compose.prod.yaml <command>`, run
  in `/var/nimuairy-observability`. Never `observability/compose.test.yaml`, `-p` or
  `COMPOSE_PROJECT_NAME`.
- **Tracked files on the VPS are never edited by hand.** A change comes through a new archive.
  In `/var/nimuairy-observability`, only `observability/.env` and `observability/secrets/` are
  written on the VPS. The sampling files of C5 live in `deploy`'s home.
- **Never printed, sent or recorded:** the Grafana password; Grafana's `/proc/1/environ`; a full
  `docker inspect` of an application container, which prints its secrets
  ([DEFERRED_WORK, S3](DEFERRED_WORK.md#s3--application-secrets-out-of-container-environment-variables));
  key material from `authorized_keys`.
- **The repository records no VPS host, SSH port, login or IP address**, and S6.7 keeps it so. It
  records facts such as "a public IPv6 address exists", not the address.
- **None of these commands has run on the VPS.** Each block passes `bash -n`. The sampler, the
  readout and a few helpers also ran against simulated input, locally (§10.3), and P7a and P9
  against the real `getent` in a namespace (P7a); nothing else did.
  The first run of each block on the VPS is itself evidence, and its output is reviewed before the
  next step.
- **STOP** means: take no further step of S6, report the output, and resolve the cause explicitly.
  A resolution that changes state needs its own consent.
- **Placeholders** in angle brackets as in the guide: `<sha>`, `<user>`, `<vps-host>`,
  `<ssh-port>`, `<smoke-url>` (the `SMOKE_URL` of the `production` GitHub Environment).

## 6. S6.1 — Read-only VPS preflight

**Goal:** the current facts that every later step depends on, read again. Earlier readings (§2.3)
are context only.

**Consent:** C1. Every block only reads. P4 and P9 contain an optional `sudo` read.

**Output:** the preflight record, one row per fact, with the value read and `ok` or `STOP`
(template at the end of this section).

### P1. System, LXC and identity mapping

**VPS, read-only:**

```bash
date -u
timedatectl 2>/dev/null | grep -F 'Time zone' || cat /etc/timezone
uname -r
grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release
systemd-detect-virt
systemctl --version | head -n 1
for m in uid_map gid_map; do echo "$m: $(tr -s ' ' < "/proc/self/$m" | tr '\n' ';')"; done
```

- `systemd-detect-virt` should print `lxc`.
- The time zone is the one cron's `03:30` backup uses (G11).
- The maps feed G7 (U9).

### P2. Docker

**VPS, read-only:**

```bash
docker version --format 'client={{.Client.Version}} server={{.Server.Version}}'
docker compose version
docker info --format 'cgroup={{.CgroupVersion}}/{{.CgroupDriver}} storage={{.Driver}} logging={{.LoggingDriver}} root={{.DockerRootDir}} liverestore={{.LiveRestoreEnabled}} ncpu={{.NCPU}} memtotal={{.MemTotal}}'
docker info --format 'security={{json .SecurityOptions}} warnings={{json .Warnings}}'
docker info 2>/dev/null | grep -E 'runc version|Kernel Version'
docker context show
cat /etc/docker/daemon.json 2>/dev/null || echo 'no /etc/docker/daemon.json'
```

- **`cgroup=2/systemd` is required.** R1's scope checks and the sampler's cgroup paths assume cgroup
  v2 with Docker's `systemd` driver. Any other value is a STOP, settled by G12.
- `security=` must not list `name=userns`: user-namespace remapping would change which host UIDs
  own the volumes (G7, G12).
- `docker context show` should print `default`, so the commands reach the local engine.
- `daemon.json` shows whether log rotation is configured (D5).

### P3. The application's containers

**VPS, read-only.** Named fields only:

```bash
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
docker inspect -f '{{.Name}} started={{.State.StartedAt}} restarts={{.RestartCount}} oomkilled={{.State.OOMKilled}}{{if .State.Health}} health={{.State.Health.Status}}{{end}} mem={{.HostConfig.Memory}} pids={{.HostConfig.PidsLimit}}' \
  postgres-nimuairy backend-nimuairy frontend-nimuairy cloudflared-nimuairy
```

- Expected: the four application containers, running and healthy where they have a health check,
  with their S4.4 limits, and no other container.
- An unknown container is a question for U8 (G6).

### P4. Memory, CPU, PIDs, disk and cgroup files

**VPS, read-only:** the block of
[VPS_RESOURCE_BUDGET.md, Post-upgrade verification](VPS_RESOURCE_BUDGET.md#post-upgrade-verification),
unchanged. Its last line needs `sudo` and is optional. Then:

```bash
echo "memory.stat fields: $(awk '{ print $1 }' /sys/fs/cgroup/memory.stat | tr '\n' ' ')"
echo "controllers: $(cat /sys/fs/cgroup/cgroup.controllers)"
grep cgroup2 /proc/self/mounts
for f in memory.events memory.events.local pids.events cpu.pressure memory.pressure; do
  echo "root $f: $(cat "/sys/fs/cgroup/$f" 2>&1 | tr '\n' ' ')"
done
cg=/sys/fs/cgroup$(sed -n 's/^0:://p' "/proc/$(docker inspect -f '{{.State.Pid}}' backend-nimuairy)/cgroup")
echo "backend cgroup files: $(ls "$cg" | grep -E '^(memory|pids|cpu)\.' | tr '\n' ' ')"
```

- **The `memory.stat` field list** settles whether this kernel has a `kernel` field. Without it,
  §10.3 computes kernel memory from its parts and marks the result [ESTIMATE].
- **A container cgroup's file list** shows which files §10.3 can read per container.
- `memory.events` and `memory.events.local` at the root and `pids.events` are the starting values
  for the window.

### P5. Stack objects that already exist

**VPS, read-only.** The helper prints `ok` only when the listing itself succeeded and holds no
matching line, so a failed `docker` command cannot pass as "none". G1 and G2 use it again; define
it in each new shell.

```bash
none_of() {
  local what=$1 re=$2 listing found
  shift 2
  if ! listing=$("$@"); then
    echo "STOP: $what: '$*' failed"
  elif found=$(grep -E -- "$re" <<<"$listing"); then
    echo "STOP: $what:"
    sed 's/^/      /' <<<"$found"
  elif [ $? -eq 1 ]; then
    echo "ok:   $what: none"
  else
    echo "STOP: $what: grep failed"
  fi
}
none_of "volumes named nimuairy-observability*" '^nimuairy-observability' docker volume ls --format '{{.Name}}'
none_of "volumes of the project nimuairy-observability" '.' docker volume ls -q --filter label=com.docker.compose.project=nimuairy-observability
none_of "networks named nimuairy-observability*" '^nimuairy-observability' docker network ls --format '{{.Name}}'
none_of "containers with the stack's names" '^(prometheus|loki|tempo|alloy|docker-socket-proxy|grafana)$' docker ps -a --format '{{.Names}}'
none_of "containers of the project nimuairy-observability" '.' docker ps -aq --filter label=com.docker.compose.project=nimuairy-observability
docker image ls --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep -E '^(prom/prometheus|grafana/(loki|tempo|alloy|grafana-oss)|wollomatic/socket-proxy):' || echo 'info: none of the stack images is present'
ls -ld /var/nimuairy-observability 2>&1
```

- **Expected:** five `ok` lines, and `No such file or directory` for the directory.
- The image listing is information only.
- Every `STOP` here is handled by G1 or G2 (§8).

### P6. Listeners on the stack's host ports

**VPS, read-only:**

```bash
ss -Hltn
none_of "TCP listeners on 3000, 9090, 3100, 3200, 4317, 4318 or 12345" \
  '^LISTEN +[0-9]+ +[0-9]+ +[^ ]+:(3000|9090|3100|3200|4317|4318|12345) ' ss -Hltn
```

**Admin, read-only, optional:** `sudo ss -Hltnup` names the process behind each listener, for U8.

- Expected: `ok`. Any listener on these ports, on any address, is a STOP for G3.

### P7. Users and services (U8)

**The output stays with the operator** (§5). It lists accounts, keys, addresses and scheduled
commands, which can contain secrets. It goes into no repository file, PR, issue or chat; only G6's
conclusion does.

**P7 helpers.** Three functions that P7a and P9 use. **Admin, read-only.** Define them again in each
new shell:

```bash
sudo -v
# The connection context of this SSH session, for sshd -T -C (sshd(8)): addr and host are the
# client's address and resolved name, laddr and lport the server's address and port.
ssh_context() {
  local caddr laddr lport cfg usedns name
  ctx=
  if [ -z "${SSH_CONNECTION-}" ]; then echo "UNREAD: SSH_CONNECTION is empty: not an SSH session"; return 1; fi
  read -r caddr _ laddr lport <<<"$SSH_CONNECTION"
  if ! cfg=$(sudo sshd -T 2>&1); then echo "UNREAD: sshd -T failed: $cfg"; return 1; fi
  usedns=$(awk '$1 == "usedns" { print $2 }' <<<"$cfg")
  name=$caddr
  if [ "$usedns" = yes ]; then
    name=$(getent hosts "$caddr" | awk '{ print $2; exit }')
    name=${name:-$caddr}
    echo "REVIEW: UseDNS yes: host=$name comes from getent; sshd also confirms the name forward, so a Match Host may see another name"
  fi
  ctx="host=$name,addr=$caddr,laddr=$laddr,lport=$lport"
  echo "context: UseDNS ${usedns:-unknown}; $ctx"
}
# Every key that sshd accepts for account $1 (home $2, UID $3), from its effective configuration $4:
# one "key:" line per key with its fingerprint and its forwarding options, never the key itself.
# Returns 2 when no authorized-keys file exists.
keys_of() {
  local u=$1 h=$2 id=$3 cfg=$4 value p f content line fp opts n keys found=0 k v e
  local -a paths
  for k in authorizedkeyscommand authorizedprincipalsfile authorizedprincipalscommand trustedusercakeys; do
    v=$(awk -v k="$k" '$1 == k { $1 = ""; sub(/^ +/, ""); print }' <<<"$cfg")
    if [ -n "$v" ] && [ "$v" != none ]; then echo "REVIEW: $u: $k $v: keys or certificates from it are not listed here"; fi
  done
  value=$(awk '$1 == "authorizedkeysfile" { $1 = ""; print }' <<<"$cfg")
  read -ra paths <<<"$value"
  for p in "${paths[@]}"; do
    [ "$p" != none ] || continue
    f=${p//%%/$'\001'}
    f=${f//%h/$h}
    f=${f//%u/$u}
    f=${f//%U/$id}
    f=${f//$'\001'/%}
    case $f in /*) ;; *) f=$h/$f ;; esac
    # Not "sudo test -e": a failed sudo would look like a missing file.
    e=$(sudo sh -c 'if [ -e "$1" ]; then echo present; else echo absent; fi' sh "$f" 2>&1)
    case $e in
      absent) continue ;;
      present) found=1 ;;
      *)
        found=1
        echo "UNREAD: $u: whether $f exists is unknown: $e"
        continue
        ;;
    esac
    if ! content=$(sudo cat "$f" 2>&1); then echo "UNREAD: $u: $f: $content"; continue; fi
    n=0
    keys=0
    while IFS= read -r line; do
      n=$((n + 1))
      if [[ $line =~ ^[[:space:]]*(#|$) ]]; then continue; fi
      keys=$((keys + 1))
      opts=$(grep -oE '(^|,)(restrict|no-port-forwarding|port-forwarding|permitopen="[^"]*"|from="[^"]*"|command="[^"]*")' <<<"$line" | tr -d '\n')
      if fp=$(ssh-keygen -l -E sha256 -f - <<<"$line" 2>/dev/null); then
        echo "key: $u $f:$n $fp${opts:+; options $opts}"
      else
        echo "UNREAD: $u $f:$n: not a key that ssh-keygen can read"
      fi
    done <<<"$content"
    if [ "$keys" -eq 0 ]; then echo "empty: $u: $f holds no key"; fi
  done
  [ "$found" -eq 1 ] || return 2
}
# Whether NSS takes accounts and groups only from what P7a and P9 read themselves: /etc/passwd and
# /etc/group ("files") first, then at most nss-systemd ("systemd") without records of its own beyond
# dynamic users. getent exits 2 whenever no source returned an entry, also when a source failed, so
# "absent" needs nss_local=true and a direct read of the file.
nss_sources() {
  local conf db lines d o ok=true
  nss_local=false
  if ! conf=$(cat /etc/nsswitch.conf 2>&1); then echo "UNREAD: /etc/nsswitch.conf: $conf"; return 1; fi
  for db in passwd group initgroups; do
    lines=$(grep -iE "^[[:space:]]*$db[[:space:]]*:" <<<"$conf")
    echo "nss: ${lines:-no $db line}"
    if [ "$db" = initgroups ] && [ -z "$lines" ]; then continue; fi
    if [ "$(grep -c . <<<"$lines")" -ne 1 ] || ! grep -qE "^[[:space:]]*$db:[[:space:]]*files([[:space:]]+systemd)?[[:space:]]*\$" <<<"$lines"; then
      echo "REVIEW: NSS $db: not exactly one line \"$db: files\" or \"$db: files systemd\", so another source may answer"
      ok=false
    fi
  done
  for d in /etc/userdb /run/userdb /run/host/userdb /usr/local/lib/userdb /usr/lib/userdb /run/systemd/userdb; do
    [ -e "$d" ] || continue
    if ! o=$(ls -A "$d" 2>&1); then
      echo "UNREAD: $d: $o"
      ok=false
      continue
    fi
    if [ "$d" = /run/systemd/userdb ]; then o=$(grep -vxE 'io\.systemd\.(DynamicUser|Multiplexer|NameServiceSwitch|DropIn)' <<<"$o"); fi
    if [ -n "$o" ]; then
      echo "REVIEW: $d: records or services of nss-systemd that P7a does not read: $(tr '\n' ' ' <<<"$o")"
      ok=false
    fi
  done
  if [ -e /var/run/nscd/socket ]; then
    echo "REVIEW: nscd runs, so getent may answer from its cache"
    ok=false
  fi
  if $ok; then
    nss_local=true
    echo "nss: accounts and groups from /etc/passwd, /etc/group and dynamic users only"
  fi
}
```

- **`ssh_context`** takes the session's connection from `SSH_CONNECTION`: the client's address and
  port, then the server's address and port. `sshd -T -C` takes them as `addr`, `laddr` and `lport`,
  and `host` as the client's resolved name ([P9](#p9-ssh-forwarding-for-the-copy-and-the-tunnel)).
  With `UseDNS no`, OpenSSH's default, sshd uses the address in place of a name, so `host` is the
  address. With `UseDNS yes` the name comes from `getent`, which may differ from sshd's own lookup:
  `REVIEW`.
- **`keys_of`** lists every key of the account's effective `AuthorizedKeysFile` paths, with `%h`,
  `%u`, `%U` and `%%` expanded and relative paths taken under the home. Each key appears as its
  SHA-256 fingerprint (`ssh-keygen -l`), with its file, line number and forwarding options, never as
  the key itself. A line that `ssh-keygen` cannot read is `UNREAD`.
- **Whether a key file exists** is asked through `sudo sh -c`, which answers `present` or `absent`.
  Any other answer, for example a failed `sudo`, is `UNREAD`. `sudo test -e` could not tell a
  missing file from a failed `sudo`, and would have counted the second as no keys.
- **Other sources of keys:** an `AuthorizedKeysCommand`, `AuthorizedPrincipalsFile`,
  `AuthorizedPrincipalsCommand` or `TrustedUserCAKeys` other than `none` is `REVIEW`. The keys or
  certificates it admits are not in the listing, so the operator reviews that source itself.
- **`nss_sources`** decides whether a missing account or group can be confirmed at all:
  - **`getent` cannot tell a missing entry from a failed source.** Its exit status is 2 whenever
    the lookup returned no entry, and 0 after any enumeration, even one in which a source failed
    ([glibc 2.39, `nss/getent.c`](https://github.com/bminor/glibc/blob/glibc-2.39/nss/getent.c)).
    It also exits 2 for a group that exists when `/etc/group` cannot be read [LOCAL, glibc 2.43].
  - **The sources it accepts:** exactly one `passwd:` and one `group:` line, each `files` or
    `files systemd`, and an `initgroups:` line, if there is one, of the same form. Any other form,
    such as another source, an action in brackets, a comment after the sources or a second line
    for the same database, is `REVIEW`. glibc takes the later of two lines, and a missing line
    gives a default that depends on glibc's build.
  - **nss-systemd's own records:** nss-systemd also answers from JSON drop-ins in `/etc/userdb`,
    `/run/userdb`, `/run/host/userdb`, `/usr/local/lib/userdb` and `/usr/lib/userdb`, and from the
    services in `/run/systemd/userdb`
    ([systemd v255, `userdb-dropin.h`](https://github.com/systemd/systemd/blob/v255/src/shared/userdb-dropin.h),
    [`userdb.c`](https://github.com/systemd/systemd/blob/v255/src/shared/userdb.c)). With systemd
    259, a drop-in account was found by name but not listed by `getent passwd`, and a
    `.membership` drop-in added a group that `id` showed and `getent group` did not [LOCAL]. Any
    entry in these directories is `REVIEW`. The services accepted are PID 1's
    `io.systemd.DynamicUser` and systemd-userdbd's `io.systemd.Multiplexer`,
    `io.systemd.NameServiceSwitch` and `io.systemd.DropIn`, which add nothing beyond dynamic users,
    the files and the drop-ins.
  - **Dynamic users** exist only while a unit with `DynamicUser=` runs, and P7c lists every running
    unit.
  - **nscd**, if it runs, can answer from its cache: `REVIEW`.
  - With every source accepted, it sets `nss_local=true`. Otherwise no account or group is
    confirmed missing, and P7a's account list is not complete.

**P7a. Accounts, privileges and keys. Admin, read-only:**

```bash
ssh_context
nss_sources
# Every account, read once. The list is complete only if it holds every entry of /etc/passwd and
# UID 0, and NSS asks no other source. Otherwise it is UNREAD, and every later listing that needs
# the accounts says so. getent exits 0 after an enumeration even if a source failed.
db=$(getent passwd)
rc=$?
accounts=false
if [ "$rc" -ne 0 ]; then
  echo "UNREAD: getent passwd failed with exit status $rc: no account is listed"
elif [ -z "$db" ]; then
  echo "empty: getent passwd returned no account"
  echo "UNREAD: no account with UID 0 was listed, so the account database was not read completely"
elif ! missing=$(printf '%s\n' "$db" | awk -F: 'NR == FNR { seen[$1] = 1; next } /^[ \t]*(#|$)/ { next } !($1 in seen) { print $1 }' - /etc/passwd); then
  echo "UNREAD: /etc/passwd could not be read, so the account list cannot be checked against it"
elif [ -n "$missing" ]; then
  echo "UNREAD: getent passwd did not list these entries of /etc/passwd: $(tr '\n' ' ' <<<"$missing")"
elif ! awk -F: '$3 == 0 { found = 1 } END { exit !found }' <<<"$db"; then
  echo "UNREAD: no account with UID 0 was listed, so the account database was not read completely"
elif [ "$nss_local" != true ]; then
  echo "UNREAD: nss_sources did not accept NSS's sources (above), so accounts may come from a source that this list does not show"
else
  accounts=true
  echo "accounts: $(grep -c . <<<"$db")"
  awk -F: '$3 == 0 { print "uid 0:", $1 }' <<<"$db"
  awk -F: '$7 !~ /(nologin|false|sync)$/ { print "login shell:", $1, $3, $7 }' <<<"$db"
fi
# Exit status 2 is absent only if NSS asks no other source and /etc/group, read directly, has no
# such group. A group's members are its listed members and the accounts whose primary group it is.
for g in sudo admin docker adm systemd-journal; do
  o=$(getent group "$g")
  rc=$?
  if [ "$rc" -eq 0 ]; then
    printf '%s\n' "$o"
    if $accounts; then
      m=$(awk -F: -v gid="$(cut -d: -f3 <<<"$o")" '$4 == gid { printf "%s%s", sep, $1; sep = " " }' <<<"$db")
      echo "primary group $g: ${m:-no account}"
    else
      echo "UNREAD: no complete account list, so the accounts whose primary group is $g are not listed"
    fi
  elif [ "$rc" -eq 2 ] && [ "$nss_local" = true ] && awk -F: -v g="$g" '$1 == g { found = 1 } END { exit found }' /etc/group; then
    echo "absent: no group $g"
  else
    echo "UNREAD: group $g: getent exited $rc, and no read confirms that the group is missing"
  fi
done
o=$(sudo passwd -S -a 2>&1)
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "UNREAD: passwd -S -a failed with exit status $rc: $o"
elif ! awk '$1 == "root" { found = 1 } END { exit !found }' <<<"$o"; then
  echo "UNREAD: passwd -S -a listed no root, so its list is not complete"
else
  u=$(awk '$2 == "P" { printf "%s%s", sep, $1; sep = " " }' <<<"$o")
  echo "usable password: ${u:-none}"
fi
absent=0
if ! $accounts; then
  echo "UNREAD: no complete account list, so no account's keys are listed"
elif [ -z "$ctx" ]; then
  echo "UNREAD: no connection context, so no account's keys are listed"
else
  while IFS=: read -r u _ id _ _ h _; do
    if ! cfg=$(sudo sshd -T -C "user=$u,$ctx" 2>&1); then echo "UNREAD: $u: sshd -T failed: $cfg"; continue; fi
    keys_of "$u" "$h" "$id" "$cfg"
    if [ $? -eq 2 ]; then absent=$((absent + 1)); fi
  done <<<"$db"
  echo "absent: $absent account(s) without an authorized-keys file"
fi
if o=$(sudo grep -rvhE '^[[:space:]]*(#|$)' /etc/sudoers /etc/sudoers.d 2>&1); then
  printf '%s\n' "$o"
elif [ $? -eq 1 ]; then
  echo "empty: no sudo rule"
else
  echo "UNREAD: the sudo rules: $o"
fi
last -n 20 || echo "UNREAD: last failed"
```

- **The account list is read once, and checked:**
  - `getent passwd` failing is `UNREAD`;
  - an empty result is reported `empty:` and then `UNREAD:`, because a list without UID 0 cannot be
    complete;
  - so is a list that lacks an entry of `/etc/passwd`, read directly, or when `/etc/passwd`
    cannot be read;
  - so is a list without UID 0;
  - so is any list when `nss_sources` did not accept NSS's sources.

  In each of these cases no account's keys are listed, and P7a prints `UNREAD` in their place. The
  `accounts:` line gives the count for the operator to compare.
- **Groups:**
  - `absent:` needs three things: `getent group` exits 2, `nss_sources` accepted the sources, and
    `/etc/group`, read directly, has no such group (`awk` exits 0; 2 if it cannot read the file).
    Anything else is `UNREAD`, because exit status 2 alone is also the answer of a failed source.
  - **The members** of a group are the accounts it lists and the accounts whose primary group it is
    (`primary group`), which `getent group` does not list. Without a complete account list, the
    second are `UNREAD`.
- **Tested locally, not on the VPS** [LOCAL]: P7a and P9 ran with the real `getent` of glibc 2.43
  and systemd 259 (Ubuntu 26.04 under WSL), under gawk and mawk, in user and mount namespaces whose
  `nsswitch.conf`, account files and nss-systemd directories were replaced for each case. Only
  `sudo`, `sshd`, `passwd` and `last` were fakes.
  - Revision 4's blocks printed `absent:` for every group when `/etc/group` could not be read, and
    for a missing group or account behind a source that could not be loaded. They also gave a
    complete account list without an nss-systemd drop-in account.
  - Revision 5's give `UNREAD` or `REVIEW` in each of these cases, and `absent:` only with
    accepted sources and readable files.
  - The VPS runs glibc 2.39 and systemd 255, which may behave differently.
- **`passwd -S -a`** must succeed and list `root`. Otherwise its list of usable passwords is
  `UNREAD`.
- **Every account's keys are listed, not only those with a login shell.** An account with
  `nologin` can still authenticate, for example to forward a port with `ssh -N`.
- **To compare the fingerprints** with the keys the operator trusts, **Local:**
  `ssh-keygen -l -E sha256 -f <public key file>` for each of them: the operator's own keys, and the
  public half of the key the deploy workflow uses. Every `key:` line must match one of them.

**P7b. Scheduled work, with the commands it runs. Admin, read-only:**

```bash
if o=$(sudo grep -vHE '^[[:space:]]*(#|$)' /etc/crontab /etc/cron.d/* 2>&1); then
  printf '%s\n' "$o"
elif [ $? -eq 1 ]; then
  echo "empty: no line in /etc/crontab or /etc/cron.d"
else
  echo "UNREAD: /etc/crontab or /etc/cron.d: $o"
fi
for d in /etc/cron.hourly /etc/cron.daily /etc/cron.weekly /etc/cron.monthly; do
  if [ ! -d "$d" ]; then
    echo "absent: $d"
  elif o=$(run-parts --test "$d" 2>&1); then
    echo "$d runs: ${o:-nothing}" | tr '\n' ' '
    echo
  else
    echo "UNREAD: $d: $o"
  fi
done
for f in /etc/cron.d/* /etc/cron.hourly/* /etc/cron.daily/* /etc/cron.weekly/* /etc/cron.monthly/*; do
  [ -f "$f" ] || continue
  if p=$(dpkg -S "$f" 2>/dev/null); then
    m=$(dpkg -V "${p%%:*}" 2>/dev/null | grep -F " $f")
    echo "$f: from package ${p%%:*}${m:+; MODIFIED: $m}"
  else
    echo "== $f: from no package. Its content:"
    sudo cat "$f" || echo "UNREAD: $f"
  fi
done
sudo sh -c 'd=/var/spool/cron/crontabs; [ -d "$d" ] || { echo "absent: $d: no user crontabs"; exit 0; }; [ -r "$d" ] || { echo "UNREAD: $d"; exit 1; }; n=0; for f in "$d"/*; do [ -f "$f" ] || continue; n=$((n + 1)); echo "== crontab of ${f##*/}"; grep -vE "^[[:space:]]*(#|\$)" "$f"; done; echo "user crontabs: $n"'
if ! command -v atq >/dev/null; then
  echo "absent: at is not installed, so no at job"
elif ! q=$(sudo atq 2>&1); then
  echo "UNREAD: atq failed: $q"
elif [ -z "$q" ]; then
  echo "empty: no queued at job"
else
  printf '%s\n' "$q"
  while read -r id _; do
    echo "== at job $id, the script it will run:"
    sudo at -c "$id" || echo "UNREAD: at -c $id failed"
  done <<<"$q"
fi
```

- **`at -c <id>`** prints the script that the job will run, its environment included. It can hold
  secrets, and stays with the operator.

**P7c. Services, timers and user managers, with their definitions; listeners. Admin, read-only:**

```bash
# Prints where unit $2 of the manager $1 comes from: its package, user and any modification; or, if it
# does not come only from a package, its whole definition. $1 is "system", or a user's name.
unit_review() {
  local m=$1 u=$2 f d p mod
  local -a sc=(systemctl)
  if [ "$m" != system ]; then sc=(sudo systemctl --user -M "$m@"); fi
  f=$("${sc[@]}" show -p FragmentPath --value "$u")
  d=$("${sc[@]}" show -p DropInPaths --value "$u")
  p=
  if [ -n "$f" ]; then p=$(dpkg -S "$f" 2>/dev/null || dpkg -S "${f#/usr}" 2>/dev/null); fi
  if [ -n "$p" ] && [ -z "$d" ]; then
    mod=$(dpkg -V "${p%%:*}" 2>/dev/null | grep -F "${f#/usr}")
    echo "$m $u: from package ${p%%:*} ($f), User=$("${sc[@]}" show -p User --value "$u")${mod:+; MODIFIED: $mod}"
  else
    echo "== $m $u: not only from a package (${f:-no unit file}${d:+; drop-ins: $d}). Its definition:"
    "${sc[@]}" cat --no-pager "$u" || echo "UNREAD: $m $u: no definition could be read"
  fi
}
# The running services and the timers, with the services they start, of manager $1.
review_manager() {
  local m=$1 out u t s
  local -a sc=(systemctl)
  if [ "$m" != system ]; then sc=(sudo systemctl --user -M "$m@"); fi
  if ! out=$("${sc[@]}" list-units --type=service --state=running --no-pager --no-legend --plain 2>&1); then
    echo "UNREAD: $m: its running services: $out"
  elif [ -z "$out" ]; then
    echo "empty: $m: no running service"
  else
    while read -r u _; do unit_review "$m" "$u"; done <<<"$out"
  fi
  if ! out=$("${sc[@]}" list-timers --all --no-pager --no-legend 2>&1); then
    echo "UNREAD: $m: its timers: $out"
  elif [ -z "$out" ]; then
    echo "empty: $m: no timer"
  else
    while read -r t s; do
      unit_review "$m" "$t"
      unit_review "$m" "$s"
    done < <(awk '{ print $(NF-1), $NF }' <<<"$out")
  fi
}
review_manager system
# User managers: those that linger, which run without a login, and those that run now.
if [ ! -e /var/lib/systemd/linger ]; then
  linger=
  echo "absent: /var/lib/systemd/linger: no user lingers"
elif ! linger=$(ls -A /var/lib/systemd/linger 2>&1); then
  echo "UNREAD: /var/lib/systemd/linger: $linger"
  linger=
elif [ -z "$linger" ]; then
  echo "empty: no user lingers"
else
  echo "lingering: $(tr '\n' ' ' <<<"$linger")"
fi
if ! active=$(loginctl list-users --no-legend 2>&1); then
  echo "UNREAD: loginctl list-users: $active"
  active=
fi
users=$( { printf '%s\n' "$linger"; awk '{ print $2 }' <<<"$active"; } | grep . | sort -u)
if [ -z "$users" ]; then
  echo "empty: no user manager to review"
else
  while read -r u; do review_manager "$u"; done <<<"$users"
fi
if o=$(sudo ss -Hltunp 2>&1); then
  printf '%s\n' "${o:-empty: no listener}"
else
  echo "UNREAD: ss: $o"
fi
```

- **User managers** run units without the system manager: those of lingering users even without a
  login, those of logged-in users while they are logged in. P7c reviews every manager that lingers
  or runs now (`loginctl list-users`), through `systemctl --user -M <user>@`, which needs root. A
  manager it cannot reach is `UNREAD`.
- **What P7a to P7c show:**
  - every account with UID 0 or in a privileged group, the sudo rules and the recent logins;
  - which accounts have a usable password, and every key that sshd accepts for any account, by its
    fingerprint and options;
  - every cron line, periodic script, user crontab and `at` job, with its command;
  - every running service and timer of the system and of every user manager, with its unit file, or
    its whole definition where it does not come only from a package;
  - every listener with its process.
- **Package files are checked, not trusted:** `dpkg -V` reports a cron script or unit file that
  differs from its package (`MODIFIED`).
- `dpkg -S` may not find a unit under `/usr/lib` that its package records under `/lib`; the
  function tries both. A unit it still cannot place is shown in full, so the review sees more,
  not less.
- Every member of `docker` is root-equivalent
  ([S4b §4.4](S4b_DESIGN_CONTRACT.md#44-what-the-port-policy-protects-and-what-it-does-not)).

### P8. IPv6 and the firewall (U12)

**VPS, read-only**, the UFW line as admin:

```bash
ip -6 addr show scope global
ip -6 route show default
cat /proc/sys/net/ipv6/conf/all/disable_ipv6
grep '^IPV6=' /etc/default/ufw
sudo ufw status verbose
ss -6 -Hltn
```

- Record whether a global IPv6 address exists, not the address.
- Record UFW's state, its defaults, `IPV6=` and the listeners on IPv6.

### P9. SSH forwarding for the copy and the tunnel

**Admin, read-only**, for each account D2 considers. It runs from inside an SSH session, ideally
the one that will open the tunnel, and needs P7's helpers:

```bash
u=<user>
nss_sources
if ssh_context; then
  pw=$(getent passwd "$u")
  rc=$?
  h= id=
  IFS=: read -r _ _ id _ _ h _ <<<"$pw"
  if [ "$rc" -eq 2 ] && [ "$nss_local" = true ] && awk -F: -v u="$u" '$1 == u { found = 1 } END { exit found }' /etc/passwd; then
    echo "absent: no account $u"
  elif [ "$rc" -ne 0 ] || [ -z "$h" ]; then
    echo "UNREAD: account $u: getent passwd exited $rc, and no complete entry or confirmed absence was read"
  elif cfg=$(sudo sshd -T -C "user=$u,$ctx" 2>&1); then
    grep -E '^(allowtcpforwarding|disableforwarding|permitopen|permitlisten) ' <<<"$cfg"
    keys_of "$u" "$h" "$id" "$cfg"
    if [ $? -eq 2 ]; then echo "absent: $u has no authorized-keys file"; fi
  else
    echo "UNREAD: $u: sshd -T failed: $cfg"
  fi
fi
if o=$(sudo grep -rnHiE '^[[:space:]]*(Match|Include)[[:space:]]' /etc/ssh/sshd_config /etc/ssh/sshd_config.d 2>&1); then
  printf '%s\n' "$o"
elif [ $? -eq 1 ]; then
  echo "empty: no Match or Include line"
else
  echo "UNREAD: the sshd configuration files: $o"
fi
```

- **The account:** `absent:` only when `getent passwd <user>` exits 2, `nss_sources` accepted
  NSS's sources, and `/etc/passwd`, read directly, has no such account. `UNREAD:` for anything
  else, or an entry without a home. An entry that `getent` returns is used as it is: sshd sees the
  same entry.
- **The context is this session's.** `ssh_context` passes the client's address as `addr` (and as
  `host` under `UseDNS no`), and the server's address and port as `laddr` and `lport`. Earlier
  revisions passed the VPS's own hostname as `host`, which no `Match Host` would compare with.
- **What the context cannot represent:** a `Match` block that tests `Address`, `Host`,
  `LocalAddress`, `LocalPort` or `RDomain` applies only to connections like this one. If the tunnel
  will come from another network or through another port, run P9 from such a session, or review
  each such block by hand. `Match User` and `Match Group` are evaluated for `<user>`.
- **The `Match` and `Include` lines** are listed so that the operator can see them. An `Include`
  that points outside `/etc/ssh/sshd_config.d` may hold further `Match` blocks: read that file too.
  Until then, P9 is INCONCLUSIVE.
- **The tunnel needs** `allowtcpforwarding` `yes` or `local`, `disableforwarding no`, and a
  `permitopen` that allows `127.0.0.1:3000` (`any` by default).
- **Per key**, `keys_of` prints the fingerprint and the forwarding options, never the key. A key with
  `restrict` and without `port-forwarding`, or with `no-port-forwarding`, cannot open the tunnel. A
  key the deploy workflow uses should keep such a restriction; the tunnel then needs another key or
  account (D2).
- **The Alloy UI tunnel** of V15 also needs `permitopen` to allow a container address.
- **The verdict** that the operator shares: whether the account may forward to `127.0.0.1:3000`
  with the key that will be used, which the operator identifies by its fingerprint; or why not.
  The fingerprints and addresses themselves stay with the operator (§5).

### P10. The `deploy` account and tools

**VPS, read-only, as `deploy`:**

```bash
id
getent passwd "$(id -un)" | cut -d: -f6,7
echo "bash $BASH_VERSION; umask $(umask)"
docker info --format 'engine answers: {{.ServerVersion}}'
env | grep -oE '^(COMPOSE_[A-Z_]*|DOCKER_[A-Z_]*|GRAFANA_AUTH|OBSERVABILITY_COMPOSE_FILES)=' || echo 'none of these variables is set'
ls -ld /var /var/nimuairy 2>&1
stat -c '%a %U:%G %n' /var/run/docker.sock
for t in bash docker curl timeout od ss jq sha256sum tar diff; do printf '%-10s %s\n' "$t" "$(command -v "$t" || echo MISSING)"; done
echo "awk: $(readlink -f "$(command -v awk)"); $(awk -W version 2>&1 | head -n 1)"
sudo -n -l >/dev/null 2>&1 && echo 'deploy: passwordless sudo' || echo 'deploy: no passwordless sudo'
```

- **Expected:** `deploy` in the `docker` group, Bash 4 or later as its shell, the engine answering,
  no variable listed, the production check's tools present, and `diff` for the readout's
  self-test. `jq` is optional (G4).
- **`awk`** names the implementation and version that will run the readout of §10.3, for example
  `mawk 1.3.4 <date>`. The readout uses only POSIX awk, but only its self-test on the VPS shows
  that this awk runs it correctly.
- `env | grep -o` prints variable names, never values. A `COMPOSE_PROJECT_NAME`, `COMPOSE_FILE`,
  `DOCKER_HOST` or `DOCKER_CONTEXT` in the environment would change what the Compose commands do:
  STOP.
- `sudo -n -l` decides who runs the optional log-size and volume-ownership reads (V12, V14).

### Preflight record (template)

| # | Fact | Expected | Read | ok / STOP |
|---|---|---|---|---|
| P1 | Kernel, OS, `lxc`, systemd, time zone | Recorded; differences from §2.3 noted | | |
| P1 | `uid_map`, `gid_map` | Evaluated in G7 | | |
| P2 | Engine, Compose, runc versions | Recorded; Compose is rendered in G4 whatever its version | | |
| P2 | cgroup version and driver | `2/systemd` (G12) | | |
| P2 | `userns` in SecurityOptions; context | Absent; `default` | | |
| P2 | Log rotation in `daemon.json` | Recorded (D5) | | |
| P3 | Application containers | Four, healthy, limits as in S4.4 | | |
| P4 | Memory, CPU, PIDs, disk, `memory.stat` fields, event counters | Recorded as the baseline | | |
| P5 | Stack volumes, networks, containers; the directory | None; does not exist | | |
| P6 | Listeners on the stack's ports | None | | |
| P7 | Accounts, privileges, scheduled work, services, timers, listeners | Reviewed by the operator for G6; only the conclusion is recorded | | |
| P8 | Global IPv6, UFW, IPv6 listeners | Recorded for G9 | | |
| P9 | Forwarding for the D2 account(s), in this session's context | Allowed for the tunnel account and its key; every `Match` that the context cannot represent reviewed; only the verdict is recorded | | |
| P10 | `deploy`, environment, tools, sudo | As expected above | | |
| P10 | `awk` implementation and version | Recorded; the self-test of §10.3 decides | | |

## 7. S6.2 — Delivering the files and host configuration

**Consent:** C2. It needs S6.1 recorded without an open STOP, and D1 and D2 decided.

### 7.1 The commit

- A commit on `master` whose CI run passed, as the guide's
  [Build the archive](OBSERVABILITY_PRODUCTION.md#build-the-archive) requires.
- **Its archived paths should equal those of `ff0139a`**, the configuration that CI run #348
  verified in phase B. Any other content is reviewed before it is used.

**Local, in Bash:**

```bash
sha=<sha>
git fetch origin
if git diff --quiet ff0139acaad075350ed7cc5bd50a1e38ec0e16da "$sha" -- observability scripts/observability-prod-check.sh; then
  echo "ok: the archived paths at $sha equal those of ff0139a"
else
  echo "REVIEW: the archived paths at $sha differ from ff0139a, or the comparison failed"
fi
```

Check in GitHub's Actions view that the CI run of that commit on `master` succeeded.

### 7.2 The directory

**Admin, changes files:**

```bash
d=/var/nimuairy-observability
if [ -e "$d" ]; then
  echo "STOP: $d exists already"
else
  sudo install -d -o deploy -g "$(id -gn deploy)" -m 0755 "$d" && stat -c '%U:%G mode %a %n' "$d"
fi
```

- Expected: `deploy:<deploy's group> mode 755`.
- `install -d` would also change the owner and mode of an existing directory, hence the check
  first.

### 7.3 Archive, copy and extraction

1. **Build** the archive with the guide's block, from the SHA of §7.1:
   [Build the archive](OBSERVABILITY_PRODUCTION.md#build-the-archive). Only its `OK` line counts.
2. **Copy** it as in [Copy and extract](OBSERVABILITY_PRODUCTION.md#copy-and-extract), as the
   account D2 chose.
3. **If that account is not `deploy`**, hand the archive over. **Admin, changes files:**

   ```bash
   sha=<sha>
   sudo install -o deploy -g "$(id -gn deploy)" -m 0644 ~/"nimuairy-observability-$sha.tar" "$(getent passwd deploy | cut -d: -f6)/"
   ```

4. **Check and extract** as `deploy` with the guide's blocks: the `sha256sum` and the listing
   first, then the extraction, which writes `REVISION`.
5. **Stale files** ([Check for stale files](OBSERVABILITY_PRODUCTION.md#check-for-stale-files)): on
   the first extraction it prints nothing, because `observability/.env` and `observability/secrets/`
   do not exist yet.

### 7.4 `observability/.env`

**VPS, changes files, as `deploy`:**

```bash
cd /var/nimuairy-observability
e=observability/.env
if [ -e "$e" ]; then
  echo "STOP: $e exists already"
elif g=$(stat -c %g /var/run/docker.sock) && [[ $g =~ ^[0-9]+$ ]] && (umask 022 && printf 'DOCKER_SOCKET_GID=%s\n' "$g" > "$e"); then
  echo "ok: $e holds DOCKER_SOCKET_GID=$g"
else
  echo "STOP: $e was not written"
fi
```

The file holds exactly that one line
([The Docker socket's group](OBSERVABILITY_PRODUCTION.md#the-docker-sockets-group)). G4 shows
whether the render reads it.

### 7.5 The Grafana secret

**Requirements**, from B2, B3 and the guide: a regular, non-empty file, not `admin`, readable by
UID 472 inside the container, in a directory with mode 0700; never in Git, shell history, a command
argument, a log or a chat.

**Owner and mode (D1).** S4b left two options
([§6.5](S4b_DESIGN_CONTRACT.md#65-supplying-the-secret)):

| | **A**: 0644, owner `deploy`, in a 0700 directory owned by `deploy` (recommended) | **B**: 0400, owner UID 472 |
|---|---|---|
| Who can create it | `deploy` | Only root: `chown` to another UID needs it |
| Grafana (UID 472) reads it | Through the "other" read bit. Compose bind-mounts the file itself (S4b §6.1), so inside the container the path runs through Docker's `/run/secrets`, not the host's 0700 directory [inference]. CI reads a 0644 file the same way, but in a directory with the default mode (§2.4) | As its owner |
| The engine opens the bind source | dockerd and runc run as the LXC's root, which may traverse a directory owned by a UID mapped into the LXC [inference] | The same |
| `prod-check runtime` as `deploy` | Reads the file (`load_credentials` needs `-f` and `-r`) | `FATAL ... not a readable file`. Working around it needs `GRAFANA_AUTH`, which puts the password into the environment and which the guide forbids, or running the check as root |
| The guide's property check as `deploy` | Checks every property | Stops at `not readable by this account` |
| Rotation (`mv -f` of a `.new` file) | `deploy` can do it, then `chmod` | The new file belongs to `deploy` until root changes its owner again |
| Protection on the host | Other non-root users cannot enter the 0700 directory. Root and every `docker` member can read the file either way | The same; `deploy` is root-equivalent through Docker, so not being able to read the file adds nothing |
| Inside the Grafana container | Any process can read it; only Grafana runs there, as 472 | Only 472, and root in the container |

**Recommendation: A.** It needs no root, keeps the production check and the guide's check usable
as `deploy`, and B protects nothing further on this host.

**Evidence that A works**, all required:
- `stat`: directory `deploy:<group> mode 700`, file `regular file, deploy:<group> mode 644` (G5);
- G7: UID 472 is mapped in the LXC;
- Grafana passes its guard and becomes healthy: the guard's `-r` runs as 472 inside the container,
  so this is the evidence of 472's read access (V1, S6.4 logs);
- P-R4's configured login answers `200` on a `grafana-data` volume created by this start (V3, V6),
  so the database holds the file's password.

**The password** comes from the password manager.
- Proposed rule: at least 32 characters, only `A–Z`, `a–z` and `0–9`. No whitespace, quotes or
  backslashes, which the production check's curl configuration and the rotation procedure would
  have to escape. CI uses a 64-character hex string.
- The second entry is compared in the shell, without output, so a wrong paste cannot become the
  password of the new database.

**VPS, changes files, as `deploy`.** Close terminal logging and screen sharing first.

```bash
cd /var/nimuairy-observability
d=observability/secrets
f=$d/grafana_admin_password
if [ -e "$d" ]; then
  echo "STOP: $d exists already"
elif (umask 077 && mkdir "$d"); then
  stat -c '%F %U:%G mode %a %n' "$d"
else
  echo "STOP: $d was not created"
fi
```

Then, in the same shell. The password is pasted at the two silent prompts, never on a command line:

```bash
# No shell trace while the password is in a variable: under set -x, Bash would print the
# expanded comparisons and printf's argument. The braces keep "set +x" itself out of the trace.
{ set +x; } 2>/dev/null
set +o history
if [ ! -d "$d" ] || [ -e "$f" ] || [ -e "$f.new" ]; then
  echo "STOP: $d is missing, or $f or $f.new exists"
elif ! (umask 077 && IFS= read -rsp 'Grafana admin password: ' pw && echo &&
        [[ $pw =~ ^[A-Za-z0-9]{32,}$ ]] && printf '%s' "$pw" > "$f.new"); then
  echo "STOP: nothing written: empty input, or not 32 or more letters and digits. Remove $f.new if it exists"
elif ! (IFS= read -rsp 'The same password again: ' pw2 && echo && [ "$pw2" = "$(< "$f.new")" ]); then
  echo "STOP: the second entry differs. Remove $f.new and start again"
elif ! chmod 0644 "$f.new" || ! mv -n "$f.new" "$f" || [ -e "$f.new" ]; then
  echo "STOP: $f is not in place"
else
  echo "ok: $f written"
fi
set -o history
```

- `read`, `printf`, `[` and `[[` are Bash builtins, so the value never appears in a process's
  arguments. The variables exist only in the subshells.
- `printf '%s'` writes no newline. The guard and the image's `/run.sh` read the content with
  `$(< file)`, which would drop one anyway.
- `set +o history` keeps the session out of the history even if the password is pasted at the
  wrong prompt by mistake.
- **`{ set +x; } 2>/dev/null` comes first.**
  - Under xtrace, Bash would print `[[`'s and `[`'s expanded operands and `printf`'s argument: the
    password, both entries and the temporary file's content, on stderr.
  - The subshells inherit the setting, so the trace stays off throughout, also on each `STOP` path.
  - The block does not turn xtrace on again.
  - Tested with dummy passwords, in `bash -x` and with xtrace exported in `SHELLOPTS`: neither stdout
    nor stderr held a password. Revision 3's block printed it 4 times.
- Afterwards G5 checks the file without printing it.

### 7.6 State after S6.2

- `/var/nimuairy-observability/` holds the archive's files, `REVISION`, `observability/.env` and
  `observability/secrets/grafana_admin_password`.
- No image, network, volume or container of the stack exists yet.
- The archive stays in `deploy`'s home for a later comparison or rollback.
- **Later extractions keep `observability/.env` and `observability/secrets/`:** tar writes only the
  archive's paths, and Git ignores both, so no archive contains them
  ([Copy and extract](OBSERVABILITY_PRODUCTION.md#copy-and-extract)). Never delete the directory
  or its contents before an extraction.

## 8. S6.3 — Pre-start gates

**Rules:**
- **The gates run in the order of §4.1:**
  1. G1 to G10 and G12, before C5;
  2. G11, after C5, with the pre-start sampler running;
  3. G1 to G3 again, and G13a, immediately before the pull (C3a), because a day can pass between
     S6.2 and S6.4;
  4. G13b after the pull, before C3b.
- **Each gate is PASS, FAIL or INCONCLUSIVE.** A failed or inconclusive gate blocks the next step of
  §4.1 until it is resolved explicitly.
- **The gates only read.** G11 and G13 read the pre-start sampler, which C5 starts. A gate's
  resolution that changes state has its own consent.

| Gate | Checks | Settles |
|---|---|---|
| G1 | No existing volume of the stack | Fresh `grafana-data`, `tempo-data`, `alloy-data` |
| G2 | No network or container that the first `up` would collide with | |
| G3 | No listener on Grafana's port or the removed ports | P-R2's preconditions |
| G4 | The production render on the VPS's own Compose | U7, `.env` |
| G5 | The secret's properties, without its content | D1's evidence |
| G6 | No untrusted users or services | U8 |
| G7 | UIDs and GIDs mapped in the LXC; no user-namespace remapping | U9, before the start |
| G8 | The modes the extraction left | U10 |
| G9 | Public IPv6 and the firewall | U12 |
| G10 | Free disk space for the images and their growth | |
| G11 | Timing, the release freeze, the self-test and the running pre-start sampler, after C5 | §10.3's R0 |
| G12 | cgroup v2, Docker's `systemd` driver, systemd scopes, limit support | R1's and the sampler's preconditions |
| G13a | The VPS's memory, pressure, events and the application, over at least 30 min, before the pull | Whether the pull may begin (C3a) |
| G13b | The same over the samples that include the pull, and the pull's own memory stall (R-p), after it | Whether the first `up` may begin (C3b) |

### G1. Existing volumes

- **Command:** P5's first two `none_of` lines (§6), as `deploy`.
- **Expected:** `ok` twice.
- **STOP if any volume is listed.** Record it read-only, without mounting it:
  `docker volume inspect -f '{{.Name}} created={{.CreatedAt}} labels={{json .Labels}}' <volume>`.
  - **`nimuairy-observability_grafana-data`**: Grafana uses the secret only when it creates
    `grafana.db` ([S4b §6.1](S4b_DESIGN_CONTRACT.md#61-facts)). With an existing database the
    secret changes nothing, and the database's password, possibly `admin`, stays. The candidate
    reset procedure is **Not validated**
    ([Rotating the Grafana password](OBSERVABILITY_PRODUCTION.md#rotating-the-grafana-password)).
  - **`nimuairy-observability_tempo-data`** or **`_alloy-data`**: if a root process wrote it, Tempo
    or Alloy cannot use it as their non-root users. The development migration (B6) does not apply
    to the VPS.
  - **Any other** stack volume: unexpected.
- **Next allowed action:** a separate design that decides whether to keep, inspect, migrate or
  remove the volume, with its own approval. S6 does none of these.
- **On a repeated attempt** after S6.6: volumes that this S6 created at the recorded time of its
  first `up` (V3) are expected. Only a volume older than that is a STOP.

### G2. Networks and container names

- **Command:** P5's third to fifth `none_of` lines.
- **Expected:** `ok` three times.
- **STOP if any is listed.**
  - A network named `nimuairy-observability` that Compose did not create makes `up` fail on its
    labels, or would join the stack to a foreign network.
  - A container named like one of the six makes `up` fail on the name.
- **Next allowed action:** find out what created it. S6 does not remove, rename or reuse another
  object.

### G3. Host ports

- **Command:** P6's `none_of` line.
- **Expected:** `ok`.
- **STOP** if anything listens on port 3000, 9090, 3100, 3200, 4317, 4318 or 12345, on any address:
  - on 3000, Docker could not bind Grafana's `127.0.0.1:3000`, or the tunnel could reach another
    service;
  - on the removed ports, P-R2 would fail by design, and the runtime check would prove nothing.
- **Next allowed action:** identify the process (P6's optional line). S6 stops no other service; a
  change to one is a separate decision.

### G4. The production render

**VPS, read-only, as `deploy`.** The output shows only the lines below, never the whole render:

```bash
cd /var/nimuairy-observability
env | grep -oE '^(COMPOSE_[A-Z_]*|DOCKER_[A-Z_]*|GRAFANA_AUTH|OBSERVABILITY_COMPOSE_FILES)=' || echo 'ok: no Compose, Docker or check variable set'
if [ -e /var/nimuairy-observability/.env ]; then echo 'STOP: a .env at the top level'; else echo 'ok: no .env at the top level'; fi
docker compose version
if ! r=$(docker compose -f observability/compose.yaml -f observability/compose.prod.yaml config); then
  echo "STOP: the production render failed"
else
  echo "services: $(docker compose -f observability/compose.yaml -f observability/compose.prod.yaml config --services | sort | tr '\n' ' ')"
  echo "published (expect 1): $(grep -cE '^ +published:' <<<"$r")"
  grep -nE '^  [a-z][a-z_-]*:$|^ +(host_ip|published):' <<<"$r"
  echo "network_mode (expect 0): $(grep -cE '^ +network_mode:' <<<"$r")"
  grep -nE '^ +GF_SECURITY_ADMIN_PASSWORD(__FILE)?:' <<<"$r"
  grep -nE '^ +file: .*/grafana_admin_password$' <<<"$r"
  grep -nE '^ +user: ' <<<"$r"
  for k in mem_limit memswap_limit pids_limit; do echo "$k (expect 6): $(grep -cE "^ +$k:" <<<"$r")"; done
  echo "oom_score_adj 500 (expect 6): $(grep -cE '^ +oom_score_adj: 500$' <<<"$r")"
  echo "socket group: $(stat -c %g /var/run/docker.sock)"
fi
```

**Expected:**
- no variable listed and no top-level `.env`;
- the Compose version recorded; it is the one the render below tests, whatever it is (U7);
- services: `alloy docker-socket-proxy grafana loki prometheus tempo`;
- **exactly one `published`, and one `host_ip: 127.0.0.1`, both under `grafana:`** in the numbered
  lines; the published port is 3000;
  - this is P-S1's set read without `jq`. It also shows that the VPS's Compose applies `!reset []`:
    without it, the render would keep seven mappings;
- `network_mode` 0;
- only `GF_SECURITY_ADMIN_PASSWORD__FILE: /run/secrets/grafana_admin_password`, and no
  `GF_SECURITY_ADMIN_PASSWORD:` line;
- `file: /var/nimuairy-observability/observability/secrets/grafana_admin_password`;
- users `10001:10001` (Tempo), `473:473` (Alloy) and `65534:<socket group>` (the proxy), quoted or
  not. `65534:0` means that Compose did not read `observability/.env`;
- 6 for each limit key and for `oom_score_adj: 500`.

**Optional, only if P10 found `jq` already installed:** `bash scripts/observability-prod-check.sh
static` must end with `All checks passed`. It only renders, including the test overlay, and starts
nothing. S6 installs no package for it.

**STOP** on any difference, including a render that succeeds with another port set. The render
ignores the secret's content, so `config` succeeds even without the file
([S4b §6.1](S4b_DESIGN_CONTRACT.md#61-facts)); G5 checks the file.

**Next allowed action:** a difference in the render is a repository question. The VPS's files are
not edited (§5). A wrong `.env` is fixed by rewriting it (C2).

### G5. The secret's properties

- **Command:** the guide's read-only block under
  [The Grafana admin password](OBSERVABILITY_PRODUCTION.md#the-grafana-admin-password), as `deploy`,
  verbatim.
- **Expected**, with D1 = A: `ok: a non-empty regular file, not admin`; then
  `regular file, <n> bytes, deploy:<group>, mode 644` with `n` at least 32, and
  `deploy:<group>, mode 700` for the directory.
- **STOP** on any `STOP` line, another owner or mode, or fewer than 32 bytes.
- **Next allowed action:** fix the file or the directory under C2, then run G5 again.

### G6. U8: no untrusted users or services

- **Command:** P7's helpers, then P7a, P7b and P7c, from inside an SSH session, and P3's container
  list.
- **Why it matters:** the port reset is no boundary against processes on the host. Prometheus,
  Loki and Tempo have no authentication, and the host reaches every container address
  ([S4b §4.4](S4b_DESIGN_CONTRACT.md#44-what-the-port-policy-protects-and-what-it-does-not)).
- **What the operator reviews,** entry by entry, on the VPS:
  1. the accounts with UID 0: only `root`;
  2. the accounts with a login shell, and which accounts have a usable password;
  3. every `key:` line, of every account: its fingerprint, compared with the trusted keys' own
     (P7a), and its options; every `REVIEW:` line about another source of keys or certificates;
  4. the members of `sudo`, `admin`, `docker`, `adm` and `systemd-journal`, those the group lists
     and those whose primary group it is, and every sudo rule;
  5. the recent logins of `last`;
  6. every line of `/etc/crontab` and `/etc/cron.d/*`; what `run-parts` would run from
     `/etc/cron.hourly`, `daily`, `weekly` and `monthly`, with each script's package or, for a script
     from no package, its content; every user crontab; every queued `at` job's script;
  7. every running service and every timer with the service it starts, of the system manager and of
     every user manager, with its package and user, or its whole definition where it does not come
     only from a package;
  8. every listener with its process, and every container (P3).
- **The marker words** (§5): `absent:` and `empty:` lines say that there is nothing to review in that
  source. `UNREAD:` says that the source is unknown, and `REVIEW:` that it is not shown.
- **Expected (PASS):** no `UNREAD:` line; every `REVIEW:` line resolved; and every entry
  attributed to one of:
  - the operating system or one of its packages, with no `MODIFIED` file;
  - the application: the `deploy` account and the key the deploy workflow uses, the backup cron
    entry ([README, Database backups](../README.md#database-backups)), the four application
    containers, cloudflared's outbound connection;
  - the operator's own administration: their accounts, keys and changes.

  The operator records "G6 PASS" with the date. The lists themselves are not recorded (§5).
- **INCONCLUSIVE:** an `UNREAD:` line, for example a failed command, an account list that failed,
  lacks UID 0 or lacks an entry of `/etc/passwd`, a group lookup that failed or a missing group that
  no read confirms, a key file that cannot be read or whose existence is unknown, a key that
  `ssh-keygen` cannot read, or a user manager that cannot be reached; a `REVIEW:` line not yet
  resolved, such as an `AuthorizedKeysCommand` whose source is not yet reviewed; or an entry not
  yet attributed, such as a script or unit from no package whose purpose is not yet clear. The
  order of §4.1 waits until every source is read and every entry attributed.
- **NSS's sources** (`nss_sources`): while they are not accepted, the account list stays `UNREAD`,
  so G6 cannot pass. A host whose accounts or groups also come from another source, an nss-systemd
  record or nscd needs an inventory of that source, which this contract does not have. Adding one
  is a change to this contract.
- **STOP:** an entry the operator considers unknown or untrusted: a UID 0 account other than
  `root`; an unknown member of `sudo`, `admin` or `docker`; a key whose fingerprint matches no
  trusted key, a usable password or a sudo rule the operator did not set up; an `at` job, a
  certificate authority or a key command the operator did not set up; a `MODIFIED` package file; a
  job, service, timer, user unit, listener, login or container of unknown origin.
- **Next allowed action:** on INCONCLUSIVE, the missing reading or the attribution, then G6 again.
  On STOP, a separate investigation outside S6, which may be a security incident. S6 does not
  continue until a new G6 passes.
- **What it rests on:** the operator's judgement [USER-REPORTED], supported by the VPS listings.

### G7. U9: identity mapping, before the start

**VPS, read-only:**

```bash
g=$(stat -c %g /var/run/docker.sock)
for m in uid_map gid_map; do
  if [ "$m" = gid_map ]; then ids="0 473 10001 65534 $g"; else ids="472 473 10001 65534"; fi
  awk -v m="$m" -v ids="$ids" 'BEGIN { n = split(ids, id, " ") }
    { print m ": " $1, $2, $3; for (i = 1; i <= n; i++) if (id[i] + 0 >= $1 + 0 && id[i] + 0 < $1 + $3) ok[i] = 1 }
    END { for (i = 1; i <= n; i++) print m, id[i], ((i in ok) ? "mapped" : "NOT MAPPED") }' "/proc/self/$m"
done
```

- **Expected:** every ID `mapped`, and G12 without `name=userns`.
  - UIDs: Grafana 472, Alloy 473, Tempo and Loki 10001, Prometheus and the proxy 65534.
  - GIDs: Grafana's 0, Alloy 473, Tempo 10001, the proxy's socket group and 65534.
- **STOP** on `NOT MAPPED`, or with user-namespace remapping.
- **Next allowed action:** none in S6. The mapping belongs to the provider's LXC configuration, and
  remapping to Docker's; either needs a separate decision.
- **What it does not show:** that the processes run as these IDs. V11 shows that after the start.

### G8. U10: modes after the extraction

**VPS, read-only, as `deploy`:**

```bash
cd /var/nimuairy-observability
find . -printf '%M %u:%g %p\n' | sort -k3
echo "-- not readable by the containers' users (expect nothing):"
find observability -path observability/secrets -prune -o -path observability/.env -prune -o \( -type f ! -perm -0004 -o -type d ! -perm -0005 \) -print
echo "-- not owned by deploy (expect nothing):"
find . ! -user deploy -print
```

- **Expected:**
  - the configuration files `-rw-r--r--`, the directories `drwxr-xr-x`, the script
    `-rwxr-xr-x` (the guide's `umask 022`);
  - `observability/secrets` `drwx------`, the secret `-rw-r--r--`;
  - everything owned by `deploy`; both check lists empty.
- **Why:** the containers bind-mount their configuration files and Grafana's provisioning
  directory with the host's modes, and read them as their non-root users.
- **STOP** on any listed entry.
- **Next allowed action:** extract the archive again under `umask 022` (C2). Never `chmod` a tracked
  file by hand.

### G9. U12: public IPv6 and the firewall

- **Command:** P8.
- **The stack itself adds no IPv6 exposure:** its one binding is `127.0.0.1:3000` (G4, later P-R1).
- **Expected (PASS):** no global IPv6 address; or one exists, and UFW is active with `IPV6=yes`,
  default deny incoming and only the SSH rule ([VPS_FIREWALL.md, Policy](VPS_FIREWALL.md#policy)).
- **STOP, as INCONCLUSIVE or FAIL:** a global IPv6 address with UFW inactive, without `IPV6=yes` or with
  other inbound rules; or an IPv6 wildcard listener the operator cannot account for.
  - That is a gap on the host that predates S6.
  - D7 decides whether S6 goes ahead with the gap recorded, or the firewall is fixed first in a
    separate change.
- **Next allowed action:** on PASS, the next gate; otherwise D7, and C5 only after it (§4.1).

### G10. Disk space

**VPS, read-only:**

```bash
d=$(docker info -f '{{.DockerRootDir}}') && df -hT "$d" && echo "available MiB: $(df -B1M --output=avail "$d" | tail -n 1)"
```

- **Expected:** at least 10240 MiB available (proposed threshold, D3).
- **Why 10 GiB:** the stack's images took about 3.2 GB locally [LOCAL, 2026-11-02]; on top of that
  come the volumes, the container logs without rotation, and the old images each update leaves
  ([Budget, Risks](VPS_RESOURCE_BUDGET.md#risks)).
- **STOP** below the threshold.
- **Next allowed action:** a separate decision about what may be removed, or about a different
  threshold. Nothing is removed to make space within S6.

### G11. Timing, freeze, self-test and the running pre-start sampler

- **When:** after C5 (§4.1, step 6). The setup of §10.3 has run under C5 by then:
  - the sampler and the readout are saved;
  - the self-test has run;
  - R0 has had its first reading;
  - the pre-start sampler has started.
- **Command:**
  - **Local:** `gh run list --workflow release.yml --limit 5`, or GitHub's Actions view.
  - **VPS, read-only:** `date` for the VPS's local time.
  - **VPS, read-only,** after at least 1 min of sampling: §10.3's readout wrapper,
    `s6_readout ~/s6-sample-<UTC>.log <PID> 60 "$pre"`.
- **Expected:**
  - no release run in progress, and none planned until the window of §10.3 ends;
  - the time outside 03:00–04:00;
  - R0 recorded;
  - the self-test `ok` three times;
  - the wrapper's `PASS`: the sampler runs, writes complete samples, and samples exactly the root
    and the four application containers.
- **Timing:** the pull starts at least 30 min after the pre-start sampler (G13a), and the first
  `up` when the operator can watch the VPS for at least an hour. Neither falls within 03:00–04:00
  of the VPS's time zone (P1), the window of the daily backup.
- **Release freeze (D4):** no `release.yml` run from the start of the pre-start sampler to the end
  of the sampling window of §10.3. No other manual operation on the application in that time.
- **STOP** if a release is running or planned in that time, if the self-test fails, or if the
  wrapper does not print `PASS`.
- **Next allowed action:**
  - **a release:** choose another time, after the release has finished and its own checks have
    passed;
  - **a failed self-test:** the VPS's awk does not run the readout as tested. No readout result
    counts, and the readout's compatibility is a repository question (§11);
  - **a sampler that does not pass:** find the cause (§11), start a new sampler, and run G11 again.

### G12. Docker engine and cgroup preconditions

**VPS, read-only:**

```bash
i=$(docker info --format 'cgroup={{.CgroupVersion}}/{{.CgroupDriver}} memlimit={{.MemoryLimit}} swaplimit={{.SwapLimit}} pidslimit={{.PidsLimit}}')
if [ "$i" = 'cgroup=2/systemd memlimit=true swaplimit=true pidslimit=true' ]; then echo "ok:   $i"; else echo "STOP: $i"; fi
s=$(docker info --format '{{json .SecurityOptions}}')
case $s in
  *name=userns*) echo "STOP: user-namespace remapping: $s" ;;
  '' | null) echo "STOP: no security options read" ;;
  *) echo "ok:   no user-namespace remapping: $s" ;;
esac
for c in postgres-nimuairy backend-nimuairy frontend-nimuairy cloudflared-nimuairy; do
  pid=$(docker inspect -f '{{.State.Pid}}' "$c")
  path=$(sed -n 's/^0:://p' "/proc/$pid/cgroup")
  unit=${path##*/}
  case $unit in
    docker-*.scope)
      d=$(systemctl show -p Delegate --value "$unit")
      o=$(systemctl show -p OOMPolicy --value "$unit")
      if [ "$d $o" = "yes continue" ]; then r=ok; else r=STOP; fi
      echo "$r: $c in $unit; Delegate=$d OOMPolicy=$o"
      ;;
    *) echo "STOP: $c is not in a systemd scope: '$path'" ;;
  esac
done
```

- **Expected:** only `ok` lines: the engine line `cgroup=2/systemd memlimit=true swaplimit=true
  pidslimit=true`, no user-namespace remapping, and one line per application container in a
  `docker-<id>.scope`, with `Delegate=yes OOMPolicy=continue`, as S4.4.4 read them.
- **Why it is required:** R1 checks each container's systemd scope (`Delegate`, `OOMPolicy`), and
  the sampler resolves each container's cgroup v2 path from the `0::` line of `/proc/<pid>/cgroup`.
  With cgroup v1 or the `cgroupfs` driver both fail, and the conditions of
  [S4.4 §8](S4.4_DESIGN_CONTRACT.md#8-oom-behaviour-and-oom_score_adj-h2) would need another
  verification.
- **STOP** on any other value. S6 does not adapt its checks to another driver.
- **Next allowed action:** a separate design for that configuration. Changing Docker's cgroup
  driver is a daemon change that affects the application, and is not part of S6.

### G13. Resources before the pull (G13a) and before the first `up` (G13b)

**Why a gate.** The ten limits overcommit the visible memory by design (§10.3), the effective
outer limit T is not verified, and the first start's peak has never been measured on the VPS. So
the pull and the first start each begin only when the VPS shows, right before, enough headroom, no
memory stall and no OOM or PID event.

**Why twice.** The pull is a load of its own, next to the running application, on one CPU: the
download, the decompression, page cache and disk writes. A gate that passed before it says nothing
about it. So G13a decides the pull, and G13b decides the `up` on samples that include the pull.

**What both read:**
- **the pre-start sampler's log** (§10.3, R2), through the readout wrapper:
  `s6_readout ~/s6-sample-<UTC>.log <PID> 1800 "$pre"`. It reports:
  - the root's highest `anon + shmem + kernel + sock`, its lowest `MemAvailable` and its memory
    stall time;
  - each application container's highest working set and `pids.current`.

  For G13a the log covers at least 30 min before the pull. For G13b it is the same log, now longer:
  the 30 min and the pull. The sampler runs throughout;
- **R0's event counters** (§10.3), with R1's loop for the four application containers and its root
  lines. They are read when the sampler starts, again for G13a, and again for G13b;
- **P3's two commands** again: state, health, `RestartCount`, `OOMKilled`;
- **the memory size and limits:** `grep -F MemTotal /proc/meminfo`, and the root's `memory.max` and
  `memory.high`;
- **for G13b only, R-p:** the pull's own memory stall, from the readings that S6.4's pull block
  takes right before and right after the pull.

**PASS needs every condition**, for G13a and again for G13b. The thresholds are proposed (D3).

| # | Condition | G13a not met | G13b not met |
|---|---|---|---|
| R-a | The wrapper prints `PASS`: `COVERAGE PASS` for exactly the root and the four application containers, with the sampler running before and after the readout | INCONCLUSIVE | INCONCLUSIVE, and no `up` (Next allowed action) |
| R-b | `MemTotal` is `4456448 kB` (4352 MiB, the plan's size), and the root's `memory.max` and `memory.high` are `max` | STOP: the budget's premise changed | STOP |
| R-c | Every `oom` and `oom_kill` in `memory.events` and `memory.events.local`, at the root and in the four application containers, is 0, and so is `pids.events max`, at every reading | STOP | STOP |
| R-d | The four application containers run, are healthy where they have a health check, and have the same `RestartCount` as at P3, and `OOMKilled` false | STOP | STOP |
| R-e | Each application container's highest working set is at most half its limit (backend 896 MiB, postgres 256, frontend 64, cloudflared 128), and its highest `pids.current` at most half its PID limit (512, 128, 64, 64) | STOP: the application is not in the state S4.4.4 measured | STOP |
| R-f | The root's memory stall time over the samples: `full` 0 µs, and `some` at most 0.1 % of the time covered | INCONCLUSIVE; a second G13a at another time that again misses it: STOP | STOP |
| R-g | The root's highest `anon + shmem + kernel + sock` at most **2064 MiB**, and its lowest `MemAvailable` at least **2288 MiB** | STOP | STOP |
| R-p | The pull's own stall, from S6.4's readings: `full` 0 µs, and `some` at most 0.1 % of the pull's duration | — | STOP |

- **Why G13b only stops.** In G13a, a miss of R-a or R-f can be measured again later. In G13b it
  cannot: the pull is over, and the samples taken during it are the only evidence of its load.
- **Why R-p besides R-f.** R-f divides the stall time by the whole log's time, at least 30 min
  more than the pull. A stall during a short pull could pass it. R-p divides by the pull's own time.
- **The `up` follows G13b within 15 min** (C3b). After that, G13b runs again on the same, longer log
  before a new C3b.

**Where R-g's values come from** [ESTIMATE]:
- They are T − R − A and R + A, with T = 4352 MiB (visible), R = 1088 MiB (the 25 % reserve) and
  A = 1200 MiB, an allowance for the stack's own memory after its start.
- A is about twice the highest observability maximum of the local runs, 579 MiB of
  `anon + shmem + kernel` ([Local measurements](VPS_RESOURCE_BUDGET.md#local-measurements)). Local
  values are no forecast for the VPS (one CPU, other sizing), which is why A doubles them, as the
  budget's 2× rule does for limits.
- **Not M5 reused.** M5 (§10.3, R4) bounds the combined state with the stack running. Before the
  start the stack's share is absent, so the same bound would let the baseline consume it. G13
  keeps A free on top of the reserve.
- **Σ limits is not used as demand.** With A = 3008 MiB, the stack's limits, R-g would need a
  baseline of at most 256 MiB. The backend's `anon` alone reached 317.62 MiB in S4.4.4's sampling
  [VPS], so no baseline could pass (D3).

**T and LXCFS are not verified, and the gate says what that means.**
- R-g's values rest on the visible 4352 MiB. If the effective outer limit is lower, the real
  headroom is smaller by an unknown amount. No reading inside the LXC shows that limit
  ([Budget, After the upgrade](VPS_RESOURCE_BUDGET.md#after-the-upgrade)).
- `MemAvailable` is LXCFS's figure, whose computation inside the LXC is not verified. R-g uses it
  only together with the cgroup's own counters.
- **Memory pressure is the one visible sign that could reveal a lower limit.** When a limit at any
  level forces tasks into direct reclaim or throttles them, the time they stall counts in the
  memory pressure of their cgroups, the visible root included [S, the kernel's PSI documentation;
  not observed on this host]. Background reclaim stalls no task, so the sign is incomplete. That is
  why R-f requires nearly no stall, and why a stall makes the gate INCONCLUSIVE even when R-g
  passes.

**INCONCLUSIVE** blocks the next consent like a STOP: C3a after G13a, C3b after G13b.

**Next allowed action:**
- **G13a PASS:** C3a, then the pull of S6.4, step 4.
- **G13a INCONCLUSIVE:** an incomplete or failed readout, a sampler not running, or R-f's first
  miss. Measure again at another time; a sampler that stopped is replaced and gets its 30 min
  again.
- **G13b PASS:** C3b, then the first `up` within 15 min.
- **G13b INCONCLUSIVE:** the pull's samples are incomplete, so its load is unknown, and no `up`
  follows. The images are on disk now, and a new window would no longer contain a pull. How to go on
  is the operator's recorded decision: remove the six pulled images by name and repeat from G13a,
  or accept a new G13b over 30 min without a pull.
- **STOP, in either:** no pull or no first start. The finding goes to a review of the budget (D3) or
  of the application's state, in a separate step.

## 9. S6.4 — First startup

**Consents:** C3a for the pull (step 4), C3b for the first `up` (step 6), each after its gate.
**Where:** `/var/nimuairy-observability`, as `deploy`.

**Rules:**
- exactly `-f observability/compose.yaml -f observability/compose.prod.yaml`;
- never `observability/compose.test.yaml`, `-p` or `COMPOSE_PROJECT_NAME`;
- no added host port, no network change, no limit change, no deferred work;
- no `--force-recreate` and no `down`.

**Steps:**

1. **The revision.** `cat REVISION` names the SHA of S6.2.
2. **G1 to G3 again**, immediately before. Any `STOP` ends S6.4 here.
3. **G13a**, on at least 30 min of the pre-start sampler. G11 started it, and it keeps running
   through the pull and the start. Anything but PASS ends S6.4 here.
4. **C3a, then the pull.** **VPS, changes runtime state** (images only). The block reads the root's
   memory stall totals right before and right after the pull, for G13b's R-p. It pulls nothing if
   the first reading fails:

   ```bash
   cd /var/nimuairy-observability
   # The root's memory stall totals as "<epoch> <some us> <full us>", or a failure.
   stall() {
     awk -v t="$(date -u +%s)" '$1 == "some" || $1 == "full" { for (i = 2; i <= NF; i++) if ($i ~ /^total=[0-9]+$/) v[$1] = substr($i, 7) }
       END { if (("some" in v) && ("full" in v)) print t, v["some"], v["full"]; else exit 1 }' /sys/fs/cgroup/memory.pressure
   }
   if ! s0=$(stall); then
     echo "STOP: the root's memory pressure cannot be read; no pull"
   else
     echo "the pull starts at $(date -u +%FT%TZ)"
     docker compose -f observability/compose.yaml -f observability/compose.prod.yaml pull
     rc=$?
     if [ "$rc" -ne 0 ]; then
       echo "STOP: the pull failed with exit status $rc"
     elif ! s1=$(stall); then
       echo "STOP: the root's memory pressure cannot be read after the pull"
     else
       read -r t0 some0 full0 <<<"$s0"
       read -r t1 some1 full1 <<<"$s1"
       echo "the pull took $((t1 - t0)) s; memory stall during it: some $((some1 - some0)) us, full $((full1 - full0)) us"
       if [ $((full1 - full0)) -eq 0 ] && [ $((some1 - some0)) -le $(((t1 - t0) * 1000)) ]; then
         echo "ok: R-p met: no full stall, and some for at most 0.1 % of the pull's time"
       else
         echo "STOP: R-p not met"
       fi
     fi
   fi
   ```

   Then, **VPS, read-only:**

   ```bash
   docker image inspect -f '{{index .RepoTags 0}} {{index .RepoDigests 0}} {{.Size}}' \
     prom/prometheus:v3.15.0 grafana/loki:3.7.8 grafana/tempo:3.1.0 grafana/alloy:v1.20.1 \
     wollomatic/socket-proxy:1.13.2 grafana/grafana-oss:13.0.2
   d=$(docker info -f '{{.DockerRootDir}}') && df -hT "$d"
   ```

   - **Expected:** `ok: R-p met`, six digests recorded, and the disk still above G10's threshold.
   - **Any `STOP` line** ends S6.4 here: no G13b, no `up`.
   - The tags are those of `ff0139a`'s `observability/compose.yaml`. An archive from another commit
     names its own.
   - Pulling first keeps the download out of `up`'s wait, shows the disk use on its own, and lets
     G13b judge the pull's load before the start.
5. **G13b**, right after the pull: the same readout on the same, longer log, R0's counters again,
   P3 again, and R-p from step 4. Anything but PASS ends S6.4 here. On PASS, the operator gives C3b
   for an `up` that starts within 15 min.
6. **C3b, then the first start.** **VPS, changes runtime state.** It starts within 15 min of G13b's
   reading; otherwise G13b runs again first. Record the time first; V3 compares the volumes with it:

   ```bash
   cd /var/nimuairy-observability
   t_up=$(date -u +%FT%TZ); echo "t_up=$t_up"
   docker compose -f observability/compose.yaml -f observability/compose.prod.yaml up -d --wait --wait-timeout 180; echo "up exit=$? at $(date -u +%FT%TZ)"
   ```

   It creates the three networks, the five volumes and the six containers.
7. **Readiness, one service at a time.** **VPS, read-only.** Loki reports ready only about 15 s
   after it starts, so repeat a failed check for up to 2 minutes before reading it as a failure:

   ```bash
   docker inspect -f '{{.Name}} {{.State.Status}}{{if .State.Health}} {{.State.Health.Status}}{{end}} restarts={{.RestartCount}} oomkilled={{.State.OOMKilled}} started={{.State.StartedAt}}' prometheus loki tempo alloy docker-socket-proxy grafana
   docker exec prometheus wget -qO- http://localhost:9090/-/ready; echo " prometheus exit=$?"
   docker exec prometheus wget -qO- http://loki:3100/ready; echo " loki exit=$?"
   docker exec prometheus wget -qO- http://tempo:3200/ready; echo " tempo exit=$?"
   docker exec prometheus wget -qO- http://alloy:12345/-/ready; echo " alloy exit=$?"
   docker exec grafana wget -qO- http://localhost:3000/api/health; echo " grafana exit=$?"
   ```

8. **Targeted logs.** **VPS, read-only.** Only after step 7 showed all six containers, so that a
   missing container cannot look like a clean log:

   ```bash
   docker logs grafana 2>&1 | grep -F 'FATAL:'
   docker logs tempo 2>&1 | grep -F 'permission denied'
   docker logs docker-socket-proxy 2>&1 | grep -E 'socket not available|permission denied|blocked request'
   docker logs alloy 2>&1 | grep -E 'Unable to refresh target groups|permission denied|error writing positions file'
   docker logs loki 2>&1 | grep -F 'level=error' | head -5
   docker logs prometheus 2>&1 | grep -F 'level=ERROR' | head -5
   ```

   - **Expected:** nothing from the first four.
   - **Benign** ([Troubleshooting](OBSERVABILITY_PRODUCTION.md#troubleshooting)): Loki's one
     `empty ring` error at start; Prometheus's note that `native-histograms` is a no-op; Grafana's
     deprecation of `GF_FEATURE_TOGGLES_ENABLE` and its errors for unused provisioning directories
     and a bundled plugin; Tempo's warning about the metrics generator and its
     `error calling scheduler … no jobs found` about once a minute.

**Why `up --wait` is not enough.**
- `--wait` waits until every container runs and those with a health check are healthy: Prometheus,
  Grafana and the proxy.
- Loki, Tempo and Alloy have no health check. `--wait` accepts them as soon as their process runs,
  even in a restart loop. S4b's N7 saw `up -d --wait` exit 0 while Tempo looped on
  `permission denied` ([S4b §7.3](S4b_DESIGN_CONTRACT.md#73-volumes)).
- A proxy that is healthy can open the socket; that does not show that its API answers Alloy
  ([OBSERVABILITY.md, Docker API access](OBSERVABILITY.md#docker-api-access)).
- So only steps 7 and 8, and then S6.5, decide whether the start worked.

**Outcome.** `up` exit 0, every container running, the three health checks healthy, the five
readiness checks answering, and no line from the first four log checks: go on to S6.5. Anything else:
S6.6, and no further S6.4 command.

## 10. S6.5 — Post-start verification

### 10.1 Checklist

Read-only unless marked. Record each result, with the time, in the S6 record.

| # | Check | Command | Expected |
|---|---|---|---|
| V1 | Six services, state, restarts, OOM | The `docker inspect` template of S6.4, step 7 | All `running`; Prometheus, Grafana and the proxy `healthy`; `restarts=0`; `oomkilled=false`; every `started` after `t_up` |
| V2 | Readiness | S6.4, step 7, again after at least 5 min | Every check answers. Health is not readiness: Grafana `healthy` says nothing about its data sources (V7) |
| V3 | The volumes are new | Block V3 below | Five volumes, each `created` after `t_up`, with the project label. Without this, P-R4 and the Tempo checks could pass on pre-existing state |
| V4 | Networks | Block V4 below | The three networks with the project label; `nimuairy-observability_docker-api` `internal=true` |
| V5 | Bindings | `docker ps --format '{{.Names}}\t{{.Ports}}'`; `docker port grafana`; `ss -Hltn` | Only Grafana shows a `->`: `127.0.0.1:3000->3000/tcp`. `docker port grafana` prints exactly `3000/tcp -> 127.0.0.1:3000`. The `ss` lines are information |
| V6 | The production check, once (C4) | §10.2 | `All checks passed` |
| V7 | Grafana through the tunnel, and its data sources | Block V7 below | Login works; Prometheus, Loki and Tempo answer `OK` |
| V8 | Prometheus targets | Block V8 below | `prometheus` and `alloy` `up`; `nimuairy-api` `down`, by design until S7: the backend is on no network of the stack, so its `lastError` most likely names a failed lookup |
| V9 | Alloy's discovery path | Block V9 below | Alloy running for at least 5 min; no `Unable to refresh target groups`; no `blocked request` from Alloy's address |
| V10 | The socket proxy | `docker inspect -f '{{.State.Status}} {{.State.Health.Status}} restarts={{.RestartCount}}' docker-socket-proxy`; its log as in S6.4, step 8 | `running healthy restarts=0`; no `socket not available`, no `blocked request` at all |
| V11 | U9 at runtime: the processes' identities | Block V11 below | Every line `ok`: the real, effective, saved and file-system UIDs and GIDs as expected; no container but the proxy in the socket's group; `NoNewPrivs` 1 for Alloy and the proxy |
| V12 | Volume ownership and placement | Block V12 below | Mounts as listed; `tempo-data` only `10001:10001`, `alloy-data` only `473:473`; the others recorded |
| V13 | Limits and OOM settings of all ten containers | §10.3, R1 | Every line `ok` |
| V14 | Disk and container logs | Block V14 below | Recorded as the window's starting values |
| V15 | Optional: Alloy's UI through a tunnel; an external IPv6 probe | Block V15 below | Recorded; not required for acceptance |
| V16 | The application is unaffected | P3's two commands; `curl -fsS -o /dev/null -w '%{http_code}\n' --max-time 30 '<smoke-url>'` | Four containers healthy, `restarts` unchanged since P3, status below 400 |

**V3, volumes. VPS, read-only:**

```bash
for v in prom-data loki-data tempo-data grafana-data alloy-data; do
  docker volume inspect -f '{{.Name}} created={{.CreatedAt}} project={{index .Labels "com.docker.compose.project"}}' "nimuairy-observability_$v"
done
```

**V4, networks. VPS, read-only:**

```bash
docker network inspect -f '{{.Name}} driver={{.Driver}} internal={{.Internal}} project={{index .Labels "com.docker.compose.project"}}' \
  nimuairy-observability nimuairy-observability_stack nimuairy-observability_docker-api
```

**V7, Grafana.** After V6, so that the check's one failed login comes first and alone.
1. **Local:** the tunnel of [Accessing Grafana](OBSERVABILITY_PRODUCTION.md#accessing-grafana), on
   local port 13000, as the account D2 chose.
2. Open <http://127.0.0.1:13000>, log in as `admin` with the password pasted from the password
   manager. A mistyped password is one more failed login.
3. Connections → Data sources: run the test of Prometheus, Loki and Tempo.
4. Record whether the tunnel's local port 13000 has side effects: a link that Grafana builds as
   absolute, such as a share link, points at its default `http://localhost:3000/`.

The same data source health from the VPS, as `deploy`, without printing the password:

```bash
{ set +x; } 2>/dev/null
cd /var/nimuairy-observability
for ds in prometheus loki tempo; do
  printf 'user = "admin:%s"\n' "$(< observability/secrets/grafana_admin_password)" |
    curl -K - -sS --max-time 10 "http://127.0.0.1:3000/api/datasources/uid/$ds/health" | grep -oE '"status":"[A-Z]+"' | sed "s/^/$ds /"
done
```

`printf` is a builtin, so the password is in no process's arguments; curl reads it from stdin, as
the production check does. Each data source must print `"status":"OK"`. The first line turns xtrace
off: under it, Bash would print `printf`'s expanded argument, the password, once per data source.

**V8, Prometheus targets. VPS, read-only:**

```bash
docker exec prometheus wget -qO- 'http://localhost:9090/api/v1/targets?state=active' | grep -oE '"scrapePool":"[^"]*"|"lastError":"[^"]*"|"health":"[^"]*"'
```

**V9, Alloy's discovery path. VPS, read-only:**

```bash
docker inspect -f 'alloy started={{.State.StartedAt}} restarts={{.RestartCount}}' alloy
ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "nimuairy-observability_docker-api").IPAddress}}' alloy); echo "alloy on docker-api: $ip"
if l=$(docker logs alloy 2>&1); then
  echo "alloy log lines: $(grep -c . <<<"$l"); discovery errors: $(grep -F 'msg="Unable to refresh target groups"' <<<"$l" | grep -cF 'component_id=discovery.docker.containers')"
else
  echo "STOP: docker logs alloy failed"
fi
if p=$(docker logs docker-socket-proxy 2>&1); then
  echo "blocked requests: $(grep -cF 'msg="blocked request"' <<<"$p"); from Alloy: $(grep -F 'msg="blocked request"' <<<"$p" | grep -cF "client=$ip:")"
else
  echo "STOP: docker logs docker-socket-proxy failed"
fi
```

- **Expected:** a non-zero number of log lines, 0 discovery errors, 0 blocked requests.
- **What it shows.** `discovery.docker` asks the Docker API through the proxy every 5 s, also when
  no container carries the label. A failed refresh logs `Unable to refresh target groups`; CI's
  outage check sees that line during its outage, which is the positive control
  (`scripts/observability-proxy-resilience-check.sh`). Without the line over at least 5 min, the
  refreshes succeeded.
- **What it does not show: log collection.** No container on the VPS is labelled
  `observability.logs=true` until S7
  ([What is monitored](OBSERVABILITY_PRODUCTION.md#what-is-monitored-and-what-is-not)). Alloy tails
  nothing, and no log line reaches Loki. That path is S7's to verify.

**V11, process identities. VPS, read-only:**

```bash
g=$(stat -c %g /var/run/docker.sock)
idcheck() { if [ "$2" = "$3" ]; then printf '  ok       %-13s %s\n' "$1" "$2"; else printf '  MISMATCH %-13s %s (expected %s)\n' "$1" "$2" "$3"; fi; }
while read -r c uid gid nnp; do
  if ! pid=$(docker inspect -f '{{.State.Pid}}' "$c") || [ "$pid" = 0 ] || ! st=$(<"/proc/$pid/status"); then
    echo "== $c: MISMATCH, no process to read"
    continue
  fi
  u=$(awk '$1 == "Uid:" { print $2, $3, $4, $5 }' <<<"$st")
  gs=$(awk '$1 == "Gid:" { print $2, $3, $4, $5 }' <<<"$st")
  groups=$(awk '$1 == "Groups:" { $1 = ""; sub(/^ +/, ""); print }' <<<"$st")
  n=$(awk '$1 == "NoNewPrivs:" { print $2 }' <<<"$st")
  echo "== $c: Uid $u; Gid $gs; Groups ${groups:-none}; NoNewPrivs $n"
  idcheck Uid "$u" "$uid $uid $uid $uid"
  if [ "$gid" = image ]; then gid=${gs%% *}; fi
  idcheck Gid "$gs" "$gid $gid $gid $gid"
  sock=no
  for x in ${gs%% *} $groups; do if [ "$x" = "$g" ]; then sock=yes; fi; done
  if [ "$c" = docker-socket-proxy ]; then idcheck socket-group "$sock" yes; else idcheck socket-group "$sock" no; fi
  if [ "$nnp" != - ]; then idcheck NoNewPrivs "$n" "$nnp"; fi
done <<EOF
prometheus 65534 image -
loki 10001 image -
tempo 10001 10001 -
alloy 473 473 1
docker-socket-proxy 65534 $g 1
grafana 472 image -
EOF
```

- **The four fields** of `Uid:` and `Gid:` are the real, effective, saved and file-system IDs. Each
  must be the expected ID in all four; a difference would mean a set-ID switch inside the process.
- **The expected IDs:** the users set in the base file (Tempo `10001:10001`, Alloy `473:473`, the
  proxy `65534:<socket group>`) in full; for Prometheus, Loki and Grafana their images' users
  (`nobody` = 65534, 10001, 472 [LOCAL, S4b Appendix A]). Their images' groups are not recorded in
  the repository, so the block requires all four GIDs to be equal and prints the group for the
  record.
- **The socket's group** gives access to the Docker socket's file. Only the proxy may have it, as
  its primary group. A container that has it in any other way is a MISMATCH, even if the socket is
  not mounted there.
- **`NoNewPrivs` 1** for Alloy and the proxy, which set `no-new-privileges`. For the other four it is
  printed for the record; the setting is deferred (B7).
- The IDs are those in the LXC's namespace, which G7 found mapped.

**V12, mounts and volume ownership.** The mounts, **VPS, read-only:**

```bash
docker inspect -f '{{.Name}}{{range .Mounts}} {{.Type}}:{{if eq .Type "volume"}}{{.Name}}{{else}}{{.Source}}{{end}}->{{.Destination}}{{if not .RW}}(ro){{end}}{{end}}' \
  prometheus loki tempo alloy docker-socket-proxy grafana
```

- Expected: each service's configuration as a read-only bind mount and its volume read-write;
  Grafana also `bind:/var/nimuairy-observability/observability/secrets/grafana_admin_password->/run/secrets/grafana_admin_password(ro)`;
  the proxy `bind:/var/run/docker.sock->/var/run/docker.sock(ro)`.
- The data lives on the named volumes, which survive a recreate. The VPS's first recreate is the
  first ordinary update; S6 forces none. CI's P-V1 showed the survival across a recreate [CI, #348].

The owners, **admin, read-only** (`/var/lib/docker` is readable only by root):

```bash
for v in prom-data loki-data tempo-data grafana-data alloy-data; do
  n=nimuairy-observability_$v
  if m=$(docker volume inspect -f '{{.Mountpoint}}' "$n") && l=$(sudo find "$m" -printf '%U:%G\n'); then
    echo "$n: $(grep -c . <<<"$l") entries; owners: $(sort <<<"$l" | uniq -c | tr -s ' ' | tr '\n' ',')"
  else
    echo "STOP: cannot list $n"
  fi
done
```

- Expected: `tempo-data` only `10001:10001` (B5, as the smoke test's T-4), `alloy-data` only
  `473:473` (S4.2). The others carry their images' owners; record them.
- A count that includes the root entry shows that `find` ran.

**V14, disk and logs.** **VPS, read-only**; the loop needs `sudo`:

```bash
df -hT /
docker system df
docker system df -v | sed -n '/^Local Volumes space usage:/,/^$/p' | grep -E 'VOLUME NAME|nimuairy-observability'
docker inspect -f '{{.Name}} {{.HostConfig.LogConfig.Type}} {{json .HostConfig.LogConfig.Config}}' prometheus loki tempo alloy docker-socket-proxy grafana
for c in prometheus loki tempo alloy docker-socket-proxy grafana; do
  p=$(docker inspect -f '{{.LogPath}}' "$c") && echo "$c log bytes: $(sudo du -b "$p" | cut -f1)"
done
```

Expected: `json-file {}`, no rotation, as recorded before (D5).

**V15, optional.**
- **Alloy's UI:** the guide's
  [Optional: Alloy's UI through an SSH tunnel](OBSERVABILITY_PRODUCTION.md#optional-alloys-ui-through-an-ssh-tunnel).
  Record whether it works. If it does not, the procedure stays unconfirmed and the guide's
  fallbacks apply. No port is published for it.
- **External IPv6 probe,** only with a global IPv6 address (P8) and a client with IPv6, **Local:**
  `curl -sS -m 10 -o /dev/null -w '%{http_code}\n' -g 'http://[<vps-ipv6>]:3000/'`.
  - Expected: a connection failure, never an HTTP status.
  - Use the address literal: a name that does not resolve proves nothing.
  - An IPv4 probe proves nothing here: the provider maps only SSH to the VPS
    ([VPS_FIREWALL.md](VPS_FIREWALL.md)).

### 10.2 The production check (V6)

**Consent:** C4, for **one** run.

**VPS, changes no container, but logs in to Grafana:**

```bash
{ set +x; } 2>/dev/null
cd /var/nimuairy-observability
date -u +%FT%TZ
env -u GRAFANA_AUTH -u OBSERVABILITY_COMPOSE_FILES -u SHELLOPTS -u BASH_ENV bash scripts/observability-prod-check.sh runtime; echo "exit=$? at $(date -u +%FT%TZ)"
```

- **Preconditions:** V1 to V5 passed; nobody has logged in to Grafana yet, so the check's failed
  login is the only one.
- **No inherited trace.** The check reads the password into a variable and hands it to `curl` with
  `printf`, so a trace would print it. A child Bash does not inherit `set -x` as such, but it starts
  with xtrace on when `SHELLOPTS` holds `xtrace` in the environment, or when `BASH_ENV` names a file
  that turns it on.
  - `env -u SHELLOPTS -u BASH_ENV` removes both, and `{ set +x; }` turns the parent's trace off.
  - Tested with the repository's script, a fake `docker` and a dummy password, with both variants
    set in the parent. Revision 3's command printed the password 4 times in each; this one printed
    it in neither.
- **Expected:** every line `ok` or `info`, `All checks passed`, exit 0:
  - P-R1: the bindings are exactly `{grafana 127.0.0.1:3000->3000/tcp}`, and no container uses the
    host network;
  - P-R2: 9090, 3100, 3200, 4317, 4318 and 12345 on `127.0.0.1` refuse connections; 3000 connects,
    and `/api/health` answers `200`;
  - P-R3: no `GF_SECURITY_ADMIN_PASSWORD` in Grafana's `Config.Env`, its `__FILE` variable once;
  - P-R4: the configured login `200`; `admin:admin` `401`; the anonymous requests `401`.
- **What the run does to Grafana, recorded with its time:**
  - one successful login as `admin` with the file's password;
  - **one failed login, `admin:admin`;**
  - three anonymous requests, which Grafana refuses.
- **No repeat without a named reason.** A failed check is analysed from its output first. Grafana
  limits failed logins per user, and the threshold and lockout time for this configuration are not
  known ([Deliberate: the production check](OBSERVABILITY_PRODUCTION.md#deliberate-the-production-check)).
  A second run needs its own consent.
- **What P-R4 shows here:** the database holds the file's password. That is evidence only because V3
  showed that `grafana-data` is new.

### 10.3 Resources

**Basis.**
- **Σ limits is not the demand.** The ten limits add up to 5696 MiB (stack 3008, application 2688),
  a deliberate overcommit against T = 4352 MiB
  ([Container limits](VPS_RESOURCE_BUDGET.md#container-limits)).
- **What must fit** is the simultaneous peak `H + P + O + K + R`
  ([Budget model](VPS_RESOURCE_BUDGET.md#budget-model)).
- **The proposed reserve** R is 20–25 % of T, 870–1088 MiB, which leaves 3264–3482 MiB for
  `H + P + O + K` [ESTIMATE]. The reserve is a recommendation that still needs confirmation (D3).
- **T itself is an inference.** If the effective outer limit is lower, neither the combined fit nor
  OOM safety is guaranteed ([S4.4 §9](S4.4_DESIGN_CONTRACT.md#9-memory-budget)).
- **The application's side is measured**: about 35 h with its limits, without the Java agent
  ([With the app's limits](VPS_RESOURCE_BUDGET.md#with-the-apps-limits-s444)). S6 measures the
  stack (O, idle) and the combined state of the whole LXC.
- **The method is S4.4's** ([§10.4](S4.4_DESIGN_CONTRACT.md#104-vps-the-operator-runs-these-read-only),
  [Appendix A.3](S4.4_DESIGN_CONTRACT.md#a3-after-the-app-rollout-s444)): the kernel has no peak
  files, so cumulative counters are read twice and levels are sampled every 10 s. The highest sample
  is a lower bound of the peak, never the peak. What must not be added together is in the budget's
  [What must not be added together](VPS_RESOURCE_BUDGET.md#what-must-not-be-added-together).

**R0, the baseline before the pull (G11, G13a, G13b).** **VPS, read-only:** P4's blocks, and the R1
loop below with only its four application lines, and its root lines. Run it when the pre-start
sampler starts (§4.1, step 5), again for G13a, and again for G13b. R-c compares every reading.

**R1, after the start (V13).** **VPS, read-only.** A.3's loop, extended to all ten containers, with
the expected values and a comparison:

```bash
date -u
check() { if [ "$2" = "$3" ]; then printf '  ok       %-22s %s\n' "$1" "$2"; else printf '  MISMATCH %-22s %s (expected %s)\n' "$1" "$2" "$3"; fi; }
while read -r c mem pids adj; do
  pid=$(docker inspect -f '{{.State.Pid}}' "$c" 2>/dev/null)
  if [ -z "$pid" ] || [ "$pid" = 0 ]; then echo "== $c: MISMATCH, not running"; continue; fi
  cg=/sys/fs/cgroup$(sed -n 's/^0:://p' "/proc/$pid/cgroup")
  read -r hmem hswap hpids hadj restarts oomkilled < <(docker inspect -f '{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.PidsLimit}} {{.HostConfig.OomScoreAdj}} {{.RestartCount}} {{.State.OOMKilled}}' "$c")
  echo "== $c restarts=$restarts oomkilled=$oomkilled"
  check HostConfig.Memory "$hmem" "$mem"
  check HostConfig.MemorySwap "$hswap" "$mem"
  check HostConfig.PidsLimit "$hpids" "$pids"
  check HostConfig.OomScoreAdj "$hadj" "$adj"
  check memory.max "$(cat "$cg/memory.max")" "$mem"
  check memory.swap.max "$(cat "$cg/memory.swap.max")" 0
  check memory.oom.group "$(cat "$cg/memory.oom.group")" 0
  check pids.max "$(cat "$cg/pids.max")" "$pids"
  check cpu.max "$(cat "$cg/cpu.max")" 'max 100000'
  check oom_score_adj "$(cat "/proc/$pid/oom_score_adj")" "$adj"
  unit=${cg##*/}
  case $unit in
    *.scope)
      check Delegate "$(systemctl show -p Delegate --value "$unit")" yes
      check OOMPolicy "$(systemctl show -p OOMPolicy --value "$unit")" continue
      ;;
    *) echo "  MISMATCH systemd                not a systemd scope: '$unit'" ;;
  esac
  for f in memory.events memory.events.local pids.events cpu.stat cpu.pressure memory.pressure; do
    printf '  %-22s %s\n' "$f" "$(cat "$cg/$f" 2>&1 | tr '\n' ' ')"
  done
  printf '  %-22s %s\n' memory.current "$(cat "$cg/memory.current")" pids.current "$(cat "$cg/pids.current")"
done <<'EOF'
prometheus 536870912 128 500
loki 536870912 256 500
tempo 1073741824 256 500
alloy 402653184 128 500
docker-socket-proxy 67108864 128 500
grafana 536870912 256 500
backend-nimuairy 1879048192 1024 0
postgres-nimuairy 536870912 256 0
frontend-nimuairy 134217728 128 0
cloudflared-nimuairy 268435456 128 0
EOF
for f in memory.events memory.events.local pids.events cpu.pressure memory.pressure; do
  echo "root $f: $(cat "/sys/fs/cgroup/$f" 2>&1 | tr '\n' ' ')"
done
```

- The values are those of `observability/compose.prod.yaml` and `compose.prod.yaml` in bytes:
  512 MiB = 536870912, 1024 MiB = 1073741824, 384 MiB = 402653184, 64 MiB = 67108864,
  1792 MiB = 1879048192, 128 MiB = 134217728, 256 MiB = 268435456.
- **Expected:** every line `ok`; every `oom` and `oom_kill` 0; `pids.events max 0`.
- `Delegate=yes` and `OOMPolicy=continue` with `memory.oom.group` 0 are the conditions under which
  the kernel kills processes, not whole containers
  ([S4.4 §8](S4.4_DESIGN_CONTRACT.md#8-oom-behaviour-and-oom_score_adj-h2)). A.3 read them for the
  application only; this is the first reading for the stack.
- `cpu.stat`'s `usage_usec` and the pressure files' `total=` are cumulative: R3 subtracts R1's values,
  with no sampling. They feed the CPU weights' "Reconsider when"
  ([DEFERRED_WORK, CPU weights](DEFERRED_WORK.md#s44--cpu-weights)).

**R2, sampling (C5).** Two files in `deploy`'s home: the sampler and its readout. **VPS, changes
files** (the two files and the sampler's logs). Both only read the system.

Save as `~/s6-sampler.sh`:

```bash
#!/usr/bin/env bash
# S6's read-only sampler (docs/S6_DESIGN_CONTRACT.md, section 10.3, R2). Every 10 s it reads the
# LXC's visible root cgroup and the cgroups of the containers named as arguments, and appends one
# line per entity to its log:
#   <epoch> <UTC time> <entity> ok <key>=<value> ...   every required value read, and a number
#   <epoch> <UTC time> <entity> INVALID <keys>          a required value unreadable or malformed
# It never writes a partial ok line. It resolves each container's cgroup once, at start: a restart
# keeps the path, a recreate does not, and the reads then fail as INVALID. It starts and changes
# nothing; the readout (s6-readout.awk) rejects any window with an INVALID line.
set -u
out=~/s6-sample-$(date -u +%Y%m%dT%H%M%SZ).log
root=/sys/fs/cgroup
files=(memory.current pids.current)
stat_fields=(anon file shmem inactive_file sock workingset_refault_file pgmajfault)
kernel_parts=(kernel_stack pagetables percpu slab_reclaimable slab_unreclaimable vmalloc)
declare -A cg=([lxc-root]=$root) present=()
order=(lxc-root)
fail() {
  echo "s6-sampler: $*" >&2
  exit 1
}

for c in "$@"; do
  [ -z "${cg[$c]-}" ] || fail "$c is named twice, or is the name of the root"
  pid=$(docker inspect -f '{{.State.Pid}}' "$c") && [[ $pid =~ ^[1-9][0-9]*$ ]] || fail "no running container $c"
  path=$(sed -n 's/^0:://p' "/proc/$pid/cgroup") && [ -n "$path" ] || fail "no cgroup v2 path for $c"
  [ -r "$root$path/memory.stat" ] || fail "cannot read $root$path/memory.stat for $c"
  cg[$c]=$root$path
  order+=("$c")
done

# The kernel-memory fields this kernel provides: the kernel field, or else its parts.
while read -r k _; do present[$k]=1; done <"$root/memory.stat" || fail "cannot read $root/memory.stat"
if [ -n "${present[kernel]-}" ]; then
  kernel=(kernel)
else
  kernel=()
  for f in "${kernel_parts[@]}"; do if [ -n "${present[$f]-}" ]; then kernel+=("$f"); fi; done
  for f in kernel_stack pagetables slab_reclaimable slab_unreclaimable; do
    [ -n "${present[$f]-}" ] || fail "$root/memory.stat has neither kernel nor $f"
  done
fi
for f in "${stat_fields[@]}"; do [ -n "${present[$f]-}" ] || fail "$root/memory.stat has no $f"; done
need=("${stat_fields[@]}" "${kernel[@]}")

# One entity's line, from Bash builtins only. Every value must be a whole number, the pressure
# averages a decimal one.
sample() {
  local e=$1 d=${cg[$1]} f k v kind a10 total line=ok some10= somet= full10= fullt=
  local -A s=()
  local bad=()
  for f in "${files[@]}"; do
    if IFS= read -r v 2>/dev/null <"$d/$f" && [[ $v =~ ^[0-9]+$ ]]; then line+=" $f=$v"; else bad+=("$f"); fi
  done
  if while read -r k v; do s[$k]=$v; done 2>/dev/null <"$d/memory.stat"; then
    for f in "${need[@]}"; do
      if [[ ${s[$f]-} =~ ^[0-9]+$ ]]; then line+=" $f=${s[$f]}"; else bad+=("$f"); fi
    done
  else
    bad+=(memory.stat)
  fi
  if [ "$e" = lxc-root ]; then
    v=
    while read -r k a10 _; do if [ "$k" = MemAvailable: ]; then v=$a10; fi; done 2>/dev/null </proc/meminfo
    if [[ $v =~ ^[0-9]+$ ]]; then line+=" MemAvailable_kB=$v"; else bad+=(MemAvailable); fi
    while read -r kind a10 _ _ total; do
      if [[ $a10 =~ ^avg10=([0-9]+\.[0-9]+)$ ]]; then a10=${BASH_REMATCH[1]}; else a10=; fi
      if [[ $total =~ ^total=([0-9]+)$ ]]; then total=${BASH_REMATCH[1]}; else total=; fi
      case $kind in
        some) some10=$a10 somet=$total ;;
        full) full10=$a10 fullt=$total ;;
      esac
    done 2>/dev/null <"$d/memory.pressure"
    if [ -n "$some10" ] && [ -n "$somet" ] && [ -n "$full10" ] && [ -n "$fullt" ]; then
      line+=" memory_some_avg10=$some10 memory_full_avg10=$full10 memory_some_total=$somet memory_full_total=$fullt"
    else
      bad+=(memory.pressure)
    fi
  fi
  if ((${#bad[@]})); then
    printf '%s %s %s INVALID %s\n' "$epoch" "$now" "$e" "${bad[*]}"
  else
    printf '%s %s %s %s\n' "$epoch" "$now" "$e" "$line"
  fi
}

printf '# s6-sampler 2 start=%s kernel=%s entities=%s\n' "$(date -u +%s)" \
  "$(IFS=,; echo "${kernel[*]}")" "$(IFS=,; echo "${order[*]}")" >>"$out" || fail "cannot write $out"
echo "s6-sampler: sampling ${order[*]} into $out"
trap 'printf "# s6-sampler stopped at %s\n" "$(date -u +%s)" >>"$out"; exit 0' TERM INT
while :; do
  read -r epoch now < <(date -u '+%s %FT%TZ') && [[ $epoch =~ ^[0-9]+$ ]] || fail "date failed"
  for e in "${order[@]}"; do sample "$e"; done >>"$out" || fail "cannot write $out"
  sleep 10
done
```

- **It fails closed.** A line says `ok` only when every required value was read, with Bash builtins,
  and is a whole number; the pressure averages must be decimal numbers. A missing, unreadable or
  malformed value makes the line `INVALID`, with the keys that failed. It never writes a partial
  `ok` line, and never a zero in place of a value it could not read.
- **It refuses to start**, with exit status 1 and no log, when a container is named twice or named
  `lxc-root`, a named container is not running, its cgroup cannot be read, or the root's
  `memory.stat` lacks a field it needs. The log's header records which kernel-memory fields it
  uses (`kernel`, or its parts), and the entities it samples.
- **After its start it calls no `docker`** and starts nothing. It reads the cgroup files,
  `/proc/meminfo` and the root's `memory.pressure`.
- **A stop with `kill <PID>`** (TERM) appends `# s6-sampler stopped at <epoch>`. A `kill -9`, a
  crash or a reboot leaves no such line; the readout detects both cases.
- It needs Bash 4 or later (P10).

Save as `~/s6-readout.awk`:

```awk
# S6's readout of an s6-sampler log (docs/S6_DESIGN_CONTRACT.md, section 10.3, R3). POSIX awk only:
# no gawk extension, no regex interval, no time function, no whole-array delete, so mawk, Ubuntu's
# default awk, runs it too; the self-test of R3 checks that on the VPS.
# Variables: end (required), the epoch of the reading, taken while the sampler runs; expect
# (required), the comma-separated entities the log must hold, exactly; min_span, max_gap and
# max_mean in seconds. A line that is not a complete, well-formed sample is rejected,
# never read as zero. It prints one line per entity in the header's order, then the coverage
# verdict, and exits 0 only when the coverage passes.
function problem(msg) { problems++; plist[problems] = msg }
function whole(x) { return x ~ /^[0-9]+$/ }
function decimal(x) { return x ~ /^[0-9]+\.[0-9]+$/ }
function complete(e,   i, keys) {
  keys = nbase + nk
  for (i = 1; i <= nbase; i++) if (!(base[i] in v) || !whole(v[base[i]])) return 0
  for (i = 1; i <= nk; i++) if (!(kf[i] in v) || !whole(v[kf[i]])) return 0
  if (e == "lxc-root") {
    keys += 5
    if (!("MemAvailable_kB" in v) || !whole(v["MemAvailable_kB"])) return 0
    if (!("memory_some_total" in v) || !whole(v["memory_some_total"])) return 0
    if (!("memory_full_total" in v) || !whole(v["memory_full_total"])) return 0
    if (!("memory_some_avg10" in v) || !decimal(v["memory_some_avg10"])) return 0
    if (!("memory_full_avg10" in v) || !decimal(v["memory_full_avg10"])) return 0
  }
  return nkeys == keys
}
function verdict(   i) {
  if (problems == 0) { print "COVERAGE PASS"; return }
  print "COVERAGE INCONCLUSIVE:"
  for (i = 1; i <= problems; i++) print "  " plist[i]
}
BEGIN {
  if (min_span == "") min_span = 86400
  if (max_gap == "") max_gap = 30
  if (max_mean == "") max_mean = 12
  if (!whole(end)) problem("no reading time: pass -v end=$(date -u +%s)")
  if (expect == "") problem("no expected entities: pass -v expect=<entity>,<entity>,...")
  nx = split(expect, xs, ",")
  for (i = 1; i <= nx; i++) {
    if (xs[i] in wanted) problem("the expected entities name " xs[i] " twice")
    wanted[xs[i]] = 1
  }
  nbase = split("memory.current pids.current anon file shmem inactive_file sock workingset_refault_file pgmajfault", base, " ")
}
NR == 1 {
  if ($1 != "#" || $2 != "s6-sampler" || $3 != "2") { problem("line 1 is not an s6-sampler 2 header"); next }
  for (i = 4; i <= NF; i++) { eq = index($i, "="); if (eq > 1) h[substr($i, 1, eq - 1)] = substr($i, eq + 1) }
  if (!whole(h["start"]) || h["kernel"] == "" || h["entities"] == "") { problem("the header lacks start, kernel or entities"); next }
  nk = split(h["kernel"], kf, ",")
  ne = split(h["entities"], ent, ",")
  for (i = 1; i <= ne; i++) {
    if (ent[i] in known) problem("the header names " ent[i] " twice")
    else if (!(ent[i] in wanted)) problem("the header names " ent[i] ", which is not expected")
    known[ent[i]] = 1
  }
  for (i = 1; i <= nx; i++) if (!(xs[i] in known)) problem("the header lacks the expected " xs[i])
  header = 1
  next
}
!header { next }
$1 == "#" && $2 == "s6-sampler" && $3 == "stopped" { stopped = $5; next }
{
  e = $3
  if (NF < 4 || !whole($1) || $2 !~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z$/ || !(e in known)) { malformed++; next }
  t = $1 + 0
  if ((e in seen) && t <= seen[e]) { bad[e]++; next }
  seen[e] = t
  if ($4 == "INVALID") { invalid[e]++; next }
  if ($4 != "ok") { bad[e]++; next }
  split("", v)
  nkeys = 0
  for (i = 5; i <= NF; i++) {
    eq = index($i, "=")
    if (eq < 2 || (substr($i, 1, eq - 1) in v)) { nkeys = -1; break }
    v[substr($i, 1, eq - 1)] = substr($i, eq + 1)
    nkeys++
  }
  if (nkeys < 0 || !complete(e)) { bad[e]++; next }
  n[e]++
  if (n[e] == 1) {
    first[e] = t; firstat[e] = $2
    rf0[e] = v["workingset_refault_file"] + 0; mf0[e] = v["pgmajfault"] + 0
  } else if (t - last[e] > maxgap[e]) {
    maxgap[e] = t - last[e]
  }
  last[e] = t; lastat[e] = $2
  rf1[e] = v["workingset_refault_file"] + 0; mf1[e] = v["pgmajfault"] + 0
  ws = v["memory.current"] - v["inactive_file"]
  kern = 0
  for (i = 1; i <= nk; i++) kern += v[kf[i]]
  nr = v["anon"] + v["shmem"] + kern + v["sock"]
  if (n[e] == 1 || ws > maxws[e]) { maxws[e] = ws; atws[e] = $2 }
  if (n[e] == 1 || nr > maxnr[e]) { maxnr[e] = nr; atnr[e] = $2 }
  if (n[e] == 1 || v["pids.current"] + 0 > maxp[e]) maxp[e] = v["pids.current"] + 0
  if (e == "lxc-root") {
    a = v["MemAvailable_kB"] + 0
    if (n[e] == 1 || a < minav) { minav = a; atav = $2 }
    if (n[e] == 1 || v["memory_some_avg10"] + 0 > maxs) maxs = v["memory_some_avg10"] + 0
    if (n[e] == 1 || v["memory_full_avg10"] + 0 > maxf) maxf = v["memory_full_avg10"] + 0
    if (n[e] == 1) { st0 = v["memory_some_total"] + 0; ft0 = v["memory_full_total"] + 0 }
    st1 = v["memory_some_total"] + 0; ft1 = v["memory_full_total"] + 0
  }
}
END {
  if (!header) {
    if (problems == 0 || NR == 0) problem("no s6-sampler 2 header: the log is missing, empty or foreign")
    verdict()
    exit 1
  }
  if (h["kernel"] == "kernel") print "kernel memory: the kernel field"
  else print "kernel memory: the sum of " h["kernel"] ", an ESTIMATE"
  if (malformed) problem(sprintf("%.0f line(s) malformed or of an entity not in the header", malformed))
  for (i = 1; i <= ne; i++) {
    e = ent[i]
    if (!(e in n)) { problem(e ": no valid sample"); continue }
    span = last[e] - first[e]
    printf "%s: %.0f samples %s..%s (%.1f h, largest gap %.0f s); WS max %.1f MiB at %s; anon+shmem+kernel+sock max %.1f MiB at %s; pids.current max %.0f; refaults +%.0f; major faults +%.0f\n", e, n[e], firstat[e], lastat[e], span / 3600, maxgap[e], maxws[e] / 1048576, atws[e], maxnr[e] / 1048576, atnr[e], maxp[e], rf1[e] - rf0[e], mf1[e] - mf0[e]
    if (e == "lxc-root") printf "lxc-root: MemAvailable min %.1f MiB at %s; memory pressure avg10 max some %.2f, full %.2f; stalled over the samples: some %.0f us (%.3f %%), full %.0f us\n", minav / 1024, atav, maxs, maxf, st1 - st0, (span > 0) ? (st1 - st0) / (span * 10000) : 0, ft1 - ft0
    if (invalid[e]) problem(sprintf("%s: %.0f INVALID sample(s)", e, invalid[e]))
    if (bad[e]) problem(sprintf("%s: %.0f incomplete, malformed or out-of-order sample(s)", e, bad[e]))
    if (n[e] < 2 || span < min_span + 0) problem(sprintf("%s: the samples span %.0f s, less than %.0f s", e, span, min_span))
    else if (span / (n[e] - 1) > max_mean + 0) problem(sprintf("%s: %.1f s between samples on average, more than %.0f s", e, span / (n[e] - 1), max_mean))
    if (maxgap[e] > max_gap + 0) problem(sprintf("%s: a gap of %.0f s, more than %.0f s", e, maxgap[e], max_gap))
    if (whole(end) && last[e] > end + 0) problem(sprintf("%s: the last sample is %.0f s after the reading time: a wrong end, or a wrong clock", e, last[e] - end))
    else if (whole(end) && end - last[e] > max_gap + 0) problem(sprintf("%s: the last sample is %.0f s before the reading: the sampler is not running", e, end - last[e]))
  }
  if (stopped != "") problem("the sampler was stopped at " stopped ", before this reading")
  verdict()
  exit (problems ? 1 : 0)
}
```

- **It rejects every record that is not a complete sample:**
  - the first line must be the sampler's header;
  - every other line needs an epoch, a UTC time, an entity of the header, and `ok` or `INVALID`;
  - an `ok` line needs every required key exactly once and no other key. Each value must be a
    whole number, the pressure averages decimal numbers;
  - an entity's times must increase strictly.

  A rejected line is never read as zero: it counts against the coverage.
- **It requires the exact expected entity set**, `-v expect`: the root and the four application
  containers before the start (`$pre`), the root and all ten containers for the window (`$window`).
  The header's entities must be that set, compared as a set.
- **It checks the coverage of every entity of the header.** Each of these makes it print
  `COVERAGE INCONCLUSIVE` with the reasons and exit 1:
  - no `expect`, or an expected set that names an entity twice;
  - an expected entity missing from the header, an entity the header names twice, or one it names
    that is not expected;
  - an `INVALID` or a rejected line;
  - an entity without a valid sample;
  - valid samples that span less than `min_span`;
  - more than `max_mean` (12 s) between samples on average;
  - a gap of more than `max_gap` (30 s);
  - a last sample more than `max_gap` before the reading (`end`), or after it;
  - a stop line.

  Only `COVERAGE PASS` exits 0.
- **The values** are the maxima and minima over the valid samples. They count only with
  `COVERAGE PASS`.
- **POSIX awk only:** no gawk extension, no time function, no regex interval, no whole-array
  `delete`, and no `for (key in array)` loop that decides the output's order. The self-test below
  checks this on the VPS's own awk.

**The self-test.** **VPS, read-only**, under C5 before any readout counts (§4.1, step 5). It writes
no file. It runs the readout on a pinned log that passes, on a variant that must fail, and on the
pinned log against a wrong entity set:

```bash
k='kernel_stack=262144 pagetables=262144 percpu=262144 slab_reclaimable=131072 slab_unreclaimable=131072'
r='file=3145728 shmem=1048576 inactive_file=1048576 sock=0'
t='file=1048576 shmem=0 inactive_file=524288 sock=0 workingset_refault_file=0 pgmajfault=0'
log="# s6-sampler 2 start=1800000000 kernel=kernel_stack,pagetables,percpu,slab_reclaimable,slab_unreclaimable entities=lxc-root,tempo
1800000000 2027-01-15T08:00:00Z lxc-root ok memory.current=8388608 pids.current=150 anon=4194304 $r workingset_refault_file=5 pgmajfault=2 $k MemAvailable_kB=3145728 memory_some_avg10=0.00 memory_full_avg10=0.00 memory_some_total=100 memory_full_total=0
1800000000 2027-01-15T08:00:00Z tempo ok memory.current=2097152 pids.current=20 anon=1048576 $t $k
1800000010 2027-01-15T08:00:10Z lxc-root ok memory.current=8388608 pids.current=152 anon=4194304 $r workingset_refault_file=5 pgmajfault=2 $k MemAvailable_kB=3145728 memory_some_avg10=0.12 memory_full_avg10=0.00 memory_some_total=600 memory_full_total=0
1800000010 2027-01-15T08:00:10Z tempo ok memory.current=2097152 pids.current=21 anon=1048576 $t $k
1800000020 2027-01-15T08:00:20Z lxc-root ok memory.current=9437184 pids.current=151 anon=5242880 $r workingset_refault_file=6 pgmajfault=3 $k MemAvailable_kB=3140608 memory_some_avg10=0.05 memory_full_avg10=0.00 memory_some_total=1100 memory_full_total=0
1800000020 2027-01-15T08:00:20Z tempo ok memory.current=3145728 pids.current=21 anon=2097152 $t $k
1800000030 2027-01-15T08:00:30Z lxc-root ok memory.current=8388608 pids.current=150 anon=4194304 $r workingset_refault_file=7 pgmajfault=3 $k MemAvailable_kB=3145728 memory_some_avg10=0.02 memory_full_avg10=0.00 memory_some_total=1100 memory_full_total=0
1800000030 2027-01-15T08:00:30Z tempo ok memory.current=2097152 pids.current=20 anon=1048576 $t $k"
pass_out='kernel memory: the sum of kernel_stack,pagetables,percpu,slab_reclaimable,slab_unreclaimable, an ESTIMATE
lxc-root: 4 samples 2027-01-15T08:00:00Z..2027-01-15T08:00:30Z (0.0 h, largest gap 10 s); WS max 8.0 MiB at 2027-01-15T08:00:20Z; anon+shmem+kernel+sock max 7.0 MiB at 2027-01-15T08:00:20Z; pids.current max 152; refaults +2; major faults +1
lxc-root: MemAvailable min 3067.0 MiB at 2027-01-15T08:00:20Z; memory pressure avg10 max some 0.12, full 0.00; stalled over the samples: some 1000 us (0.003 %), full 0 us
tempo: 4 samples 2027-01-15T08:00:00Z..2027-01-15T08:00:30Z (0.0 h, largest gap 10 s); WS max 2.5 MiB at 2027-01-15T08:00:20Z; anon+shmem+kernel+sock max 3.0 MiB at 2027-01-15T08:00:20Z; pids.current max 21; refaults +0; major faults +0
COVERAGE PASS'
fail_out='kernel memory: the sum of kernel_stack,pagetables,percpu,slab_reclaimable,slab_unreclaimable, an ESTIMATE
lxc-root: 3 samples 2027-01-15T08:00:00Z..2027-01-15T08:00:30Z (0.0 h, largest gap 20 s); WS max 8.0 MiB at 2027-01-15T08:00:20Z; anon+shmem+kernel+sock max 7.0 MiB at 2027-01-15T08:00:20Z; pids.current max 151; refaults +2; major faults +1
lxc-root: MemAvailable min 3067.0 MiB at 2027-01-15T08:00:20Z; memory pressure avg10 max some 0.05, full 0.00; stalled over the samples: some 1000 us (0.003 %), full 0 us
tempo: 3 samples 2027-01-15T08:00:00Z..2027-01-15T08:00:30Z (0.0 h, largest gap 20 s); WS max 1.5 MiB at 2027-01-15T08:00:00Z; anon+shmem+kernel+sock max 2.0 MiB at 2027-01-15T08:00:00Z; pids.current max 21; refaults +0; major faults +0
COVERAGE INCONCLUSIVE:
  lxc-root: 1 incomplete, malformed or out-of-order sample(s)
  lxc-root: 15.0 s between samples on average, more than 12 s
  tempo: 1 INVALID sample(s)
  tempo: 15.0 s between samples on average, more than 12 s'
set_out='kernel memory: the sum of kernel_stack,pagetables,percpu,slab_reclaimable,slab_unreclaimable, an ESTIMATE
lxc-root: 4 samples 2027-01-15T08:00:00Z..2027-01-15T08:00:30Z (0.0 h, largest gap 10 s); WS max 8.0 MiB at 2027-01-15T08:00:20Z; anon+shmem+kernel+sock max 7.0 MiB at 2027-01-15T08:00:20Z; pids.current max 152; refaults +2; major faults +1
lxc-root: MemAvailable min 3067.0 MiB at 2027-01-15T08:00:20Z; memory pressure avg10 max some 0.12, full 0.00; stalled over the samples: some 1000 us (0.003 %), full 0 us
tempo: 4 samples 2027-01-15T08:00:00Z..2027-01-15T08:00:30Z (0.0 h, largest gap 10 s); WS max 2.5 MiB at 2027-01-15T08:00:20Z; anon+shmem+kernel+sock max 3.0 MiB at 2027-01-15T08:00:20Z; pids.current max 21; refaults +0; major faults +0
COVERAGE INCONCLUSIVE:
  the header names tempo, which is not expected
  the header lacks the expected grafana'
selftest() {   # NAME EXPECTED_EXIT EXPECTED_ENTITIES LOG EXPECTED_OUTPUT
  local got rc
  got=$(printf '%s\n' "$4" | awk -v end=1800000035 -v min_span=30 -v max_gap=30 -v max_mean=12 -v expect="$3" -f ~/s6-readout.awk); rc=$?
  if [ "$got" = "$5" ] && [ "$rc" = "$2" ]; then
    echo "self-test $1: ok"
  else
    echo "self-test $1: FAIL (exit $rc, expected $2)"
    diff <(printf '%s\n' "$5") <(printf '%s\n' "$got")
  fi
}
selftest pass 0 lxc-root,tempo "$log" "$pass_out"
selftest fail 1 lxc-root,tempo "$(sed -e '7s/ ok .*/ INVALID memory.current/' -e '4s/pids.current=152/pids.current=15x/' <<<"$log")" "$fail_out"
selftest set 1 lxc-root,grafana "$log" "$set_out"
```

- **Expected:** `self-test pass: ok`, `self-test fail: ok` and `self-test set: ok`.
- **Anything else** means that this awk does not run the readout as tested. No readout result
  counts, and G11 is a STOP (§11).
- **Tested locally** (revision 3), and nowhere else:
  - with gawk 5.4.1 (Git Bash), `gawk --posix`, gawk 5.3.2 and mawk 1.3.4 20260129 (Ubuntu 26.04 in
    WSL);
  - each passes the self-test, and gawk 5.4.1, `gawk --posix` and mawk give the same output on 33
    synthetic logs;
  - two altered readouts fail it: one that always exits 0, and revision 2's readout, which lacks the
    entity check, in the `set` case.

  Ubuntu 24.04's mawk is an older 1.3.4 build, which was not available here. So the self-test on
  the VPS is the evidence for its awk, not these runs.

**The readout wrapper.** G11, G13a, G13b and R3 read a log through it. **VPS, read-only.** Define
it in each new shell:

```bash
# Whether PID $1 is a running s6-sampler.sh: kill -0 sends no signal, and the command line rules out
# another process that got the same PID.
running() { kill -0 "$1" 2>/dev/null && tr '\0' ' ' 2>/dev/null <"/proc/$1/cmdline" | grep -q 's6-sampler\.sh'; }
# The readout of log $1 from the sampler with PID $2, over at least $3 s, for exactly the entities $4.
# It reads a snapshot: the log's first $size bytes, which the sampler, appending only, never changes,
# so lines appended during the readout are not read. The reading time is taken after the snapshot's
# size, so no sample in the snapshot lies after it. It passes only when the sampler runs before and
# after the readout and the readout's coverage passes.
s6_readout() {
  local size last end
  local -a st
  if ! running "$2"; then
    echo "INCONCLUSIVE: no s6-sampler.sh runs as PID $2"
    return
  fi
  if ! size=$(stat -c %s "$1" 2>/dev/null) || [ "$size" -eq 0 ]; then
    echo "INCONCLUSIVE: $1 is missing or empty"
    return
  fi
  last=$(tail -c +"$size" "$1" | head -c 1 | od -An -tx1)
  if [ "${last// /}" != 0a ]; then
    echo "INCONCLUSIVE: the snapshot of $1 ends inside a record; read it again"
    return
  fi
  end=$(date -u +%s)
  head -c "$size" "$1" | awk -v end="$end" -v min_span="$3" -v expect="$4" -f ~/s6-readout.awk
  st=("${PIPESTATUS[@]}")
  if [ "${st[0]}" -ne 0 ]; then
    echo "INCONCLUSIVE: the snapshot of $1 could not be read"
  elif [ "$(stat -c %s "$1" 2>/dev/null || echo 0)" -lt "$size" ]; then
    echo "INCONCLUSIVE: $1 became shorter during the readout"
  elif ! running "$2"; then
    echo "INCONCLUSIVE: the sampler $2 stopped during the readout"
  elif [ "${st[1]}" -ne 0 ]; then
    echo "INCONCLUSIVE: the readout exited ${st[1]}"
  else
    echo "PASS: COVERAGE PASS on a snapshot of $size bytes, and the sampler $2 still runs"
  fi
}
pre=lxc-root,postgres-nimuairy,backend-nimuairy,frontend-nimuairy,cloudflared-nimuairy
window=lxc-root,prometheus,loki,tempo,alloy,docker-socket-proxy,grafana,postgres-nimuairy,backend-nimuairy,frontend-nimuairy,cloudflared-nimuairy
```

- **It passes only when** all of these hold. Anything else prints `INCONCLUSIVE` and its reason:
  - the sampler runs before and after the readout;
  - the log exists and is not empty;
  - the snapshot ends with a complete record, and could be read in full;
  - the log did not become shorter;
  - the readout exits 0, so the coverage passed for exactly the expected entities.
- **It reads a snapshot, without copying the log.**
  - The sampler only appends (`>>`), so the log's first `size` bytes, as `stat` counts them before
    the readout, do not change. The wrapper reads exactly those bytes (`head -c`).
  - The reading time `end` is taken after `size`. Every sample in the snapshot was written before
    `size` was read, so none lies after `end`. A line appended during the readout is outside the
    snapshot, so it cannot appear as a sample from the future, which used to turn a complete window
    INCONCLUSIVE.
  - A snapshot whose last byte is not a newline ends inside a record: INCONCLUSIVE, and reading
    again is enough.
  - The sampler keeps running; nothing stops it to read its log.
- **Tested against concurrent appends** (WSL, mawk and gawk):
  - a stable log passes;
  - a log that ends inside a record is INCONCLUSIVE;
  - a complete line appended during the readout, dated 60 s ahead, leaves the result `PASS`, where
    revision 3's wrapper turned INCONCLUSIVE;
  - a sampler that stops during the readout, a log that becomes shorter, and a snapshot that cannot
    be read are INCONCLUSIVE;
  - a live sampler appending every second, read 40 times, passed all 40.
- **"Runs" means** that `kill -0` finds the PID, which sends no signal, and that the PID's command
  line names `s6-sampler.sh`. A PID that another process reused does not pass.
- **`$pre` and `$window`** are the expected entity sets for the pre-start log and for the window.

**Starting the samplers** (C5):
- **The pre-start sampler, under C5, before G11** (§4.1, step 5): the root and the four application
  containers. It runs through G11, G13a, the pull, G13b, the start and R1, so its log shows the
  pull and the stack's start too.

  ```bash
  nohup bash ~/s6-sampler.sh postgres-nimuairy backend-nimuairy frontend-nimuairy cloudflared-nimuairy > ~/s6-sampler-pre.out 2>&1 &
  echo "pre-start sampler PID $!"
  ```

- **The window's sampler, after R1:** stop the pre-start sampler with `kill <PID>`, then start it
  for all ten:

  ```bash
  nohup bash ~/s6-sampler.sh prometheus loki tempo alloy docker-socket-proxy grafana \
    postgres-nimuairy backend-nimuairy frontend-nimuairy cloudflared-nimuairy > ~/s6-sampler.out 2>&1 &
  echo "sampler PID $!"
  ```

- The first line of each `.out` file names its log, or says why the sampler refused to start.
- **The window:** at least 24 h from R1, including one 03:30 backup, with no release, no manual
  restart and no recreate in it (D3, D4). A reboot, a daemon restart or a recreate inside the window
  ends it; record the event and start a new window.
- **The window ends with R3's readout, taken while the sampler still runs.** A sampler that stopped
  earlier leaves an incomplete window.
- **Size** [ESTIMATE]: eleven lines of about 450 bytes every 10 s, about 45 MB a day.

**R3, at the end of the window.** **VPS, read-only:**
1. **The readout, while the sampler still runs**, through the wrapper:

   ```bash
   s6_readout ~/s6-sample-<UTC>.log <PID> 86400 "$window"
   ```

   - `<UTC>` comes from the log's name in `~/s6-sampler.out`, `<PID>` from the start.
   - The wrapper checks the sampler before and after the readout. Only its `PASS` line counts.
   - G11 runs the same on the pre-start log with `60 "$pre"`, and G13a and G13b with `1800 "$pre"`.
2. **Stop the sampler:** `kill <PID>`.
3. **R1 again.** Every event counter must equal R1's. The cumulative CPU and pressure values minus
   R1's give the window's CPU time and stall time per container.
4. **V1, V2, V10, V14 and V16 again.** Check the backup in the journal
   (`journalctl -t nimuairy-backup --since <window start>`,
   [README, Database backups](../README.md#database-backups)).

**Reading the values:**

- The working set is `memory.current − inactive_file`, as `docker stats` shows it.
- **The root's `anon + shmem + kernel + sock`** is the observed `H + P + O` of the whole LXC,
  without the file working set K ([Memory components](VPS_RESOURCE_BUDGET.md#memory-components)).
  Its maximum is the "observed" value of the budget's
  [Peaks that can coincide](VPS_RESOURCE_BUDGET.md#peaks-that-can-coincide).
- **The containers' maxima are attribution**, from different samples. They are not added up to a
  total.
- Without a `kernel` field, kernel memory is the sum of its parts: an [ESTIMATE] that matched the
  `kernel` field within 0.1 MiB locally, unverified on 5.15.
- `workingset_refault_file` and `pgmajfault` are cumulative; the readout prints their rise over the
  valid samples (`refaults +n`, `major faults +n`). A steady rise is the budget's sign that K does
  not fit.

**R4, evaluation (proposed criteria, D3).**

**Coverage comes first.** R3's wrapper must print `PASS`: `COVERAGE PASS` for exactly the eleven
entities of `$window`, with the sampler running before and after the readout. Otherwise the
measurement is **INCONCLUSIVE, never PASS**, whatever M1 to M7 show, and a new window is needed.
That covers:
- a missing or empty log;
- a sampler that stopped, crashed, or stopped during the readout;
- a missing, duplicated or unexpected entity;
- an `INVALID` or rejected sample;
- a gap over 30 s, more than 12 s between samples on average, or a span under 24 h.

With the coverage passed, the idle measurement succeeds when all of these hold:
- **M1:** R1 is all `ok`, for all ten containers.
- **M2:** the window includes one 03:30 backup (in the journal), and no release, manual restart,
  recreate, reboot or daemon restart happened in it.
- **M3:** in R3, every `oom` and `oom_kill` of the ten containers and the root is unchanged, and so
  is `pids.events max`. `RestartCount` is unchanged, `OOMKilled` is false, and no exit code 137
  appeared.
- **M4:** each stack container's highest working-set sample is at most half its limit, the
  budget's 2× rule: Prometheus, Loki and Grafana 256 MiB, Tempo 512 MiB, Alloy 192 MiB, the proxy
  32 MiB.
- **M5:** the root's highest `anon + shmem + kernel + sock` is at most 3264 MiB (T − 25 %), and its
  lowest `MemAvailable` at least 1088 MiB (25 % of T). `MemAvailable` comes from LXCFS, whose
  computation inside the LXC is not verified [UNKNOWN]; it is a supporting reading.
- **M6:** the application stayed healthy, the public URL answered, and the 03:30 backup was dumped
  and uploaded.
- **M7:** the disk's, volumes' and logs' growth over the window is recorded.

**STOP, act now.** The stack is stopped with
`docker compose -f observability/compose.yaml -f observability/compose.prod.yaml stop` (consent
under §11), never with `down`, and the finding is reported:
- an `oom_kill` in an application container, or at the root without a stack container's own limit
  explaining it;
- the public URL fails, or the 03:30 backup fails, during the window;
- a stack container restarts repeatedly or is OOM-killed;
- a root `anon + shmem + kernel + sock` sample above 3482 MiB (T − 20 %), or a `MemAvailable` sample
  below 870 MiB (20 % of T).

**Revisit the budget before S7**, without stopping the stack:
- M4 fails for a container;
- M5 fails, but no STOP value was reached;
- a `max` counter rises steadily: the container keeps reaching its limit and reclaiming;
- `workingset_refault_file` or `pgmajfault` at the root rises steadily;
- Tempo's working set still rises at the end of the window
  ([Risks](VPS_RESOURCE_BUDGET.md#risks));
- the cumulative `cpu.pressure` of an application container rose noticeably more over the window
  than its baseline suggests.

A revisit is a repository change with its own review. S6 changes no limit.

### 10.4 What S6 does not establish

- **Behaviour under S7's ingest.** Before S7 nothing sends traces, no log is collected, and
  Prometheus scrapes only itself and Alloy.
- **The Java agent's overhead** (P with the agent).
- **The steady state under retention:** 15 days for Prometheus, 168 h for Loki and Tempo. A 24-h
  window sees at most one day of each.
- **Production query load:** Grafana sessions, long range queries, TraceQL searches.
- **Compaction peaks** that fall outside the window or between samples.
- **A reboot or daemon restart** with the stack present, when restart policies start every
  container at once, and Alloy may start before the proxy answers
  ([S3.3b](DEFERRED_WORK.md#s33b--alloy-starting-while-the-socket-proxy-is-down)).
- **A deploy with the stack present:** the backup, the image pull and a new JVM on one CPU.
- **K**, **the outer limit T** and its enforcement, **swap on the host side**, and **peaks between
  two samples**.
- **Persistence across a recreate on the VPS**, which the first update shows.

## 11. S6.6 — Recovery and STOP conditions

**Rules:**
- **Read first, act on one service.** No restart of the whole stack as a first response.
- **Each action that changes state needs its own consent**, even when the table names it.
- **Never** `down -v`, `docker volume rm`, `docker volume prune`, `docker system prune` or any broad
  image prune, and never an ownership change of a volume. Every piece of persistent data is kept.
- **Never** a host port, a binding on another address, a firewall rule or a hand edit of a tracked
  file as a workaround.
- **To halt S6** after the start. **VPS, changes runtime state:**

  ```bash
  cd /var/nimuairy-observability
  docker compose -f observability/compose.yaml -f observability/compose.prod.yaml stop
  ```

  The containers, networks and volumes stay, and a container stopped by hand stays stopped across a
  reboot (`unless-stopped`). Resume with `start`, or with `up -d --wait --wait-timeout 180`, both
  with the two files.

| Symptom | Read-only checks | Action (each with consent) | STOP until |
|---|---|---|---|
| G4: the render fails or differs | The error; `docker compose version`; G4's lines | None on the VPS. A Compose that cannot apply `!reset` or render the files is a repository and version question | A reviewed answer: a different commit, or a decision about the VPS's Compose |
| Grafana does not start: a guard `FATAL` line | `docker logs grafana`; G5; `stat` of the path | Fix the file or the directory, as in §7.5. If the engine created a directory at the path (as Docker Desktop does, U1), it is empty: `rmdir` it and write the file. Then recreate Grafana only: `docker compose -f observability/compose.yaml -f observability/compose.prod.yaml up -d --wait --wait-timeout 180 --force-recreate grafana` | Grafana healthy, then V6. The guard ran before `run.sh`, so no `grafana.db` holds `admin` |
| Grafana unhealthy or unreachable without `FATAL` | `docker logs grafana`; its health; `docker exec grafana wget -qO- http://localhost:3000/api/health`; for the tunnel, `ssh`'s output | A slow start on one CPU: wait and read again. A tunnel refused: P9 and D2. Otherwise `restart grafana`, once | Read it before any repeat |
| An unexpected existing volume (G1) | `docker volume inspect` with named fields | None in S6 | A separate design and approval |
| Tempo loops on `permission denied` | `docker logs tempo`; V12's owner listing; G7 | Stop Tempo to end the loop: `docker compose -f observability/compose.yaml -f observability/compose.prod.yaml stop -t 30 tempo`. No `chown`: the development migration (B6) is not for production | A separate, reviewed procedure. On a volume created at `t_up` it means the seeding or the mapping failed (U4, U9) |
| The proxy restarts or is unhealthy | `docker logs docker-socket-proxy`: `socket not available` with `permission denied` | Rewrite `observability/.env` with the socket's group, then `up -d --wait --wait-timeout 180` with both files, which recreates the proxy | V10 |
| The proxy is `exited` after a manual stop | V10's `inspect` | `docker compose -f observability/compose.yaml -f observability/compose.prod.yaml start docker-socket-proxy` | V9, V10 |
| Alloy: discovery errors or refused requests | V9; the proxy's `blocked request` lines from Alloy's address | Proxy first, as above. A refusal of Alloy's own call is a mismatch between Alloy's version and the allowlist: a repository question, never a widened allowlist on the VPS | V9 |
| Alloy restarts with a permission error on its positions | `docker logs alloy`; V12's owners | Stop Alloy. No `chown` on production | A separate procedure |
| Resource pressure or an OOM kill | R1's events; `docker inspect` `OOMKilled`; the root's `MemAvailable`; §10.3's STOP list | A stack container at its own limit restarts by itself; record it. A STOP value of §10.3: `stop` the stack. No limit is changed in S6 | The budget revisited (§10.3), in a reviewed change |
| `prod-check runtime` fails | Its output | None blindly: no second run until the cause is known. Never `GRAFANA_AUTH` as a workaround | The cause found, and a new consent C4 |
| A login is refused | Which password the file has; the time of the failures | Wait for Grafana's lockout to pass; never retry in a loop. The reset procedure is **Not validated** | An explanation; with a new volume, the file's password is the database's |
| The sampler refuses to start, writes `INVALID` lines, or stops | Its `.out` file; the `INVALID` keys in its log; `kill -0 <PID>` | Fix the cause if it is outside the stack, for example a container that was recreated; then start a new sampler. Its earlier log stays as it is | A complete new window. A window with a gap or an `INVALID` line is never repaired or merged |
| The readout's self-test fails | Its `diff` output; P10's `awk` line | None on the VPS. Do not edit the readout there | A reviewed readout in the repository, whose self-test passes on that awk |
| G13a is not a PASS | The wrapper's output and R0's readings | No pull. On INCONCLUSIVE, measure again at another time. On STOP, the application's state or the budget is reviewed first | A G13a PASS |
| The pull block prints `STOP`, or G13b is not a PASS | The pull block's lines; the wrapper's output; R0's readings | No `up`. On G13b INCONCLUSIVE, the operator's recorded decision of G13's Next allowed action. On STOP, the budget is reviewed first. Removing the six pulled images, by name, needs its own consent | A G13b PASS, then a new C3b |
| C3b's 15 min passed before the `up` | The time of G13b's reading | None. G13b again, on the same, longer log | A fresh G13b PASS |

## 12. S6.7 — Documentation close-out

**Only after S6.5's acceptance**, from observed facts, in its own PR. Nothing below is changed
before the deployment has succeeded.

| Document | Change | From |
|---|---|---|
| `README.md`, Observability | The stack runs in production on the VPS, from `/var/nimuairy-observability`, monitoring itself until S7; a link to the production guide | V1, V6 |
| `docs/VPS_FIREWALL.md` | The sentence that the production Compose files publish no host ports gets the stack's exception: Grafana's `127.0.0.1:3000`, loopback only, reached through SSH. Prometheus, Loki, Tempo, Alloy and the proxy publish nothing. UFW and the policy are unchanged. U12's result, without the address | V5, V6, G9, V15 |
| `docs/VPS_RESOURCE_BUDGET.md` | The stack in the services table as running; a section with the measurements: G13's pre-start baseline, what the pre-start sampler saw during the first start, R1's settings, R3's maxima per container and at the root, the window and its coverage, the events; the O-idle row of Outstanding verification; the `memory.stat` field list; the open questions of §10.4 | G13, §10.3 |
| `docs/S4b_DESIGN_CONTRACT.md` | U7 to U10 and U12 in §12.1 closed or updated with their evidence; U1 only if a Linux engine's behaviour was observed; §12.3's items marked done; a revision line | G4, G6–G9, V6, V11, V12 |
| `docs/OBSERVABILITY_PRODUCTION.md` | Its status ("not deployed yet"); each **Verify at S6** item that S6 settled, with the result; the open-items table; and corrections where the VPS behaved differently from the guide | The relevant V and G results |
| `docs/OBSERVABILITY.md` | The sentences that S6 makes stale: "Nothing has been created on the VPS yet" and "They have not been deployed on the VPS" | V1 |
| This contract | Status, the results, the acceptance checklist, deviations | All |

- **`docs/DEFERRED_WORK.md`:** no change is planned. S3, S3.3b and B7 stay deferred. If S6 sees one
  of S3.3b's "Reconsider when" events, such as a reboot with the stack present or an OOM kill of
  Alloy, it is reported for a separate decision.
- **What the documents record:** summaries and values, never account lists, addresses, the host,
  the SSH port, a login or the password.

## 13. Decisions

### 13.1 Accepted

§3 lists the decisions S6 builds on. S6 reopens none of them.

### 13.2 Proposed procedures

Accepted together with this contract:
- the seven stages, the consents C1, C2, C5, C3a, C3b and C4 (§4), and the order of §4.1;
- the preflight P1 to P10, its helpers and its record (§6);
- the commit rule of §7.1, the directory of §7.2, the hand-over of §7.3, and the creation blocks of
  §7.4 and §7.5;
- the gates G1 to G12, G13a and G13b (§8), with G13's thresholds as D3 decides them;
- the startup steps (§9), with the pull's stall readings;
- the checklist V1 to V16 and the single production check run (§10.1, §10.2);
- the resource procedure R0 to R4 (§10.3): the fail-closed sampler, the readout with its expected
  entity sets, its self-test and its wrapper, the coverage rule, and the criteria as D3 decides
  them;
- the recovery table (§11) and the close-out (§12).

### 13.3 Open: decisions for the operator

| # | Question | Options | Recommendation |
|---|---|---|---|
| D1 | The Grafana secret's owner and mode | A: 0644, `deploy`, in a 0700 `deploy` directory. B: 0400, UID 472 | **A** (§7.5): no root, the production check runs as `deploy`, and B protects nothing further on this host. Also the password rule of §7.5: 32 or more letters and digits |
| D2 | The SSH account that copies the archive and opens the tunnels | (a) `deploy` with a key of its own for the operator, without `restrict`: a new `authorized_keys` entry, itself a VPS change. (b) The operator's existing administrative account: `scp` to it, then §7.3's hand-over; the tunnel through it. (c) A new tunnel-only account whose key allows only `port-forwarding` to `127.0.0.1:3000`: least privilege, but a new account, and the Alloy UI tunnel would need a wider `permitopen` | **(b) for S6**, if P9 shows that it may forward: it needs no new account or key. Whether to add (c) for routine Grafana access later is a separate decision. The key the deploy workflow uses keeps its restrictions in every option |
| D3 | The measurement procedure and its thresholds, before and after the start | The parts below | **As proposed**, part by part below |
| D4 | Releases and image updates during S6 | Freeze: no `release.yml` from the start of the pre-start sampler (G11) to the end of the window; #103 to #108 stay unmerged until S6 closes. Or no freeze | **Freeze.** The measurements stay attributable, and the deployed images are those CI verified at `ff0139a`. After S6, the guide's update sequence takes one image at a time |
| D5 | Docker's JSON log rotation | Record only in S6. Or configure rotation: daemon-wide in `daemon.json`, which needs a daemon restart, affects the application and applies only to containers created afterwards [S, Docker's logging documentation, not re-read for this contract]; or per service with Compose's `logging`, a repository change that the limits check's allowlist would have to admit for the overlay | **Record only in S6** (V14, R3). Decide afterwards from the measured growth, in a separate change |
| D6 | Whether a restart picks up a configuration file that an extraction replaced | Test it in S6 with a re-extraction and a restart. Or at the first real update | **At the first update that changes a configuration file:** after `restart prometheus`, `docker exec prometheus wget -qO- http://localhost:9090/api/v1/status/config` must show the new content. S6 delivers fresh files and replaces none; until then the guide's restart instruction stays, and its item stays open |
| D7 | U12, if G9 is not a PASS | Go ahead with the gap recorded. Or fix the firewall first, in a separate change | **Decide from P8's facts.** The stack adds no IPv6 listener in either case |

**D3 in parts.** Each value is a proposal; none is a measured fact about the VPS.

| Part | Proposed | Alternatives | Why the proposal |
|---|---|---|---|
| Reserve R | 25 % of the visible T: 1088 MiB | 20 %, 870 MiB, the lower end of the budget's range | T is unverified, so the upper end |
| G13's allowance A for the stack's own memory | 1200 MiB | 600 MiB, about the local maximum itself; 3008 MiB, the stack's limits | Twice the local maximum of 579 MiB, because local values do not carry over to one CPU. 3008 MiB would treat limits as demand, and no baseline that includes the application could pass |
| G13's headroom (R-g) | Root `anon + shmem + kernel + sock` ≤ 2064 MiB and `MemAvailable` ≥ 2288 MiB | With R = 20 %: ≤ 2282 and ≥ 2070 MiB. With A = 600 MiB: ≤ 2664 and ≥ 1688 MiB | Follows from R and A; T − R − A and R + A |
| G13's memory stall (R-f) | `full` 0; `some` ≤ 0.1 % of the time covered | `some` 0 too; or no stall condition | The only visible sign of a lower outer limit (G13). A strict 0 could fail on a trace of reclaim; none would ignore the sign |
| G13's pre-start window | At least 30 min, with the coverage rule | 10 min; 1 h | Long enough for some 150 samples per entity, short enough to start the same day |
| G13b after the pull | The same conditions on the longer log, each a STOP, plus R-p | G13a alone, as in revision 2 | The pull is a load of its own, and the `up` should follow evidence that includes it |
| The pull's stall (R-p) | `full` 0; `some` ≤ 0.1 % of the pull's duration | A share of the whole log's time only (R-f) | R-f dilutes a short pull's stall over at least 30 min |
| C3b's freshness | The `up` within 15 min of G13b's reading | 5 min; 30 min | Long enough to give the consent and type the command, short enough that the reading still describes the VPS |
| The application's share in G13 (R-e) | Working set and `pids.current` ≤ half their limits | No condition | The 2× rule of the budget. S4.4.4 saw at most 21.3 % and 10.5 % |
| The coverage rule | ≥ 24 h (window) or ≥ 30 min (G13); ≤ 12 s between samples on average; no gap over 30 s; no `INVALID` or rejected line; read while running | A gap up to 60 s | The sampler runs every 10 s; S4.4.4's sampler was never more than 11 s apart |
| The window | At least 24 h, one 03:30 backup | 35 h, as S4.4.4 | A day and the backup are the recurring load; a longer window is allowed |
| M4 and M5, and the STOP and revisit values | As in R4 | Other percentages | The budget's 2× rule; T − R at 25 % and 20 % |
| G10's disk threshold | 10 GiB free | 5 GiB; 20 GiB | About three times the local image size, with room for logs and volumes |

## 14. Assumptions and open items

| Item | Source | S6 step | Status before S6 |
|---|---|---|---|
| U1: a Linux engine refuses a missing bind source for a file secret | S4b §12.1 | Not tested: G5 makes sure the file exists, and S6 runs no negative experiment on production | Unverified; the guard does not depend on it |
| U3: an unreadable secret leaves the password empty | S4b §12.1 | Not tested | Not observed; the guard does not depend on it |
| U7: Compose on the VPS applies `!reset` | S4b §12.1 | G4 | Open |
| U8: no untrusted users or services on the host | S4b §12.1 | G6 | Open |
| NSS takes accounts and groups only from `/etc/passwd`, `/etc/group` and nss-systemd's dynamic users; no nscd | This contract | P7 (`nss_sources`), G6 | Open. Ubuntu 26.04 under WSL has `files systemd`; the VPS's `/etc/nsswitch.conf` was never read |
| U9: the LXC maps UIDs 10001, 472 and 473 | S4b §12.1 | G7, V11, V12 | Open |
| U10: the extraction leaves the files readable | S4b §12.1 | G8 | Open |
| U12: a public IPv6 address | S4b §12.1 | G9, V15 | Open |
| Compose reads `observability/.env` | Guide | G4 | Open |
| `deploy`'s ownership, Docker access, shell, umask | Guide | P10, §7.2, G8 | Open |
| How the archive reaches `deploy` | Guide | D2, §7.3 | Open |
| `sudo` for the log-size check | Guide | P10, V14 | Open |
| The secret's owner and mode; 472's read access; the production check's access | Guide, S4b §6.5 | D1, G5, G7, V1, V6 | Open |
| No existing volumes, no listeners | Guide, S4b §12.3 | G1, G3 | Open |
| SSH forwarding for the tunnel account | Guide | P9, V7 | Open |
| The Alloy UI tunnel to a container address | Guide | V15, optional | Open; may stay open |
| A restart picks up a replaced file | Guide | D6 | Stays open until the first update |
| The production check's tools and its run | Guide, B8 | P10, V6 | Open |
| `grafana cli admin reset-admin-password --password-from-stdin` | Guide | Not needed with a new `grafana-data` (G1, V3) | **Not validated**; S6 does not validate it |
| Grafana's failed-login threshold and lockout time | Guide | Not determined by S6; V6 and V7 keep failures to one | Unknown |
| Docker's log rotation; disk growth | Guide, budget | D5, V14, R3 | Open |
| The stack's limits and use on the VPS | Guide, budget | §10.3 | Open |
| §8 of S4.4 for the stack's containers (`memory.oom.group`, `Delegate`, `OOMPolicy`) | S4.4 §8 | R1 | Open |
| The `memory.stat` fields of the VPS's kernel | Budget | P4; the sampler's header | Open |
| The VPS's awk runs the readout correctly | This contract | P10, the self-test (§10.3) | Open. Local runs on gawk and a newer mawk are no proof for the VPS's build |
| cgroup v2 with Docker's `systemd` driver, systemd scopes for the containers | S4.4 §10.4 [VPS] | G12 | Read for the application in S4.4.4; open for the stack |
| How LXCFS computes `MemAvailable` inside the LXC | Budget | Not settled by S6 | Unknown; G13 and M5 use it only next to the cgroup counters |
| The first start's memory and CPU peak on the VPS | Budget | The pre-start sampler runs through the start | Never measured |
| The local port 13000's side effects on Grafana's links | Guide | V7 | Open |
| The address nginx logs behind the Cloudflare Tunnel; the application's telemetry | Guide | S7 | Not S6 |
| S3, S3.3b, B7 | DEFERRED_WORK | None | Deferred. S3.3b is to be reconsidered before Alloy collects logs, so before S7; S6 collects none |

## 15. Risks

- **The whole LXC can run out of memory while every container is below its own limit.** The limits
  overcommit T by 1344 MiB. `oom_score_adj: 500` makes the kernel prefer the stack's processes as
  victims; it protects nothing, and reclaim stalls slow the application before any kill
  ([S4.4 §8](S4.4_DESIGN_CONTRACT.md#8-oom-behaviour-and-oom_score_adj-h2)).
- **T is inferred.** A lower effective limit would bring that OOM sooner. G13's headroom rests on
  the visible T as well; only its memory-pressure condition can see a lower limit, and only once
  it causes stalls.
- **The first start's peak is unmeasured.** G13 leaves an allowance A that comes from local runs,
  not from the VPS. The pre-start sampler records the start, so the first real figure exists only
  afterwards.
- **A sampler can stop unnoticed.** The readout turns that into INCONCLUSIVE, never PASS, but the
  window is lost and must be repeated.
- **One CPU.** The pull and the first start of six services, with Prometheus's and Tempo's
  initialisation, share it with the running application and its health check. Not measured on the
  VPS.
- **Idle evidence only** (§10.4). A passing S6 says nothing about S7.
- **Sampling misses peaks.** The kernel has no `memory.peak` or `pids.peak`.
- **Tempo's memory** grew through the whole local idle run, and its 168-h steady state is unknown
  ([Risks](VPS_RESOURCE_BUDGET.md#risks)).
- **Disk:** container logs without rotation, telemetry limited by time only, old images never
  pruned.
- **Grafana's lockout:** the production check's failed login plus typing mistakes at the tunnel
  count together. Threshold unknown.
- **A wrong password in the file** would become the new database's password. The second entry of
  §7.5 guards against a mismatch with the password manager; the reset is not validated.
- **A mistaken command:** a base-only command, or one with the test overlay, would publish the
  development ports again, start the containers without limits, or, on a new volume, initialise
  Grafana with `admin`. The rule of §5 and the production check are the protection.
- **Unpublished is not unreachable.** The host reaches every container address, and Prometheus,
  Loki and Tempo have no authentication. U8 carries this.
- **An event outside S6's control**, such as an unattended upgrade or a provider action that
  restarts the daemon or the LXC, would start all containers at once, in no order (S3.3b).
- **Alloy can read the environment of every container** through the proxy, including the
  application's secrets (S3, deferred). S6 starts Alloy on the VPS, so this accepted risk applies
  there from S6.

## 16. Out of scope

- S7: the application's observability overlay in production, the Java agent, labels, a deploy
  change.
- Any change to Compose files, scripts, CI, the deploy workflow, the README, the firewall
  documentation or the deferred-work list, except S6.7's close-out after the deployment.
- New host ports, network changes, resource limit changes, CPU limits or weights.
- B7, S3, S3.3b and the other deferred items.
- Log rotation, alerting, dashboards, backups of telemetry data.
- Validating the Grafana password reset; rotating the password.
- Migrating, inspecting by mount, or removing an existing volume.
- Changes to sshd, UFW, accounts or keys. If D2 chooses (a) or (c), that change is separate and
  comes before V7.
- A deployment workflow for the stack.

## 17. Acceptance checklist

S6 has not started. Every item is open.

- [ ] D1 to D4 decided; D7 if G9 asks for it; D5 and D6 recorded.
- [ ] S6.1: the preflight record complete, without an open STOP.
- [ ] S6.2: the archive from a verified commit (§7.1), extracted, `REVISION` written, `.env` and the
      secret created without the password appearing anywhere.
- [ ] S6.3, in the order of §4.1:
  - [ ] G1 to G10 and G12 PASS, recorded, before C5;
  - [ ] C5; the readout's self-test `ok` three times on the VPS; the pre-start sampler running;
        then G11 PASS;
  - [ ] G1 to G3 repeated, and G13a PASS on at least 30 min of the pre-start sampler, immediately
        before the pull.
- [ ] S6.4:
  - [ ] C3a; the pull with its readings, `ok: R-p met`;
  - [ ] G13b PASS on the samples that include the pull;
  - [ ] C3b; `up` within 15 min of G13b, with exactly the two files;
  - [ ] readiness of each service; the targeted logs clean.
- [ ] S6.5: V1 to V14 and V16 as expected; V15 recorded if run.
- [ ] S6.5: one `prod-check runtime` run, passed, with its failed login recorded.
- [ ] S6.5: R1 all `ok`; R3's wrapper `PASS` for exactly the eleven entities, with the sampler
      running before and after the readout; R4 evaluated, with any revisit item reported.
- [ ] No `down -v`, no prune, no ownership change, no added port, no changed limit, no edit of a
      tracked file on the VPS.
- [ ] S6.7: the documents updated from the observed facts, in their own PR.
- [ ] S7 not started.
