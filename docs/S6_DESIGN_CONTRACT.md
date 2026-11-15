# S6 Design Contract — First production deployment of the observability stack

**Status, 2026-11-15: draft for review (revision 1). Nothing in it has been run.**
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
| S6.3 | Pre-start gates | Nothing | — (read-only, inside the C2 or C3 session) |
| S6.4 | Pulls the six images, runs the first `up` | Images, networks, volumes, containers | C3 |
| S6.5 | Verifies the stack; one run of the production check; an idle sampling window | A sampler script and its log; one failed Grafana login | C4, C5 |
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
- **The consents**, each given by the operator for that step, at that time:

  | Consent | Covers | Requires first |
  |---|---|---|
  | C1 | The read-only preflight of S6.1 | This contract accepted |
  | C2 | Creating or changing files on the VPS in S6.2: `/var/nimuairy-observability`, the archive in `deploy`'s home, its extraction, `REVISION`, `observability/.env`, `observability/secrets/` | S6.1 recorded with no open STOP; D1 and D2 decided |
  | C3 | The image `pull` and the **first `docker compose up`** (S6.4) | Every gate of S6.3 passed and recorded; D3 and D4 decided; D7 decided if G9 asks for it |
  | C4 | **One** run of `scripts/observability-prod-check.sh runtime` (V6) | V1 to V5 passed |
  | C5 | The sampler of §10.3: saving its script and running it in the background in `deploy`'s home, where it writes its logs | D3 decided |

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
  the operator has started under C1 or C3.

## 5. Conventions

- **Who runs what.** The operator runs every VPS command and sends the output back for review. The
  agent writes no VPS command into a shell.
