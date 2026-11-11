# VPS resource budget

The memory, CPU, PIDs and disk budget for running the application and the observability stack
together on the production VPS. It is the result of S4.3 (resource assessment). It records what was
measured, what was only reported or estimated, and what is still unknown. S4.4 sets per-container
resource limits from it, and the measurements after S6 and S7 validate it.

The stack itself, its configuration and how to run it are in [OBSERVABILITY.md](OBSERVABILITY.md).

## Evidence labels

Every measured or derived value carries one of these labels. Configuration facts come from the
repository files named next to them.

| Label | Meaning |
|---|---|
| VPS | Measured on the production VPS |
| LOCAL | Measured on Docker Desktop with WSL2. Never a production value |
| USER-REPORTED | Stated by the operator, not measured independently |
| ESTIMATE | Calculated or extrapolated from measurements; the inputs are named |
| UNKNOWN | Not verified yet |

## Scope and workload

### Services

| Service | Configured image (Compose) | Storage | What drives its resource use |
|---|---|---|---|
| `postgres-nimuairy` | `dhi.io/postgres:18-debian13` | volume `postgres` | PostgreSQL defaults; the repository sets no configuration. `pg_dump` and `pg_restore` from `scripts/backup-db.sh` run inside this container |
| `backend-nimuairy` | `ghcr.io/pawelzajglicz/nimuairy-api:${APP_SHA}` | none | `java -jar app.jar` without heap or GC flags, so the JVM sizes itself from the CPUs and memory it detects. The health check starts a second, short-lived JVM without the Java agent (`-XX:+UseSerialGC -Xmx16m`) in the same container every 30 s, and every 3 s during the 90 s start period (`nimuairy-api/Dockerfile`) |
| `frontend-nimuairy` | `ghcr.io/pawelzajglicz/nimuairy-frontend:${APP_SHA}` | none | nginx. The worker count comes from the image's main configuration, not from this repository |
| `cloudflared-nimuairy` | `cloudflare/cloudflared:2026.10.1` | none | The Cloudflare Tunnel; production only |
| `prometheus` | `prom/prometheus:v3.15.0` | volume `prom-data` | Retention 15 days (`--storage.tsdb.retention.time=15d`); scrapes every 15 s |
| `loki` | `grafana/loki:3.7.8` | volume `loki-data` | Retention 168 h (`loki/loki-config.yaml`); single binary |
| `tempo` | `grafana/tempo:3.1.0` | volume `tempo-data` | Retention 168 h (`block_retention` in `tempo/tempo.yaml`); WAL and local blocks |
| `alloy` | `grafana/alloy:v1.20.1` | volume `alloy-data` (read positions) | Tails the logs of containers labelled `observability.logs=true` |
| `docker-socket-proxy` | `wollomatic/socket-proxy:1.13.2` | none | Passes on Alloy's Docker API reads |
| `grafana` | `grafana/grafana-oss:13.0.2` | volume `grafana-data` | Idle unless someone queries it |

- The first four run on the VPS today, from `compose.yaml` and `compose.prod.yaml`. The other six come
  from `observability/compose.yaml` and are not on the VPS yet. `observability/compose.prod.yaml`
  does not exist yet.
- The rollout stages named here:
  - **S4.4** sets per-container resource limits;
  - **S6** starts the stack on the VPS;
  - **S7** attaches the app to it with `compose.observability.yaml`: the Java agent, metrics on
    `:9464`, traces to Tempo, JSON logs and the log labels.
- No Compose file sets `mem_limit`, `memswap_limit`, `cpus`, `pids_limit`, `ulimits` or `logging`.
  Every service uses `restart: unless-stopped`.

### Recurring load