- **Block labels**, as in the guide's
  [Conventions](OBSERVABILITY_PRODUCTION.md#conventions): *VPS, read-only*; *VPS, changes files*;
  *VPS, changes runtime state*; *Local*. A block labelled *admin* runs as an administrative account
  with `sudo` (D2); all others run as `deploy`.
- **The shell.** Bash, interactive, without `set -e`. The blocks report each failure with `STOP` and
  do not rely on errexit.
- **Every production Compose command names exactly two files, in this order**:
  `docker compose -f observability/compose.yaml -f observability/compose.prod.yaml <command>`, run
  in `/var/nimuairy-observability`. Never `observability/compose.test.yaml`, `-p` or
  `COMPOSE_PROJECT_NAME`.
- **Tracked files on the VPS are never edited by hand.** A change comes through a new archive.
  Only `observability/.env` and `observability/secrets/` are written on the VPS.
- **Never printed, sent or recorded:** the Grafana password; Grafana's `/proc/1/environ`; a full
  `docker inspect` of an application container, which prints its secrets
  ([DEFERRED_WORK, S3](DEFERRED_WORK.md#s3--application-secrets-out-of-container-environment-variables));
  key material from `authorized_keys`.
- **The repository records no VPS host, SSH port, login or IP address**, and S6.7 keeps it so. It
  records facts such as "a public IPv6 address exists", not the address.
- **These commands have not run anywhere.** Each block passes `bash -n`, nothing more. The first run
  of each block on the VPS is itself evidence, and its output is reviewed before the next step.
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

- `security=` must not list `name=userns`: user-namespace remapping would change which host UIDs
  own the volumes (G7).
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

**VPS, read-only**, the last line as admin:

```bash
getent passwd | awk -F: '$7 !~ /(nologin|false|sync)$/ { print $1, $3, $7 }'
getent group docker sudo adm
who
systemctl list-units --type=service --state=running --no-pager --no-legend --plain | awk '{ print $1 }'
systemctl list-timers --all --no-pager --no-legend | awk '{ print $(NF-1), $NF }'
ls -l /etc/cron.d
sudo ls -l /var/spool/cron/crontabs
```

- These lists go to the operator's review for G6. They are not recorded in the repository.
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

**Admin, read-only**, for each account D2 considers, from inside an SSH session (the `addr` is the
client address of that session):

```bash
u=<user>
sudo sshd -T -C "user=$u,host=$(hostname),addr=${SSH_CONNECTION%% *}" | grep -E '^(allowtcpforwarding|disableforwarding|permitopen|authorizedkeysfile) '
h=$(getent passwd "$u" | cut -d: -f6)
echo "key lines: $(sudo grep -cvE '^[[:space:]]*(#|$)' "$h/.ssh/authorized_keys")"
sudo grep -noE '(^|,)(restrict|no-port-forwarding|port-forwarding|permitopen="[^"]*")' "$h/.ssh/authorized_keys"
```

- **The tunnel needs** `allowtcpforwarding` `yes` or `local`, `disableforwarding no`, and a
  `permitopen` that allows `127.0.0.1:3000` (`any` by default).
- **Per key**, the second `grep` prints only these options with their line numbers, never a key.
  A key with `restrict` and without `port-forwarding`, or with `no-port-forwarding`, cannot open the
  tunnel. A key the deploy workflow uses should keep such a restriction; the tunnel then needs
  another key or account (D2).
- If `authorizedkeysfile` is not the default `.ssh/authorized_keys`, read that file instead.
- The Alloy UI tunnel of V15 also needs `permitopen` to allow a container address.

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
for t in bash docker curl timeout od ss jq sha256sum tar; do printf '%-10s %s\n' "$t" "$(command -v "$t" || echo MISSING)"; done
sudo -n -l >/dev/null 2>&1 && echo 'deploy: passwordless sudo' || echo 'deploy: no passwordless sudo'
```

- **Expected:** `deploy` in the `docker` group, Bash as its shell, the engine answering, no
  variable listed, the production check's tools present. `jq` is optional (G4).
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
| P2 | `userns` in SecurityOptions; context | Absent; `default` | | |
| P2 | Log rotation in `daemon.json` | Recorded (D5) | | |
| P3 | Application containers | Four, healthy, limits as in S4.4 | | |
| P4 | Memory, CPU, PIDs, disk, `memory.stat` fields, event counters | Recorded as the baseline | | |
| P5 | Stack volumes, networks, containers; the directory | None; does not exist | | |
| P6 | Listeners on the stack's ports | None | | |
| P7 | Accounts, groups, services, timers, cron | Reviewed for G6 | | |
| P8 | Global IPv6, UFW, IPv6 listeners | Recorded for G9 | | |
| P9 | Forwarding for the D2 account(s) | Allowed for the tunnel account | | |
| P10 | `deploy`, environment, tools, sudo | As expected above | | |

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
- **All gates pass, and their outputs are recorded, before C3.** G1 to G3 run again immediately
  before the first `up` (S6.4, step 2), because a day can pass between S6.2 and S6.4.
- **Each gate is PASS, FAIL or INCONCLUSIVE.** A failed or inconclusive gate blocks C3 until it is
  resolved explicitly (§4).
- **The gates only read.** A gate's resolution that changes state has its own consent.

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
| G11 | Timing, the release freeze and the baseline | §10.3's R0 |

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

- **Command:** P7, and P6's optional process list.
- **Expected:** the operator reviews every account with a login shell, every member of `docker`
  and `sudo`, every running service and timer, every cron entry and every listener, and confirms in
  writing, with the date, that none is untrusted.
- **Why it matters:** the port reset is no boundary against processes on the host. Prometheus,
  Loki and Tempo have no authentication, and the host reaches every container address
  ([S4b §4.4](S4b_DESIGN_CONTRACT.md#44-what-the-port-policy-protects-and-what-it-does-not)).
- **STOP** on an entry the operator cannot account for.
- **Next allowed action:** explain or remove it in a separate change, then confirm again.
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

- **Expected:** every ID `mapped`, and P2 without `name=userns`.
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
- **Next allowed action:** on PASS, the next gate; otherwise D7, and C3 only after it.

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

### G11. Timing, freeze and baseline

- **Command:** **Local:** `gh run list --workflow release.yml --limit 5`, or GitHub's Actions view.
  **VPS, read-only:** `date` (the VPS's local time), then R0 of §10.3.
- **Expected:** no release run in progress, none planned until the window of §10.3 ends, the time
  outside 03:00–04:00, and R0 recorded.
- **Timing:** the first `up` starts when the operator can watch the VPS for at least an hour, not
  within 03:00–04:00 of the VPS's time zone (P1), the window of the daily backup.
- **Release freeze (D4):** no `release.yml` run from C3 to the end of the sampling window of
  §10.3. No other manual operation on the application in that time.
- **Baseline R0** (§10.3): the readings right before the pull. If C5 is given, the pre-start
  sampler is started here.
- **STOP** if a release is running or planned in that time.
- **Next allowed action:** choose another time, after the release has finished and its own checks
  have passed.

## 9. S6.4 — First startup

**Consent:** C3. **Where:** `/var/nimuairy-observability`, as `deploy`.

**Rules:**
- exactly `-f observability/compose.yaml -f observability/compose.prod.yaml`;
- never `observability/compose.test.yaml`, `-p` or `COMPOSE_PROJECT_NAME`;
- no added host port, no network change, no limit change, no deferred work;
- no `--force-recreate` and no `down`.

**Steps:**

1. **The revision.** `cat REVISION` names the SHA of S6.2.
2. **G1 to G3 again**, immediately before. Any `STOP` ends S6.4 here.
3. **R0 and the pre-start sampler** (§10.3), if C5 covers it.
4. **Pull.** **VPS, changes runtime state** (images only):

   ```bash
   cd /var/nimuairy-observability
   date -u +%FT%TZ
   docker compose -f observability/compose.yaml -f observability/compose.prod.yaml pull; echo "pull exit=$?"
   docker image inspect -f '{{index .RepoTags 0}} {{index .RepoDigests 0}} {{.Size}}' \
     prom/prometheus:v3.15.0 grafana/loki:3.7.8 grafana/tempo:3.1.0 grafana/alloy:v1.20.1 \
     wollomatic/socket-proxy:1.13.2 grafana/grafana-oss:13.0.2
   d=$(docker info -f '{{.DockerRootDir}}') && df -hT "$d"
   ```

   - Expected: exit 0, six digests recorded, the disk still above G10's threshold.
   - The tags are those of `ff0139a`'s `observability/compose.yaml`. An archive from another commit
     names its own.
   - Pulling first keeps the download out of `up`'s wait and shows the disk use on its own.
5. **The first start.** **VPS, changes runtime state.** Record the time first; V3 compares the
   volumes with it:

   ```bash
   cd /var/nimuairy-observability
   t_up=$(date -u +%FT%TZ); echo "t_up=$t_up"
   docker compose -f observability/compose.yaml -f observability/compose.prod.yaml up -d --wait --wait-timeout 180; echo "up exit=$? at $(date -u +%FT%TZ)"
   ```

   It creates the three networks, the five volumes and the six containers.
6. **Readiness, one service at a time.** **VPS, read-only.** Loki reports ready only about 15 s
   after it starts, so repeat a failed check for up to 2 minutes before reading it as a failure:

   ```bash
   docker inspect -f '{{.Name}} {{.State.Status}}{{if .State.Health}} {{.State.Health.Status}}{{end}} restarts={{.RestartCount}} oomkilled={{.State.OOMKilled}} started={{.State.StartedAt}}' prometheus loki tempo alloy docker-socket-proxy grafana
   docker exec prometheus wget -qO- http://localhost:9090/-/ready; echo " prometheus exit=$?"
   docker exec prometheus wget -qO- http://loki:3100/ready; echo " loki exit=$?"
   docker exec prometheus wget -qO- http://tempo:3200/ready; echo " tempo exit=$?"
   docker exec prometheus wget -qO- http://alloy:12345/-/ready; echo " alloy exit=$?"
   docker exec grafana wget -qO- http://localhost:3000/api/health; echo " grafana exit=$?"
   ```

7. **Targeted logs.** **VPS, read-only.** Only after step 6 showed all six containers, so that a
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
- So only steps 6 and 7, and then S6.5, decide whether the start worked.

**Outcome.** `up` exit 0, every container running, the three health checks healthy, the five
readiness checks answering, and no line from the first four log checks: go on to S6.5. Anything else:
S6.6, and no further S6.4 command.

## 10. S6.5 — Post-start verification

### 10.1 Checklist

Read-only unless marked. Record each result, with the time, in the S6 record.

| # | Check | Command | Expected |
|---|---|---|---|
| V1 | Six services, state, restarts, OOM | The `docker inspect` template of S6.4, step 6 | All `running`; Prometheus, Grafana and the proxy `healthy`; `restarts=0`; `oomkilled=false`; every `started` after `t_up` |
| V2 | Readiness | S6.4, step 6, again after at least 5 min | Every check answers. Health is not readiness: Grafana `healthy` says nothing about its data sources (V7) |
| V3 | The volumes are new | Block V3 below | Five volumes, each `created` after `t_up`, with the project label. Without this, P-R4 and the Tempo checks could pass on pre-existing state |
| V4 | Networks | Block V4 below | The three networks with the project label; `nimuairy-observability_docker-api` `internal=true` |
| V5 | Bindings | `docker ps --format '{{.Names}}\t{{.Ports}}'`; `docker port grafana`; `ss -Hltn` | Only Grafana shows a `->`: `127.0.0.1:3000->3000/tcp`. `docker port grafana` prints exactly `3000/tcp -> 127.0.0.1:3000`. The `ss` lines are information |
| V6 | The production check, once (C4) | §10.2 | `All checks passed` |
| V7 | Grafana through the tunnel, and its data sources | Block V7 below | Login works; Prometheus, Loki and Tempo answer `OK` |
| V8 | Prometheus targets | Block V8 below | `prometheus` and `alloy` `up`; `nimuairy-api` `down`, by design until S7: the backend is on no network of the stack, so its `lastError` most likely names a failed lookup |
| V9 | Alloy's discovery path | Block V9 below | Alloy running for at least 5 min; no `Unable to refresh target groups`; no `blocked request` from Alloy's address |
| V10 | The socket proxy | `docker inspect -f '{{.State.Status}} {{.State.Health.Status}} restarts={{.RestartCount}}' docker-socket-proxy`; its log as in S6.4, step 7 | `running healthy restarts=0`; no `socket not available`, no `blocked request` at all |
| V11 | U9 at runtime: the processes' identities | Block V11 below | Uid 65534, 10001, 10001, 473, 65534, 472; Gid 10001 for Tempo, 473 for Alloy, the socket group for the proxy |
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
cd /var/nimuairy-observability
for ds in prometheus loki tempo; do
  printf 'user = "admin:%s"\n' "$(< observability/secrets/grafana_admin_password)" |
    curl -K - -sS --max-time 10 "http://127.0.0.1:3000/api/datasources/uid/$ds/health" | grep -oE '"status":"[A-Z]+"' | sed "s/^/$ds /"
done
```

`printf` is a builtin, so the password is in no process's arguments; curl reads it from stdin, as
the production check does. Each data source must print `"status":"OK"`.

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
for c in prometheus loki tempo alloy docker-socket-proxy grafana; do
  pid=$(docker inspect -f '{{.State.Pid}}' "$c") && printf '%-20s %s\n' "$c" "$(awk '$1 == "Uid:" || $1 == "Gid:" { printf "%s %s ", $1, $2 }' "/proc/$pid/status")"
done
```

The IDs are those in the LXC's namespace, which G7 found mapped.

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
cd /var/nimuairy-observability
date -u +%FT%TZ
env -u GRAFANA_AUTH -u OBSERVABILITY_COMPOSE_FILES bash scripts/observability-prod-check.sh runtime; echo "exit=$? at $(date -u +%FT%TZ)"
```

- **Preconditions:** V1 to V5 passed; nobody has logged in to Grafana yet, so the check's failed
  login is the only one.
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

**R0, the baseline before the pull (G11).** **VPS, read-only:** P4's blocks, and the R1 loop below
with only the four application lines.

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

**R2, sampling (C5).** The sampler extends A.3's: the LXC's visible root, any containers named as
arguments, more `memory.stat` fields, and at the root `MemAvailable` and memory pressure.

Save as `~/s6-sampler.sh`. **VPS, changes files** (the script and its logs in `deploy`'s home); it
only reads the system:

```bash
#!/usr/bin/env bash
# S6's read-only sampler (docs/S6_DESIGN_CONTRACT.md, section 10.3): every 10 s, the LXC's visible
# root cgroup and the cgroups of the containers named as arguments. It resolves each container's
# cgroup once at start: a restart keeps the path, a recreate does not.
out=~/s6-sample-$(date -u +%Y%m%dT%H%M%SZ).log
fields='^(anon|file|shmem|inactive_file|kernel|kernel_stack|pagetables|percpu|sock|vmalloc|slab_reclaimable|slab_unreclaimable|workingset_refault_file|pgmajfault)$'
declare -A cg=([lxc-root]=/sys/fs/cgroup)
for c in "$@"; do
  pid=$(docker inspect -f '{{.State.Pid}}' "$c") && [ "$pid" != 0 ] || { echo "no running container $c" >&2; exit 1; }
  cg[$c]=/sys/fs/cgroup$(sed -n 's/^0:://p' "/proc/$pid/cgroup")
done
echo "sampling ${!cg[*]} into $out"
while sleep 10; do
  now=$(date -u +%FT%TZ)
  for c in "${!cg[@]}"; do
    d=${cg[$c]}
    extra=
    if [ "$c" = lxc-root ]; then
      extra="MemAvailable_kB=$(awk '$1 == "MemAvailable:" { print $2 }' /proc/meminfo) $(awk '$1 == "some" { print "memory_some_" $2 }' "$d/memory.pressure")"
    fi
    echo "$now $c memory.current=$(cat "$d/memory.current") pids.current=$(cat "$d/pids.current")" \
      "$(awk -v re="$fields" '$1 ~ re { printf "%s=%s ", $1, $2 }' "$d/memory.stat")$extra"
  done >> "$out"
done
```

**Before the pull (G11)**, the root and the four application containers, so that the window shows
the stack's start:

```bash
nohup bash ~/s6-sampler.sh postgres-nimuairy backend-nimuairy frontend-nimuairy cloudflared-nimuairy > ~/s6-sampler-pre.out 2>&1 &
echo "pre-start sampler PID $!"
```

**After R1**, stop it (`kill <PID>`) and start the window's sampler for all ten:

```bash
nohup bash ~/s6-sampler.sh prometheus loki tempo alloy docker-socket-proxy grafana \
  postgres-nimuairy backend-nimuairy frontend-nimuairy cloudflared-nimuairy > ~/s6-sampler.out 2>&1 &
echo "sampler PID $!"
```

- **The window:** at least 24 h from R1, including one 03:30 backup, with no release, no manual
  restart and no recreate in it (D3, D4). A reboot, a daemon restart or a recreate inside the window
  ends it; record the event and start a new window.
- The first line of each `.out` file names its log.
- **Size** [ESTIMATE]: eleven lines of about 400 bytes every 10 s, about 40 MB a day.

**R3, at the end of the window.** **VPS, read-only:**
1. R1 again. Every event counter must equal R1's. The cumulative CPU and pressure values minus R1's
   give the window's CPU time and stall time per container.
2. V1, V2, V10, V14 and V16 again. Check the backup in the journal
   (`journalctl -t nimuairy-backup --since <window start>`,
   [README, Database backups](../README.md#database-backups)).
3. The readout of each log file:

```bash
awk '{ delete v; for (i = 3; i <= NF; i++) { split($i, kv, "="); v[kv[1]] = kv[2] }
       c = $2; n[c]++; if (!(c in first)) first[c] = $1; last[c] = $1
       ws = v["memory.current"] - v["inactive_file"]
       if ("kernel" in v) { k = v["kernel"]; kf[c] = 1 }
       else k = v["kernel_stack"] + v["pagetables"] + v["percpu"] + v["slab_reclaimable"] + v["slab_unreclaimable"] + v["vmalloc"]
       nr = v["anon"] + v["shmem"] + k + v["sock"]
       if (ws > maxws[c]) { maxws[c] = ws; atws[c] = $1 }
       if (nr > maxnr[c]) { maxnr[c] = nr; atnr[c] = $1 }
       if (v["pids.current"] + 0 > maxp[c] + 0) maxp[c] = v["pids.current"]
       if (c == "lxc-root" && (!(c in minav) || v["MemAvailable_kB"] + 0 < minav[c])) { minav[c] = v["MemAvailable_kB"] + 0; atav = $1 } }
     END { for (c in n) printf "%s: %d samples %s..%s; WS max %.1f MiB at %s; anon+shmem+kernel+sock max %.1f MiB at %s (kernel %s); pids.current max %s\n",
             c, n[c], first[c], last[c], maxws[c] / 1048576, atws[c], maxnr[c] / 1048576, atnr[c], (c in kf) ? "field" : "from its parts, ESTIMATE", maxp[c]
           if ("lxc-root" in minav) printf "lxc-root: MemAvailable min %.1f MiB at %s\n", minav["lxc-root"] / 1024, atav }' ~/s6-sample-<UTC>.log
```

- The working set is `memory.current − inactive_file`, as `docker stats` shows it.
- **The root's `anon + shmem + kernel + sock`** is the observed `H + P + O` of the whole LXC,
  without the file working set K ([Memory components](VPS_RESOURCE_BUDGET.md#memory-components)).
  Its maximum is the "observed" value of the budget's
  [Peaks that can coincide](VPS_RESOURCE_BUDGET.md#peaks-that-can-coincide).
- **The containers' maxima are attribution**, from different samples. They are not added up to a
  total.
- Without a `kernel` field, kernel memory is the sum of its parts: an [ESTIMATE] that matched the
  `kernel` field within 0.1 MiB locally, unverified on 5.15.
- `workingset_refault_file` and `pgmajfault` are cumulative: compare the first and last samples. A
  steady rise is the budget's sign that K does not fit.

**R4, evaluation (proposed criteria, D3).** The idle measurement succeeds when all of these hold:
- **M1:** R1 is all `ok`, for all ten containers.
- **M2:** the window ran at least 24 h, with one 03:30 backup, and without a release, a manual
  restart, a recreate, a reboot or a daemon restart.
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

## 12. S6.7 — Documentation close-out

**Only after S6.5's acceptance**, from observed facts, in its own PR. Nothing below is changed
before the deployment has succeeded.

| Document | Change | From |
|---|---|---|
| `README.md`, Observability | The stack runs in production on the VPS, from `/var/nimuairy-observability`, monitoring itself until S7; a link to the production guide | V1, V6 |
| `docs/VPS_FIREWALL.md` | The sentence that the production Compose files publish no host ports gets the stack's exception: Grafana's `127.0.0.1:3000`, loopback only, reached through SSH. Prometheus, Loki, Tempo, Alloy and the proxy publish nothing. UFW and the policy are unchanged. U12's result, without the address | V5, V6, G9, V15 |
| `docs/VPS_RESOURCE_BUDGET.md` | The stack in the services table as running; a section with the idle measurements: R1's settings, R3's maxima per container and at the root, the window, the events; the O-idle row of Outstanding verification; the `memory.stat` field list; the open questions of §10.4 | §10.3 |
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
- the seven stages and the consents C1 to C5 (§4);
- the preflight P1 to P10 and its record (§6);
- the commit rule of §7.1, the directory of §7.2, the hand-over of §7.3, and the creation blocks of
  §7.4 and §7.5;
- the gates G1 to G11 (§8);
- the startup steps (§9);
- the checklist V1 to V16 and the single production check run (§10.1, §10.2);
- the resource procedure R0 to R4 (§10.3), with the thresholds of D3;
- the recovery table (§11) and the close-out (§12).

### 13.3 Open: decisions for the operator

| # | Question | Options | Recommendation |
|---|---|---|---|
| D1 | The Grafana secret's owner and mode | A: 0644, `deploy`, in a 0700 `deploy` directory. B: 0400, UID 472 | **A** (§7.5): no root, the production check runs as `deploy`, and B protects nothing further on this host. Also the password rule of §7.5: 32 or more letters and digits |
| D2 | The SSH account that copies the archive and opens the tunnels | (a) `deploy` with a key of its own for the operator, without `restrict`: a new `authorized_keys` entry, itself a VPS change. (b) The operator's existing administrative account: `scp` to it, then §7.3's hand-over; the tunnel through it. (c) A new tunnel-only account whose key allows only `port-forwarding` to `127.0.0.1:3000`: least privilege, but a new account, and the Alloy UI tunnel would need a wider `permitopen` | **(b) for S6**, if P9 shows that it may forward: it needs no new account or key. Whether to add (c) for routine Grafana access later is a separate decision. The key the deploy workflow uses keeps its restrictions in every option |
| D3 | The measurement procedure and its thresholds | The window (24 h, one backup); the pre-start sampler; M1 to M7; the STOP and revisit values; the reserve of 20–25 %; G10's 10 GiB | **As proposed** in §10.3 and G10 |
| D4 | Releases and image updates during S6 | Freeze: no `release.yml` from C3 to the end of the window; #103 to #108 stay unmerged until S6 closes. Or no freeze | **Freeze.** The measurements stay attributable, and the deployed images are those CI verified at `ff0139a`. After S6, the guide's update sequence takes one image at a time |
| D5 | Docker's JSON log rotation | Record only in S6. Or configure rotation: daemon-wide in `daemon.json`, which needs a daemon restart, affects the application and applies only to containers created afterwards [S, Docker's logging documentation, not re-read for this contract]; or per service with Compose's `logging`, a repository change that the limits check's allowlist would have to admit for the overlay | **Record only in S6** (V14, R3). Decide afterwards from the measured growth, in a separate change |
| D6 | Whether a restart picks up a configuration file that an extraction replaced | Test it in S6 with a re-extraction and a restart. Or at the first real update | **At the first update that changes a configuration file:** after `restart prometheus`, `docker exec prometheus wget -qO- http://localhost:9090/api/v1/status/config` must show the new content. S6 delivers fresh files and replaces none; until then the guide's restart instruction stays, and its item stays open |
| D7 | U12, if G9 is not a PASS | Go ahead with the gap recorded. Or fix the firewall first, in a separate change | **Decide from P8's facts.** The stack adds no IPv6 listener in either case |

## 14. Assumptions and open items

| Item | Source | S6 step | Status before S6 |
|---|---|---|---|
| U1: a Linux engine refuses a missing bind source for a file secret | S4b §12.1 | Not tested: G5 makes sure the file exists, and S6 runs no negative experiment on production | Unverified; the guard does not depend on it |
| U3: an unreadable secret leaves the password empty | S4b §12.1 | Not tested | Not observed; the guard does not depend on it |
| U7: Compose on the VPS applies `!reset` | S4b §12.1 | G4 | Open |
| U8: no untrusted users or services on the host | S4b §12.1 | G6 | Open |
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
| The `memory.stat` fields of the VPS's kernel | Budget | P4 | Open |
| The local port 13000's side effects on Grafana's links | Guide | V7 | Open |
| The address nginx logs behind the Cloudflare Tunnel; the application's telemetry | Guide | S7 | Not S6 |
| S3, S3.3b, B7 | DEFERRED_WORK | None | Deferred. S3.3b is to be reconsidered before Alloy collects logs, so before S7; S6 collects none |

## 15. Risks

- **The whole LXC can run out of memory while every container is below its own limit.** The limits
  overcommit T by 1344 MiB. `oom_score_adj: 500` makes the kernel prefer the stack's processes as
  victims; it protects nothing, and reclaim stalls slow the application before any kill
  ([S4.4 §8](S4.4_DESIGN_CONTRACT.md#8-oom-behaviour-and-oom_score_adj-h2)).
- **T is inferred.** A lower effective limit would bring that OOM sooner.
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
- [ ] S6.3: G1 to G11 PASS, recorded; G1 to G3 repeated immediately before `up`.
- [ ] S6.4: `up` with exactly the two files; readiness of each service; the targeted logs clean.
- [ ] S6.5: V1 to V14 and V16 as expected; V15 recorded if run.
- [ ] S6.5: one `prod-check runtime` run, passed, with its failed login recorded.
- [ ] S6.5: R1 all `ok`; the window of R2 complete; R3 read; R4 evaluated, with any revisit item
      reported.
- [ ] No `down -v`, no prune, no ownership change, no added port, no changed limit, no edit of a
      tracked file on the VPS.
- [ ] S6.7: the documents updated from the observed facts, in their own PR.
- [ ] S7 not started.