| Load | When | Accounted in |
|---|---|---|
| User traffic | [UNKNOWN] | backend, frontend, postgres, cloudflared |
| Backend health check | Every 30 s; every 3 s during the 90 s start period | The probe JVM: backend container. Its request: the main backend JVM |
| Database backup (`pg_dump`, then `pg_restore` reading the dump back) | Daily at 03:30 from cron, and before each deploy ([README](../README.md#database-backups)) | postgres container |
| Off-site upload (`rclone copy`) | After each backup that cron runs | host |
| apt timers | `apt-daily` at 06:00 and 18:00 plus up to 12 h, `apt-daily-upgrade` at 06:00 plus up to 60 min ([VPS_UNATTENDED_UPGRADES.md](VPS_UNATTENDED_UPGRADES.md#files-and-units)) | host |
| Deploy ([deploy-on-vps.yml](../.github/workflows/deploy-on-vps.yml)) | On release: pre-deploy backup, `pull backend frontend`, then `up -d --wait` with a 180 s timeout, which starts a new backend JVM | postgres, backend, host |

The health check involves two JVMs:

- **The probe** is a separate, short-lived JVM that runs `HealthCheck`
  (`nimuairy-api/docker/HealthCheck.java`) without the Java agent. Its memory and CPU are charged to
  the backend container.
- **The request it sends**, `GET /actuator/health`, is served by the main backend JVM.
  - From S7 that JVM carries the agent (`compose.observability.yaml`). The agent traces incoming
    requests under its default sampler, `parentbased_always_on`
    ([OBSERVABILITY.md, stage 1](OBSERVABILITY.md#verify) and
    [stage 3](OBSERVABILITY.md#limits)).
  - In the local run, the agent's request counter for the `/actuator/health` route rose from 11 to
    85 over the window. Tempo's distributor kept receiving spans in the idle phase, when no test
    traffic was sent [LOCAL].
- **The request count**: the 30 s interval gives about 2,880 health-check HTTP requests per 24 h of
  uninterrupted operation. Each 90 s start period adds more at 3 s intervals. This is the nominal
  number of requests, not a number of traces.

## VPS constraints

### Before the upgrade

VPS, 2026-11-10.

| Item | Value |
|---|---|
| OS and isolation | Ubuntu 24.04.5 LTS in an unprivileged LXC container; kernel `7.0.14-26-pve`, the provider's |
| Docker | Engine 29.8.2; cgroup v2 with the `systemd` driver; storage driver `overlayfs`; logging driver `json-file` |
| CPU | One available CPU; the effective cpuset was CPU ID 17 in the latest consistent sample |
| Memory | 2.25 GiB (2304 MiB) as reported by LXCFS and Docker. The visible root cgroup has `memory.max=max`: no finite limit is exposed at the visible cgroup root. The effective outer LXC limit remains unverified until the post-upgrade measurements are available |
| Swap | None reported |
| Limit enforcement | `docker info` reports `MemoryLimit`, `SwapLimit`, `PidsLimit`, `CPUCfsQuota` and `CPUShares` as `true`. The `memory`, `cpu`, `cpuset` and `pids` controllers were available and enabled |
| Container limits | None configured |
| PIDs | Root cgroup `pids.max=max`; container cgroups `pids.max=287749`; root `pids.current=161` and `pids.peak=208`; `pids.events` `max 0` |
| Disk | 30 GB total, 26 GB free |
| Container logs | `json-file` with empty log options; no rotation options in `/etc/docker/daemon.json` |

### After the upgrade

The VPS was upgraded [USER-REPORTED]. Readings after the upgrade [VPS]:

| Item | Before the upgrade | After the upgrade |
|---|---|---|
| RAM visible in the VPS | about 2.25 GiB (2304 MiB) | 4.25 GiB (4352 MiB) |
| Disk | 30 GB | 45 GB |
| Free disk space | about 26 GB | about 40 GB |
| Kernel | `7.0.14-26-pve` | `5.15.158-2-pve`. Why it changed is not determined |
| Root cgroup memory | `memory.max=max` | `memory.max=max`, `memory.high=max`; `memory.current` about 1.15 GiB, which includes page cache; every `memory.events` counter 0 |
| CPU | One CPU; cpuset CPU ID 17 | `nproc` 1, `cpuset.cpus.effective` 0; `cpu.max` `max 100000`, so no CFS quota at this level; `nr_throttled` 0 |
| PIDs | Root `pids.max=max`, `pids.current=161`, `pids.peak=208` | Root `pids.max=max`, `pids.current=159`; `pids.events` `max 0` |
| Swap | None reported | `SwapTotal` 0, but `/proc/swaps` and `swapon --show` list a virtual entry, `none virtual 4G` |

- **Memory:** the visible RAM grew by 2 GiB. The effective outer LXC limit is still [UNKNOWN],
  because `memory.max=max` at the visible root does not settle it.
- **CPU:** the upgrade did not add a CPU. One CPU remains the production constraint.
- **Swap:**
  - the guest reports `SwapTotal` 0, while `/proc/swaps` shows the virtual 4G entry;
  - the swap configuration and its availability on the host side are [UNKNOWN];
  - this budget does not count on swap: swap is not a substitute for memory.
- **Kernel memory:** the filtered `memory.stat` output had no `kernel` field. Kernel memory on the VPS
  is not computed until the fields this kernel provides have been checked [UNKNOWN].
- **Docker:** the `docker info` values (NCPU, MemTotal, limit support) are not recorded here
  [UNKNOWN].

## Measured VPS usage

VPS, 2026-11-10, before the upgrade. The backend ran without the Java agent, and the observability
stack was not on the VPS.

| Container | `docker stats` MEM USAGE |
|---|---|
| backend | about 829–872 MiB |
| postgres | about 54–72 MiB |
| cloudflared | about 23–38 MiB |
| frontend | about 3–4 MiB |

- The four ranges were collected at different times. Adding them gives an estimated 909–986 MiB
  [ESTIMATE]. This is a sum of separately observed ranges, not a simultaneous measurement.
- During the short active session, the visible cgroup's `memory.current` rose from about 1.60 GiB
  to about 1.68 GiB. It includes page cache, so it is not a memory requirement.
- The visible cgroup's historical `memory.peak` was about 2.19 GiB. It covers the time since that
  cgroup was created and includes page cache. It is neither the effective RAM limit nor the peak of
  the short window.
- No memory OOM events and no memory pressure (PSI). CPU pressure was low, and no CFS throttling was
  observed.
- PIDs: typically 163, briefly 178 during the active session; an earlier system-level peak of 208
  (root `pids.peak`). No task creation hit a PID limit (`pids.events` `max 0`).

After the upgrade, one `docker stats` sample [VPS]:

| Container | `docker stats` MEM USAGE |
|---|---|
| backend | 696.8 MiB |
| postgres | 58.73 MiB |
| cloudflared | 18.2 MiB |
| frontend | 3.15 MiB |

- All four containers had `RestartCount` 0 and `OOMKilled` false.
- This is a single sample, not peak demand.
- The backend's value is below its pre-upgrade range. The reason is not determined: the sample
  alone shows neither the backend's uptime nor how its JVM sized itself after the upgrade.

## Local measurements

LOCAL, 2026-11-10. These values show shapes and proportions, not production values (see
[Reference levels](#reference-levels)).

- **Environment**:
  - Windows 11 Home, Docker Desktop 4.96.3, Docker Engine 29.9.2 (API 1.56);
  - WSL 3.0.5.0 with kernel 6.18.58.1, cgroup v2;
  - the Docker Desktop VM had 16 CPUs, 31.05 GiB of RAM and 8 GiB of swap, and swap use stayed at
    zero;
  - no container limits.
- **Containers**: backend (with the Java agent), postgres and frontend; Prometheus, Loki, Tempo,
  Alloy, Grafana and the socket proxy. No cloudflared, which belongs to the production overlay.
- **Phases**, with cgroup files sampled every 15 s:
  - a cold start of all nine containers, then a settle period;
  - 5 minutes idle;
  - 15 minutes of ingestion at exactly one sequential request per second, through nginx;
  - three short read-only queries, one each against Loki, Tempo and Prometheus;
  - 5 minutes of cooldown.
- **Telemetry**: all 900 requests returned HTTP 200.
  - Loki held the 900 marked nginx lines.
  - Tempo's distributor received about 1,005 spans.
  - Prometheus's request counter increased by about 914 (an extrapolated `increase()`).

`anon + shmem`, the memory that cannot be reclaimed without swap, in MiB:

| Phase | All nine, avg / max | App max | Observability max |
|---|---|---|---|
| Idle | 1004 / 1031 | 585 | 446 |
| Ingest | 1083 / 1115 | 605 | 515 |
| Cooldown | 1141 / 1158 | 603 | 555 |

Kernel memory (`kernel`) of the same nine containers, and the total with it, in MiB. `sock` was 0
throughout:

| Phase | All nine `kernel`, avg / max | All nine `anon + shmem + kernel`, avg / max | App max | Observability max |
|---|---|---|---|---|
| Idle | 35 / 36 | 1040 / 1067 | 598 | 469 |
| Ingest | 36 / 37 | 1119 / 1151 | 619 | 538 |
| Cooldown | 37 / 37 | 1178 / 1194 | 616 | 579 |

- **Kernel memory per container**: Grafana had the most (10 MiB), then postgres and Tempo (7 MiB
  each).
- **`shmem` sits inside `file`**: postgres's `memory.current` matched `anon + file + kernel` without
  its 17 MiB of `shmem` being added on top.

- **CPU**: the app and the stack together used at most about 0.07 cores in any phase.
- **Tempo** grew through the whole window. Its Go heap in use averaged about 140, 187 and 242 MiB in
  the idle, ingest and cooldown phases, and had not levelled off at the end.
- **Backend `memory.peak`** ended about 23 MiB above the highest 15-s sample. The rises fell on the
  health check's probe JVM's 30-s cadence; that cause is inferred from the timing, not measured
  directly.
- **Runtime sizing**: none of it carries over to the VPS.
  - The JVM saw 16 CPUs and about 31 GiB. It chose G1 and a maximum heap of 7952 MiB (about
    7.77 GiB), consistent with 25 % of 31.05 GiB.
  - The Go services ran with `GOMAXPROCS=16`.
  - Prometheus derived a `GOMEMLIMIT` of 27.9 GiB from the host memory.
- **Page cache** is charged to the cgroup that first reads a page, so a container's file memory
  depends on the VM's history.
  - After the restart, Alloy was charged 420 MiB of file pages. On 2026-11-02 it had almost none,
    while its anonymous memory was about 58 MiB both times.
  - Compare `anon + shmem` and `kernel` between runs, and treat file cache separately.
- **`docker stats`** MEM USAGE equalled the container cgroup's `memory.current − inactive_file`.
- **Not covered**: the window had no Prometheus head compaction, no Tempo flush or compaction, and
  nothing of the retention periods.

## Budget model

The VPS fits the workload only if

`T ≥ H + P + O + K + R`

with every term at its peak:
- **H, P and O** each count `anon + shmem + kernel + sock` for their processes.
- **K** counts the file working set without `shmem`.
- **R** is a reserve on top.

### Memory components

A cgroup's memory limit applies to everything charged to the cgroup (`memory.current`), not only to
its anonymous memory. `memory.current` is approximately `anon + file + kernel + sock`; in the local
run the difference stayed within 2.5 MiB [LOCAL]. The fields are described in the
[Linux cgroup v2 documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html).

| Component | `memory.stat` fields | Reclaimable | Term |
|---|---|---|---|
| Anonymous and shared memory | `anon`, and `shmem`, which is part of `file` | No: the budget does not count on swap | H, P, O |
| Kernel memory | `kernel`, which already includes `kernel_stack`, `pagetables`, `percpu`, `vmalloc` and the slab (`slab_reclaimable`, `slab_unreclaimable`). `sock` (network buffers) is charged separately | Only the reclaimable slab, under memory pressure. Budget it as not reclaimable | H, P, O |
| File working set | The part of `file` other than `shmem` that is in active use | Yes, but reclaiming it causes refaults and thrashing | K |
| Cold file cache | The rest of `file`, mostly `inactive_file` | Yes | None |
| Safety reserve | None | None | R |

### Terms

| Term | Meaning | How to measure it on the VPS | Current evidence |
|---|---|---|---|
| T | Memory available to the VPS: the effective outer LXC limit | Root cgroup `memory.max`; `MemTotal` only if LXCFS provides `/proc/meminfo` | Visible RAM: 2304 MiB before the upgrade, 4352 MiB (4.25 GiB) after it [VPS]. The effective outer limit is not confirmed [UNKNOWN] |
| H | OS, Docker and other host overhead: systemd, journald, sshd, Fail2ban, cron and rclone, dockerd, containerd and the shims | The LXC's `anon + shmem + kernel + sock` minus the containers' at the same moment. Its peak during the 03:30 backup and the apt runs needs a day-long sampling, which is an optional follow-up | [UNKNOWN]; the backup and apt peaks [UNKNOWN] |
| P | The application: backend (with the Java agent from S7 and the health check's probe JVM), postgres (with the backup tools), frontend, cloudflared | Per-container `anon + shmem + kernel + sock` peaks | `docker stats` without the agent: an estimated 909–986 MiB, a sum of separately observed ranges, not a simultaneous measurement [ESTIMATE from VPS ranges]. `anon + shmem + kernel + sock` and the agent's overhead [UNKNOWN] |
| O | The observability stack | Per-container `anon + shmem + kernel + sock` peaks after S6 (idle) and S7 (ingest) | Phase maxima of 446–555 MiB `anon + shmem`, 469–579 MiB with `kernel` [LOCAL], still rising; VPS [UNKNOWN] |
| K | The file working set needed to run without thrashing: binaries, memory-mapped TSDB, chunks and blocks. It excludes `shmem`, which H, P and O count | Not directly. Mapped files show in the processes' `RssFile`; a growing `workingset_refault_file` or major-fault count shows that the working set does not fit | [UNKNOWN]. Indication only: Alloy and Grafana mapped about 179 and 175 MiB of files [LOCAL, 2026-11-02] |
| R | Safety reserve for spikes between samples, JVM growth with uptime, growth of series and ingest, and query bursts | A policy, not a measurement | Proposed: 20–25 % of T. A recommendation that requires confirmation |

If the visible 4352 MiB is the effective limit, which the guest's readings do not confirm, a 20–25 %
reserve is 870–1088 MiB.
That leaves 3264–3482 MiB for H + P + O + K [ESTIMATE].

### What must not be added together

- **`docker stats`** MEM USAGE (`memory.current − inactive_file`) already contains active file pages
  and kernel memory. Do not add it to `anon`.
- **`memory.current`** contains page cache, charged to whichever cgroup touched it first. A sum over
  containers is not the host total.
- **Process RSS** counts shared, mapped file pages that may be charged to another cgroup. Never add
  RSS to cgroup values, and never sum RSS across processes.
- **Work already inside a container**: JVM heap and non-heap are part of the backend's `anon`, and so
  is the health check's probe JVM. `pg_dump` is in the postgres container. rclone is part of H.
- **Aggregates and their parts**:
  - `kernel` already contains `kernel_stack`, `pagetables`, `percpu`, `vmalloc` and the slab. Locally
    it matched `kernel_stack + pagetables + slab_reclaimable + slab_unreclaimable` within 0.1 MiB
    [LOCAL].
  - `shmem` is part of `file`.
  - Add `anon`, `shmem` and `kernel` once each, never their parts as well, and leave `shmem` out of K.
- **Maxima from different samples** are not a simultaneous peak.
  - Locally, the app's ingest maximum of `anon + shmem` (605 MiB) plus the stack's (515 MiB) is
    1120 MiB, but the largest simultaneous sum was 1115 MiB.
  - With `kernel` included, the app's ingest maximum (619 MiB) plus the stack's (538 MiB) is
    1157 MiB, while the largest simultaneous total for all nine containers was 1151 MiB.
  - The 6 MiB difference (5.3 MiB before rounding) comes from maxima observed at different sampling
    times, not from an accounting error.
- **LOCAL and VPS values** come from different environments and, for `docker stats` against
  `anon`, measure different things. Do not combine them into one total.

### Reference levels

- **The whole LXC is the end-to-end reference.**
  - The outer limit applies to it, and the kernel makes its OOM decisions against it.
  - It counts host processes and shared page cache that no container shows.
  - Its peak `anon + shmem + kernel + sock`, plus the file working set, is the combined memory that
    must fit.
- **Per-container cgroups are for attribution.** They show which service uses what, and S4.4's
  limits apply to them.
- **Local figures are a reference, not a forecast.**
  - The JVM, the Go runtimes and nginx size their heaps, thread pools and workers from the CPUs and
    memory they see: 16 CPUs and 31 GiB locally, one CPU on the VPS.
  - The local VM had swap and a freshly booted page cache.
  - It ran 38 minutes on development data, without cloudflared.

### Peaks that can coincide

- **Reboot or daemon restart**: restart policies start every container at once, without the
  `depends_on` order ([Docker API access](OBSERVABILITY.md#docker-api-access)). The JVM start, the
  health check probes and the WAL replays of Prometheus, Loki and Tempo then overlap on one CPU.
- **Deploy**: the pre-deploy backup, the image pull and a new JVM.
- **The 03:30 backup** during a Prometheus or Loki compaction.
- **A Grafana session** during any of the above.

Record two values:
- **conservative**: the sum of the individual peaks;
- **observed**: the LXC's highest `anon + shmem + kernel + sock`.

The gap between them is what the reserve has to cover.

## Conclusions

- The VPS was upgraded [USER-REPORTED] and now shows 4.25 GiB of RAM [VPS]. Use this configuration
  as the target for the application plus the observability stack in their current scope.
- The visible 4.25 GiB is not yet verified as the effective LXC limit, and the combined workload is
  not yet shown to fit. The terms marked UNKNOWN decide that.
- S4.4 assigns per-container resource limits from this budget.
- Measurements after S6 and S7 validate the budget under real VPS ingestion and retention.
- The upgrade adds memory and disk space, not CPU. The CPU risk below remains, and so do the disk
  risks: nothing bounds the growth of logs and telemetry.

## Risks

| Area | Risk | Status |
|---|---|---|
| CPU | One CPU runs everything. Not tested: host contention (steal time is not observable inside the LXC), simultaneous startup with WAL replay, and a deploy (a 90 s start period with a probe JVM every 3 s, inside a 180 s wait) | No throttling in the short sample before the upgrade, and `nr_throttled` 0 after it [VPS]; the rest [UNKNOWN] |
| Memory: Tempo | Grew through the whole local window | [LOCAL]; not levelled off |
| Memory: Java agent | Its overhead on the VPS | [UNKNOWN] |
| Memory: JVM sizing | Without `-Xmx` or a container limit, the default maximum heap is 25 % of the memory the JVM detects: about 576 MiB at 2.25 GiB, about 1088 MiB if it sees 4.25 GiB. A backend started after the upgrade can therefore use more memory than before, and an S4.4 container limit becomes the JVM's sizing base | [ESTIMATE]; the GC chosen on one CPU [UNKNOWN] |
| Disk: container logs | `json-file` with no rotation, so logs grow without bound | Growth [UNKNOWN] |
| Disk: telemetry | Retention is by time only (Prometheus 15 days, Loki and Tempo 168 h); nothing caps size | Growth [UNKNOWN] until S7 |
| Disk: images | The deploy prunes only images built from this repository. The stack's images are never pruned, so each version bump leaves the old one | About 3.2 GB [LOCAL, 2026-11-02]; VPS [UNKNOWN] |
| Disk: backups | 14 days of local dumps | Dump size [UNKNOWN] |
| PIDs | Not a bottleneck today. Thread counts grow with the CPUs each process sees, and S6 adds the stack's | Before the upgrade [VPS]: typically 163–178, peak 208; root `pids.max=max`, containers `pids.max=287749`, `pids.events` `max 0`. After the upgrade [VPS]: root `pids.max=max`, `pids.current=159`, `pids.events` `max 0` |

## Post-upgrade verification

Run on the VPS. Every command only reads.

```bash
date -u; uname -r
free -m
grep -E '^(MemTotal|MemAvailable|SwapTotal):' /proc/meminfo; cat /proc/swaps
grep lxcfs /proc/mounts
nproc
for f in memory.max memory.high memory.current memory.peak memory.events memory.pressure \
         cpu.max cpuset.cpus.effective cpu.stat pids.max pids.current; do
  printf '%-22s ' "$f"; cat "/sys/fs/cgroup/$f" 2>&1 | tr '\n' ' '; echo
done
grep -E '^(anon|file|kernel|sock|shmem|inactive_file) ' /sys/fs/cgroup/memory.stat
docker info --format 'ncpu={{.NCPU}} memtotal={{.MemTotal}} memlimit={{.MemoryLimit}} swaplimit={{.SwapLimit}} pidslimit={{.PidsLimit}}'
docker inspect -f '{{.Name}} started={{.State.StartedAt}} restarts={{.RestartCount}} oomkilled={{.State.OOMKilled}}' $(docker ps -aq)
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}\t{{.PIDs}}'
df -hT /; docker system df
cat /etc/docker/daemon.json 2>/dev/null || echo 'no /etc/docker/daemon.json'
sudo sh -c 'du -sh /var/lib/docker/containers/*/*-json.log' 2>/dev/null | sort -h | tail
```

Reading the output:

- **What the guest sees**: `MemTotal`, `free` and `memtotal` from `docker info`. Use `MemTotal` as T
  only if the `grep lxcfs` line lists `/proc/meminfo`.
- **The limit**: `memory.max` as a number is T. `max` means that no finite limit is exposed at the
  visible cgroup root, as before the upgrade. It does not show where the effective limit is applied,
  so T stays unverified from this value alone.
- **Components**: the `memory.stat` line gives `anon`, `shmem`, `kernel` and `sock` for the whole
  visible LXC. Their sum is the end-to-end value of H + P + O at that moment (see
  [Memory components](#memory-components)).
- **Starting values**: record `memory.events` and `memory.pressure`. An `oom_kill` above 0 means the
  kernel has already killed a process.
- **CPU**: `nproc`, `cpu.max` and `cpuset.cpus.effective` should still show one CPU.
- **Restarts**: compare each container's `started=` with the time of the upgrade. A backend started
  before the upgrade still has the heap size it chose for 2.25 GiB.
- **Logs**: the `du` line gives the current size of each container's log.

Optional, and not read-only: each of these starts a short extra JVM in the backend container.

```bash
docker exec backend-nimuairy java -XshowSettings:system -version
docker exec backend-nimuairy java -XX:+PrintFlagsFinal -version | grep -E ' (MaxHeapSize|UseSerialGC|UseG1GC|ActiveProcessorCount) '
```

They show the CPU count, the memory limit, the heap and the GC that a JVM starting now would choose.

## Outstanding verification

| What | How | When |
|---|---|---|
| T: the effective LXC limit (the VPS shows 4.25 GiB) | Not settled by the readings so far: `memory.max=max` at the visible root | Before S4.4 |
| CPU count and quota after the upgrade | Read after the upgrade [VPS]: one CPU, no CFS quota at the visible root | Done |
| The `memory.stat` fields the VPS kernel provides (the filtered output had no `kernel`) | `cat /sys/fs/cgroup/memory.stat` | Before kernel memory is computed for H, P and O |
| Swap on the host side, behind the virtual `/proc/swaps` entry | Not visible from the guest | Open; this budget does not count on swap |
| The backend JVM's heap and GC on the VPS | The optional JVM check, or the backend's JVM metrics after S7 | Before S4.4, and again after S7 |
| H | The LXC's and every container's `anon + shmem + kernel + sock`, read at the same moment | Optional follow-up; not required before S4.4 |
| The backup and apt peaks | The same values sampled over 24 h, across the 03:30 backup and the apt windows | Optional follow-up; until then [UNKNOWN] |
| P: `anon + shmem + kernel + sock` and the agent's overhead | Per-container cgroup values before and after S7 | S7 |
| O idle, then O under ingest | Per-container cgroup values | S6, then S7 |
| K | Refaults and major faults in `memory.stat` under load | S6 and S7 |
| Disk growth: container logs, volumes, images, backups | `df`, `docker system df` and the log sizes, twice, 24 h apart | Optional follow-up; not blocking |
| Startup and deploy on one CPU | An authorized restart or deploy with the stack present | After S6 |

Related:
- the load of verifying backup restores ([B5](DEFERRED_WORK.md#b5--periodic-backup-restore-verification));
- Alloy's start order after a restart ([S3.3b](DEFERRED_WORK.md#s33b--alloy-starting-while-the-socket-proxy-is-down));
- the LXC kernel ([VPS_UNATTENDED_UPGRADES.md](VPS_UNATTENDED_UPGRADES.md#limitations)).
