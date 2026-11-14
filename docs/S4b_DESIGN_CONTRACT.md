# S4b Design Contract — Production hardening of the observability stack

**Status, 2026-11-14: decisions accepted, nothing implemented.**
- The operator accepted decisions B1 to B11 on 2026-11-14 (§13.1). No operator decision is open
  (§13.2).
- The unverified technical assumptions of §12.1 remain. The implementation steps resolve them.
- This document records the analysis, the design and those decisions.
- Each implementation step (§9) still starts only with the operator's approval.

Revisions:
- **1** (2026-11-14): the draft for review, with B1 to B10 open.
- **2** (2026-11-14):
  - B1 to B10 accepted;
  - the host port mappings recounted from the Compose renders (seven, not eight, §5.1);
  - the test overlay limited to the ports the tests use (§8.2);
  - `limits-check runtime` added after phase B (§8.3);
  - the development volume's migration without a backup (§7.4);
  - B7 deferred ([DEFERRED_WORK](DEFERRED_WORK.md#s4b--capability-drops-and-no-new-privileges-for-tempo-prometheus-loki-and-grafana)).
- **3** (2026-11-14):
  - B11 accepted: L1, the limits check's strict allowlist extended by the S4b keys (§8.6);
  - P-S4 checks the whole values of the Grafana keys that the allowlist admits (§8.4);
  - N9 tests the two checks' responsibilities (§8.7).
- **4** (2026-11-14), consistency corrections:
  - §13.2's heading now matches its content: no operator decision is open;
  - P-R1 to P-R4 have one execution phase in CI, phase B, from S4b.4 (§8.1, §8.3, §8.4). S4b.2
    checks the Grafana properties of P-R3 and P-R4 once, locally (§9);
  - S4b.2's acceptance tells N5, N9 (a) and N9 (b) apart (§9);
  - §9's order states which steps share which files;
  - smaller wording fixes in §2.3, §5.3 and P-R4.

## 1. Purpose and scope

S4b is the stage of the observability production rollout between S4.4 (resource limits) and S6
(the stack's bring-up on the VPS). It completes the production hardening that the S4 decision D1
set apart from S4 (§3.1):

1. **Ports**: on the VPS host, the production stack publishes only Grafana's `127.0.0.1:3000` (§5).
2. **Grafana authentication**: the production admin password comes from a secret outside the
   repository, with no fallback to `admin` (§6).
3. **Tempo as non-root** (§7).
4. **Production checks and their CI integration** (§8).

S4b changes only the repository: Compose files, scripts, CI and documentation. It runs nothing on
the VPS and deploys nothing. Its results reach the VPS with S6, which needs its own approval.

Evidence labels as in [S4.4_DESIGN_CONTRACT.md](S4.4_DESIGN_CONTRACT.md#1-purpose-and-scope)
(VPS, LOCAL, USER-REPORTED, ESTIMATE, UNKNOWN, CONFIG, S), plus:
- PLAN: the operator's planning notes for the rollout (2026-10-31 and 2026-11-02), which are kept
  outside the repository;
- CI: a GitHub Actions run of this repository.

Line numbers refer to `master` at `ebaa9fa`.

## 2. Context and current state

### 2.1 Completed stages

| Stage | Content | PR, merged |
|---|---|---|
| S1 | Alloy collects only containers labelled `observability.logs=true` | #97, 2026-10-31 |
| S2 | The `stack` network: the backend shares a network only with Tempo and Prometheus | #98, 2026-11-01 |
| S3.1–S3.3 | The Docker socket proxy, its boundary checks, the proxy outage check | #99, #100, #110, 2026-11-01 |
| S4.1 | Prometheus without the lifecycle API and the remote-write receiver | #111, 2026-11-02 |
| S4.2 | Alloy as `473:473` | #112, 2026-11-02 |
| S4.3 | The VPS resource budget | #114, 2026-11-11 |
| S4.4.2 | The stack's resource limits in `observability/compose.prod.yaml` | #115, 2026-11-12 |
| S4.4.3 | The app's resource limits in `compose.prod.yaml`, applied on the VPS by hand on 2026-11-12 and observed for about 35 h (S4.4.4) | #116, 2026-11-14 (`ebaa9fa`) |

- **S4.4 is complete.** GitHub shows PR #116 merged at 2026-11-14T11:19:31Z [CI].
  - The release freeze of S4.4's rollout ended with that merge (B10).
  - A separate documentation change closes S4.4 in its own contract before S4b.1 (B10): its §1
    Status, the §13 Rollout record and §15. That change is not part of S4b.
- The stack does not run in production yet. Its six containers' limits exist only in the overlay
  (S4.4 §1).

### 2.2 The four areas today

| Area | Today [CONFIG unless marked] | Gap for production |
|---|---|---|
| Ports | `observability/compose.yaml` has seven host port mappings, all `127.0.0.1`, TCP, with the host port equal to the container port: Prometheus 9090, Loki 3100, Tempo 3200, 4317 and 4318, Alloy 12345, Grafana 3000 (§5.1). The render of the base file plus the production overlay has the same seven [LOCAL, Compose v5.6.1] | The unauthenticated APIs of Prometheus, Loki, Tempo and Alloy get host endpoints that nothing on the VPS needs |
| Grafana | The base file sets `GF_SECURITY_ADMIN_USER: admin` and `GF_SECURITY_ADMIN_PASSWORD: admin`. The production render keeps both [LOCAL] | Production would start with the development credential |
| Tempo | `user: "0"` in the base file, inherited from the course stack. The image's own user is `10001:10001` [LOCAL] | Tempo runs as root on the network it shares with the internet-facing backend |
| Checks | The smoke test, the proxy outage check, and the limits check (`static` and `runtime`). CI's `observability` job runs the stack with both files | Nothing checks a port policy, the Grafana credential or Tempo's user. The production overlay cannot change the ports without breaking the tests (§2.3) |

### 2.3 Constraints in the current implementation

- **The test scripts use the host ports.**
  - `scripts/observability-smoke-test.sh` reaches every service through its loopback port:
    `127.0.0.1:9090`, `:3100`, `:3200`, `:4318`, `:12345` and `:3000` (lines 64–101, 140–148,
    173–175 and 663).
  - `scripts/observability-proxy-resilience-check.sh` uses `:3100` and `:12345` (lines 147, 215,
    216 and 321).
  - CI runs both scripts against `compose.yaml` + `compose.prod.yaml` (`ci.yml`, lines 160–165).
    A port reset in the production overlay alone would make both fail in CI.
- **The limits check forbids every other overlay change.** `observability-limits-check.sh static`
  fails when the overlay:
  - changes anything outside `services` (lines 119–121);
  - or changes any service key other than the four resource keys: `mem_limit`, `memswap_limit`,
    `pids_limit` and `oom_score_adj` (lines 135–138).

  Each S4b change to the overlay would fail it as it stands: the ports, Grafana's environment and
  secret, and a top-level `secrets:`.
- **The overlay's header comment says "Only resource keys and oom_score_adj belong here"**
  (`observability/compose.prod.yaml`, line 8).
  - S4.4 already expected S4b to add the rest
    ([S4.4 §2.3](S4.4_DESIGN_CONTRACT.md#23-earlier-decisions-this-contract-touches)).
  - The comment therefore changes with the first S4b step.
- **The smoke test logs in to Grafana with `GRAFANA_AUTH`**, which defaults to `admin:admin`
  (line 17).
- **The job takes about 2 min 50 s** of its 10-minute limit [CI, run 43589477382 on master,
  2026-11-14]:
  - `up`: 32 s;
  - the smoke test: 72 s;
  - the outage check: 59 s.

## 3. Previously accepted decisions

### 3.1 Decisions this contract builds on

| Decision | Source | Effect on S4b |
|---|---|---|
| **S4 D1** (2026-11-02): the production overlay, the Grafana secret, the production check, the production CI job and non-root Tempo form a separate stage, S4b, before S6 | [S4.4 §2.3](S4.4_DESIGN_CONTRACT.md#23-earlier-decisions-this-contract-touches); the description of PR #111 | Defines S4b's scope. §3.3 covers the one item it leaves unclear |
| Grafana is reached only through an SSH tunnel to `127.0.0.1:3000` (the approved rollout contract, 2026-10-31) | PLAN. The Grafana row of S4.4 §5.1 assumes it ("occasional use over an SSH tunnel") | Grafana keeps its loopback port, and no other host port is needed |
| Q4: the stack is distributed by hand with `git archive` to `/var/nimuairy-observability`; there is no observability deploy workflow | PLAN | Untracked `.env` and secret files survive the extraction. S4b adds no workflow |
| Q5: the operator runs every VPS command; S6 and S7 each need separate approval | PLAN | S4b runs nothing on the VPS |
| S2 D3: the `nimuairy-observability` network (key, name and settings) stays unchanged | `observability/compose.yaml`, lines 8–15; [OBSERVABILITY.md, Networks](OBSERVABILITY.md#networks) | The overlay must not touch networks |
| S2 D1 and D2: two limitations are accepted. The backend reaches every port of Tempo and Prometheus, and port 9464 is reachable from the app's other networks | [OBSERVABILITY.md, Networks](OBSERVABILITY.md#networks) | Unchanged. The port policy concerns host publishing, not these |
| S3 D1: the socket proxy is in the base file, it alone mounts the Docker socket, and its allowlist stays as it is | [OBSERVABILITY.md, Docker API access](OBSERVABILITY.md#docker-api-access) | Unchanged |
| S4.2: Alloy runs as `473:473`, set in the base file, with a documented one-time migration of a volume a root Alloy wrote | PR #112; [Alloy volumes written by root](OBSERVABILITY.md#alloy-volumes-written-by-root) | The pattern §7 follows for Tempo |
| S4.4 H1: production settings live in production-only overlays. Every VPS command that creates or recreates the stack's containers passes both files | [S4.4 §3](S4.4_DESIGN_CONTRACT.md#3-layout-h1) | Holds. The test overlay of §8.2 never joins the VPS command |
| S4.4: CI's `observability` job runs the stack with its production overlay | S4.4 §10.2; `ci.yml` | Holds (§8.3) |
| S4.4: the resource values; no CPU limits or weights | S4.4 §2 and §7 | S4b changes no resource key |
| S4 D2 (2026-11-02): S4's changes go into the base file. H1 superseded it for S4.4 only | S4.4 §2.3 | Not formally a decision for S4b. B4 applies its reasoning to Tempo |
| **B1 to B11** (2026-11-14): the S4b decisions | §13.1 | Accepted by the operator; the sections below follow them |

### 3.2 Requirements the existing architecture implies

- **Every signal path between containers runs over a Docker network, not over a host port:**
  - backend → `tempo:4318`, and Prometheus → `backend-nimuairy:9464`, over `nimuairy-observability`;
  - over `nimuairy-observability_stack`:
    - Grafana → Prometheus, Loki and Tempo (`datasources.yml`);
    - Alloy → `loki:3100` (`config.alloy`, line 66);
    - Prometheus → `alloy:12345` (`prometheus.yml`);
  - Alloy → `docker-socket-proxy:2375` over the internal `nimuairy-observability_docker-api`.
- **Development stays one command:** `docker compose -f observability/compose.yaml up -d --wait`.
  It keeps `admin`/`admin` and the loopback ports
  ([OBSERVABILITY.md, Run](OBSERVABILITY.md#run-1)).
- **What differs per host lives in untracked files**, today `observability/.env`
  (`DOCKER_SOCKET_GID`).
  - `.gitignore` covers `.env` and `.env.*` at any depth.
  - It does not cover `observability/secrets/` [CONFIG].
- **Non-root services must be able to read their bind-mounted configuration files as their own
  user.**
  - This already holds for Prometheus (`nobody`), Loki (10001), Grafana (472) and Alloy (473).
  - Tempo would join them.

### 3.3 Planned details that S4b inherits as proposals

The rollout plan of 2026-10-31 [PLAN] sketched S4b's content before S2 to S4.4 existed:
- `ports: !reset []` on every service except Grafana;
- a Compose file secret under `observability/secrets/`, read through
  `GF_SECURITY_ADMIN_PASSWORD__FILE`, with `GF_SECURITY_ADMIN_PASSWORD: !reset null`;
- `observability/secrets/` in `.gitignore`;
- `user: !reset null` for Tempo, which leaves the image's default user, in the production overlay;
- `scripts/observability-prod-check.sh`, for both CI and the VPS, and a separate
  `observability-prod` CI job;
- acceptance ideas:
  - only `127.0.0.1:3000` is published;
  - `admin:admin` gets `401`;
  - anonymous API requests get `401`;
  - sign-up is refused;
  - the password and the data survive `up -d --force-recreate`.

**These were proposals, not decisions.** This contract re-examined them, and §13.1 records what the
operator accepted. Since the plan was written:
- the proxy and Alloy's non-root user went into the base file (S3 D1, S4.2), so those parts of the
  old overlay sketch are done;
- the production overlay exists (S4.4.2), and CI's existing job already runs it, so B1 keeps that
  job instead of adding a separate production job;
- S4 D2 favoured the base file for hardening, and B4 follows it for Tempo.

**The one unclear item is decided.**
- The S4 plan's list of the items that D1 moved out of S4 also named `cap_drop` and
  `no-new-privileges` for the other services [PLAN].
- D1's own name for S4b does not include them, and neither does the S4.4 contract (§2.3, §14).
- B7 defers them. S4b does not add them
  ([DEFERRED_WORK](DEFERRED_WORK.md#s4b--capability-drops-and-no-new-privileges-for-tempo-prometheus-loki-and-grafana)).

## 4. Security goals and target architecture

### 4.1 Goals

- **SG1**: on the VPS host, only Grafana is published, on `127.0.0.1:3000`.
- **SG2**: production Grafana never runs with the development password. Its password is in no
  tracked file, image, `Config.Env` or log.
- **SG3**: Tempo runs as its image's non-root user and can write its storage.
- **SG4**: automated checks verify SG1 to SG3, with negative evidence, and the existing tests keep
  passing.
- **SG5**: S4b weakens none of these:
  - S2's network separation;
  - the proxy's boundary;
  - the resource limits;
  - the development setup.

### 4.2 Four kinds of reachability

| Term | Meaning here |
|---|---|
| Listens | A process in the container accepts connections on a port of the container's network namespace |
| Network-reachable | Another container on a shared Docker network can connect to it. On a Linux engine, containers on other networks cannot, not even to published ports ([OBSERVABILITY.md, Networks](OBSERVABILITY.md#networks)) |
| Host-published | Docker binds the port on a host address (`ports:`); here always `127.0.0.1` |
| Internet-exposed | Reachable from outside the VPS |

**A process on a Linux host can reach the address of every container on a bridge network**,
whether the port is published or not, and on internal networks too.
- OBSERVABILITY.md says so (Networks).
- The smoke test's host-namespace probe reaches the proxy on the internal `docker-api` network
  [CI, strict on Linux].

So **removing a host port does not stop the VPS's own processes or users from reaching a
service.** What goes away is its stable loopback endpoint.

### 4.3 Exposure matrix

| Service | Listens [CONFIG] | Network-reachable from | Published, development | Published, production render today | Production target | Internet |
|---|---|---|---|---|---|---|
| prometheus | 9090 | the backend's network, `stack` | `127.0.0.1:9090` | `127.0.0.1:9090` | none | no |
| loki | 3100, gRPC 9096 | `stack` | `127.0.0.1:3100` | `127.0.0.1:3100` | none | no |
| tempo | 3200, 4317, 4318, gRPC 9095 | the backend's network, `stack` | `127.0.0.1:3200`, `:4317`, `:4318` | the same | none | no |
| alloy | 12345 | `stack`, `docker-api` | `127.0.0.1:12345` | `127.0.0.1:12345` | none | no |
| docker-socket-proxy | 2375 | `docker-api`, and the host (`403` for every client but Alloy) | none | none | none | no |
| grafana | 3000 | `stack` | `127.0.0.1:3000` | `127.0.0.1:3000` | `127.0.0.1:3000` | no; reached only through SSH |

"Internet: no" rests on three facts:
- every binding is loopback-only;
- there is no other inbound path: cloudflared connects outward only, and UFW allows only SSH in
  [CONFIG, VPS_FIREWALL.md];
- UFW does not filter ports that Docker publishes, so the binding address alone keeps a published
  port local
  ([VPS_FIREWALL.md](VPS_FIREWALL.md#why-8000-8080-and-5432-are-not-open)).

Whether the VPS has a public IPv6 address with listeners on it is [UNKNOWN] until S6.

### 4.4 What the port policy protects, and what it does not

**It does:**
- leave Grafana, which authenticates, as the only host entry point, as the access contract says
  (§3.1);
- remove the loopback endpoints of the four unauthenticated HTTP APIs: those of Loki, Tempo
  (queries and OTLP intake), Prometheus and Alloy (its UI);
- rule out one kind of mistake. With no binding, a later edit cannot widen one to `0.0.0.0` or
  `::`, which UFW would not filter.

**It does not:**
- **stop processes and users on the VPS host from reaching those APIs by container address**
  (§4.2). This covers root, `deploy`, cron jobs, and an SSH session that forwards ports.
  - On the VPS, the protection of these APIs therefore rests on an assumption: the host has no
    untrusted users or services (U8, to be confirmed at S6).
  - `deploy` is in the `docker` group, so it is root-equivalent anyway.
- change which containers reach what. That is S2's network separation, and it stays unchanged.
- authenticate anything.

### 4.5 Target

```
VPS host
  127.0.0.1:3000 ──► grafana ──(stack)──► prometheus, loki, tempo
  (no other published port)
                     alloy ──(stack)──► loki            prometheus ──(stack)──► alloy:12345
                     alloy ──(docker-api, internal)──► docker-socket-proxy ──► docker.sock
  from S7: backend ──(nimuairy-observability)──► tempo:4318
           prometheus ──(nimuairy-observability)──► backend-nimuairy:9464
laptop: ssh -L <local port>:127.0.0.1:3000 ──► grafana (admin + the production password)
```

Tempo runs as `10001:10001`. Grafana reads its password from `/run/secrets/grafana_admin_password`.

## 5. Production port policy

### 5.1 Policy

| Service | Production host binding | Reason |
|---|---|---|
| grafana | `127.0.0.1:3000:3000`, kept from the base file | The SSH tunnel's endpoint (§3.1). A tunnel could also reach a container address, but that address changes whenever the container is recreated; the loopback binding stays the same. Grafana authenticates (§6) |
| prometheus | none; `127.0.0.1:9090` removed | Grafana queries it over `stack`. It scrapes the backend and Alloy over the Docker networks |
| loki | none; `127.0.0.1:3100` removed | Alloy pushes to it and Grafana queries it over `stack` |
| tempo | none; `127.0.0.1:3200`, `:4317` and `:4318` removed | The backend sends OTLP over `nimuairy-observability`. Grafana queries it over `stack` |
| alloy | none; `127.0.0.1:12345` removed | Prometheus scrapes it over `stack`. Its UI is a debugging aid, so the VPS needs another way to reach it (S5/S6) |
| docker-socket-proxy | none, as today | |

**The mappings**, as `host IP:host port->container port/protocol`. Each set is exact: a check
compares the set, not a count (§8.4).

| Service | Development: `compose.yaml` | Production: + `compose.prod.yaml` | Test runs: + `compose.test.yaml` | Used by |
|---|---|---|---|---|
| grafana | `127.0.0.1:3000->3000/tcp` | `127.0.0.1:3000->3000/tcp` | `127.0.0.1:3000->3000/tcp` (from the base file) | the SSH tunnel; the smoke test and the production check |
| prometheus | `127.0.0.1:9090->9090/tcp` | — | `127.0.0.1:9090->9090/tcp` | the smoke test |
| loki | `127.0.0.1:3100->3100/tcp` | — | `127.0.0.1:3100->3100/tcp` | the smoke test, the outage check |
| tempo | `127.0.0.1:3200->3200/tcp` | — | `127.0.0.1:3200->3200/tcp` | the smoke test |
| tempo | `127.0.0.1:4317->4317/tcp` | — | — | no script; development only (OTLP gRPC) |
| tempo | `127.0.0.1:4318->4318/tcp` | — | `127.0.0.1:4318->4318/tcp` | the smoke test's OTLP probe |
| alloy | `127.0.0.1:12345->12345/tcp` | — | `127.0.0.1:12345->12345/tcp` | the smoke test, the outage check |
| docker-socket-proxy | — | — | — | |
| **Mappings** | **7** | **1** | **6** | |

Sources of the table:
- **Development and production today**: the renders of `compose.yaml`, and of `compose.yaml` +
  `compose.prod.yaml`, at `ebaa9fa`. Each has the same seven entries [LOCAL, Compose v5.6.1]:
  - `host_ip` `127.0.0.1`, protocol `tcp`, `mode` `ingress`;
  - the host port equal to the container port;
  - no range, no ephemeral host port, and no `network_mode`.
- **The production target**: one mapping, from a render with the candidate overlay of §5.2 [LOCAL].
- **The test runs**:
  - The CI scripts use the host ports 9090, 3100, 3200, 4318, 12345 and 3000 (`grep` of
    `scripts/observability-smoke-test.sh` and `scripts/observability-proxy-resilience-check.sh`).
  - No script or workflow uses 4317.
  - `scripts/observability-exemplar-check.sh` also uses 3000, 3200 and 9090. It is a manual check
    that runs against the development stack, which keeps them.
- **Revision 1 said "eight ports"**: that was a miscount of these seven mappings.

Development keeps every mapping (§5.3). On the VPS, diagnostics go through Grafana's Explore, or
through a container on the stack's networks, for example
`docker exec prometheus wget -qO- http://loki:3100/ready`. How the runbook does it is S5's and S6's
matter.

### 5.2 Mechanism

Compose merges `ports` across files. An overlay can add a port, but listing fewer ports removes
none. The production overlay therefore resets the list:

```yaml
services:
  prometheus:
    ports: !reset []
  loki:
    ports: !reset []
  tempo:
    ports: !reset []
  alloy:
    ports: !reset []
```

Evidence:
- [LOCAL, Compose v5.6.1] The render of `compose.yaml` + `compose.prod.yaml` + this candidate
  (a scratch file) lists one port, `grafana 127.0.0.1:3000->3000/tcp`. Every other key, the
  networks included, is unchanged.
- [LOCAL] A later file can publish ports again after the reset (the test overlay, §8.2).
- [S] Compose v5.6.0, the VPS's version, pins `compose-spec/compose-go` v2.16.1. Its
  `loader/reset.go` handles `!reset` and `!override`. This was not run on the VPS; S6 renders the
  files there before its first `up` (U7).

Alternatives:

| Alternative | For | Against |
|---|---|---|
| `ports: !override []` | Gives the same result for an empty list | None; `!reset` states the intent, which is to remove |
| Move the ports out of the base file into a development overlay | Production would need no reset | Every development command needs another file, and the documented `-f observability/compose.yaml` commands break. Development would no longer be easy to run |
| Keep the loopback ports | No change | Contradicts the access contract. The four unauthenticated endpoints stay, and so does the risk of widening a binding (§4.4) |

**Design**: `!reset []` in `observability/compose.prod.yaml`, as planned on 2026-10-31 [PLAN].

### 5.3 Development and CI

- The base file's port mappings do not change. S4b.3 changes only Tempo's `user` there (§7).
  - Development keeps its seven loopback mappings.
  - The smoke test keeps its Docker Desktop `WARN`s.
- CI's tests need the ports (§2.3). §8.2 covers that.

### 5.4 Consequences

- **A VPS `up` without the overlay publishes the seven loopback mappings again**, besides starting
  the containers without their limits (S4.4 H1). The production check's `runtime` mode detects this
  (§8.4).
- **Nothing on the VPS host uses these ports** [CONFIG]:
  - the app's production files and the deploy workflow do not;
  - the app's observability overlay, from S7, uses the Docker network only.

### 5.5 Tests

P-S1 to P-S3 and P-S6 (static), P-R1 and P-R2 (runtime, phase B), the limits check's allowlist
for `ports` (§8.6), and the negative experiments N1, N2, N8 and N9 (a) (§8.4, §8.7).

## 6. Grafana authentication and secret handling

### 6.1 Facts

- **The base file** [CONFIG] sets:
  - `GF_SECURITY_ADMIN_USER: admin` and `GF_SECURITY_ADMIN_PASSWORD: admin`;
  - `GF_AUTH_ANONYMOUS_ENABLED: "false"` and `GF_USERS_ALLOW_SIGN_UP: "false"`.
- **The password applies only when `grafana.db` is created** [S, Grafana v13.0.2,
  `conf/defaults.ini`, lines 385–392].
  - Grafana creates the admin user at its first start. The file's comment on the password: "can
    be changed before first start of grafana".
  - So a password setting matters only with a new `grafana-data` volume. With an existing
    database it changes nothing.
- **The image's `/run.sh`** [S, read from the running 13.0.2 container] handles each non-empty
  `GF_*__FILE` variable:
  - it exports the file's content under the variable's name without the suffix, unsets the
    `__FILE` variable, and then `exec`s Grafana;
  - if the plain variable is set and non-empty too, it exits with "Both … are set (but are
    exclusive)";
  - it logs only the file's path.
- **Grafana ignores an environment override with an empty value** [S, Grafana v13.0.2,
  `pkg/setting/setting.go`, lines 844–851].
  - So when the password file is empty, or `run.sh` cannot read it, `admin_password = admin`
    stays in force, and **Grafana starts silently with the development password**.
  - The unreadable case follows from bash semantics: inside `export`, the failed `$(< file)` still
    lets `export` succeed [inference, not run].
- **A file secret becomes a read-only bind mount** [S, Compose v5.6.0,
  `pkg/compose/create.go`, lines 1257–1297].
  - The mount has `CreateHostPath: false`, so Compose uses the Mount API.
  - When the file does not exist, Compose only warns: `secret file … does not exist`.
  - The engine should then refuse to create a container whose bind source does not exist. That is
    [UNVERIFIED]: neither read nor run (U1).
- **`docker compose config -q` succeeds while the secret file is missing** [LOCAL, Compose v5.6.1].
  A render check cannot enforce the secret.
- **A Compose secret with an `environment:` source** [S, Compose v5.6.0,
  `pkg/compose/secrets.go`, lines 52–55 and 110–115]:
  - fails `up` when the variable is unset ("environment variable … is not set");
  - but when the variable is set and empty, Compose injects nothing.
- **A file secret keeps the host file's owner and mode** [S, `create.go`]. A service's `uid`,
  `gid` and `mode` for a secret apply only to injected content (`createTar` in `secrets.go`). So
  Grafana (472) must be able to read the host file.

### 6.2 Options

| | **G-A**: file secret + `__FILE` (accepted, B2) | **G-B**: Compose secret from an environment variable + `__FILE` | **G-C**: `GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:?…}` |
|---|---|---|---|
| Secret missing | `up` fails at Grafana's create, after a warning [the engine part is UNVERIFIED] | `up` fails: the variable is not set [S] | `config` and `up` fail [CONFIG: `:?`, as in the app's `compose.prod.yaml`] |
| Secret empty | Grafana starts with `admin` [S], unless the guard of §6.3 stops it | Grafana starts with `admin` [S, inference] | `config` fails: `:?` rejects an empty value |
| Value in `Config.Env`, so in `docker inspect` and readable by Alloy through the proxy | No; only the path | No | **Yes** |
| Value in `docker compose config` output | No; only the path | No | **Yes** |
| Stored on the host in | `observability/secrets/grafana_admin_password` | `observability/.env` | `observability/.env` |
| Planned before | Yes, in the plan of 2026-10-31 [PLAN] | No | No |
| Fits [DEFERRED_WORK, S3](DEFERRED_WORK.md#s3--application-secrets-out-of-container-environment-variables) (secrets out of the environment) | Yes; it is that entry's proposed mechanism | Partly | No: it adds one more secret to the accepted risk |

- G-C fails most clearly. But it exposes the password to anything that can inspect containers, and
  through the proxy a compromised Alloy can
  ([OBSERVABILITY.md, What the proxy does not protect](OBSERVABILITY.md#docker-api-access)).
- **Decision (B2, B3)**: G-A, together with the start guard of §6.3. G-B and G-C were not chosen.

### 6.3 The empty-file trap and a start guard

**The trap.** With G-A alone, a missing file fails clearly. But Grafana starts with `admin` when the
file is empty, unreadable, or holds `admin`. On a new volume, that password then goes into
`grafana.db`.

**The start guard (accepted, B3).** Detecting the problem after Grafana has started is not enough.
The production overlay wraps the image's entrypoint, and Grafana refuses to start when the file:
- does not exist;
- cannot be read by Grafana's user;
- is empty;
- or holds `admin`.

A file missing on the host should already stop `up` before the container is created (§6.1, U1).
The guard covers the same case inside the container too.

```yaml
grafana:
  entrypoint:
    - /bin/bash
    - -c
    - |
      f=/run/secrets/grafana_admin_password
      if [ ! -r "$$f" ] || [ ! -s "$$f" ]; then echo "FATAL: $$f is missing, unreadable or empty" >&2; exit 1; fi
      if [ "$$(< "$$f")" = admin ]; then echo "FATAL: $$f holds the development password" >&2; exit 1; fi
      exec /run.sh "$$@"
    - run.sh
```

- What it rests on:
  - the image's entrypoint is `/run.sh`, the image has no `Cmd`, and `run.sh` is a bash script
    [LOCAL];
  - `$$` escapes Compose's interpolation;
  - the candidate renders [LOCAL, Compose v5.6.1].
- Still [UNVERIFIED] (U2, U3; tested by N3 and N4 on real containers in S4b.2):
  - what the container actually receives;
  - that each of the four cases stops Grafana before `run.sh` runs;
  - how `up --wait` reports a container that exits and is restarted under `unless-stopped`.
- **A render is no evidence that the guard works.** `docker compose config` only shows that Compose
  accepts the text. Only N3 and N4 show the behaviour.
- The cost: the overlay depends on the image's `/run.sh` and `/bin/bash`. If an image update moves
  them, Grafana does not start, and CI's smoke test catches that.

**Not chosen: detection only.** Without a guard, the production check would find `admin:admin`
accepted only after the start. By then a new database would have stored `admin`. The S6 runbook
still checks the file before the first `up` (§6.5), in addition to the guard.

### 6.4 Candidate overlay (G-A)

```yaml
services:
  grafana:
    environment:
      GF_SECURITY_ADMIN_PASSWORD: !reset null
      GF_SECURITY_ADMIN_PASSWORD__FILE: /run/secrets/grafana_admin_password
    secrets: [grafana_admin_password]

secrets:
  grafana_admin_password:
    file: ./secrets/grafana_admin_password
```

- **The render** [LOCAL, Compose v5.6.1]:
  - has no `GF_SECURITY_ADMIN_PASSWORD`;
  - has the `__FILE` variable;
  - mounts the secret at `/run/secrets/grafana_admin_password`.
- **The relative path resolves against the project directory**, which gives
  `observability/secrets/grafana_admin_password`.
- **The base render has no secret**, so development needs no file.
- **S4b.2 adds `observability/secrets/` to `.gitignore`.**
- **The admin user name stays `admin`** (§14).

### 6.5 Supplying the secret

| Where | How |
|---|---|
| Development | Nothing to do. The base file keeps `admin`/`admin` |
| CI | A step before `up` generates a new random password for every run. It writes the password to `observability/secrets/grafana_admin_password` (mode 0644), masks it with `::add-mask::`, and exports `GRAFANA_AUTH=admin:<password>` for the scripts. No repository secret is needed: the value is disposable, and the stack lives only as long as the job |
| VPS (S6, not S4b) | The operator writes the file from a password manager over SSH stdin, so the password never enters a shell history. The file is `/var/nimuairy-observability/observability/secrets/grafana_admin_password`, in a 0700 directory, and must be readable by 472 inside the container. Before the first `up`, check that the file is not empty and that no `nimuairy-observability_grafana-data` volume exists. P0 left that volume check unconfirmed [PLAN] |

- **The file's mode on the VPS is S6's decision.** Two options:
  - 0644 in a 0700 directory owned by `deploy`: no root needed, and the directory protects the
    file on the host;
  - 0400, owned by 472: needs root.

  Members of the `docker` group can read the file either way.
- **Rotation, for the S5/S6 runbook.** Changing the file does not change an existing database.
  - Run `grafana cli admin reset-admin-password --password-from-stdin` in the container. The flag
    exists in v13.0.2 and reads one line [S, `reset_password_command.go`, lines 29–39].
  - Keep the file in step with it, so that a new volume gets the same password.

### 6.6 Where the value can appear (G-A)

| Surface | Value visible? |
|---|---|
| Tracked files and images | No |
| `Config.Env` in `docker inspect`, also readable by Alloy through the proxy | No; only the path |
| `docker compose config` | No; only the path |
| `docker exec grafana env` | No. A process started with `exec` gets `Config.Env` [inference from Docker's `exec` and `run.sh`] |
| Grafana PID 1's environment (`/proc/1/environ`) | **Yes**: `run.sh` exports the value. UID 472 can read it in the container, and root on the host. No check may print it. The smoke test's check of Alloy's `HOME` reads `/proc/1/environ`; Grafana must never be checked that way |
| The logs of Grafana and `run.sh` | No [S]. `run.sh` logs the path. Grafana redacts override values, and at `GF_LOG_LEVEL: warn` it does not log them at all |
| CI logs | Masked, and the value is disposable |
| Process lists | `curl -u admin:<password>` puts the value in `argv`. The production check passes credentials on stdin (`curl -K -`). The smoke test's `-u "$GRAFANA_AUTH"` stays for CI and local runs only |

### 6.7 Limitations of G-A

- **A secret file is not a secret manager.**
  - The password is stored unencrypted on the host's disk.
  - Its protection is the file's owner and mode and its directory's. Root and every member of the
    `docker` group can read it.
- **Grafana's user (UID 472) must be able to read the file.** Compose bind-mounts it with the host's
  owner and mode (§6.1), so the mode chosen at S6 must allow that (§6.5). The guard stops a file
  472 cannot read.
- **The password is in Grafana's process environment.** It never reaches Docker's `Config.Env`, but
  `run.sh` exports it to Grafana's PID 1 (§6.6).
- **Changing the file does not change an existing database.** The password applies only when
  `grafana.db` is created (§6.1). Rotating it needs `reset-admin-password` (§6.5).

### 6.8 Tests

P-S4 and P-S5 (static), P-R3 and P-R4 (runtime, phase B, from S4b.4), P-V1 (phase B, after the
recreate), the limits check's allowlist for Grafana's keys (§8.6), and the negative experiments N3
to N5, N8 and N9.

## 7. Tempo non-root execution and storage

### 7.1 Facts [LOCAL unless marked]

- **The image** `grafana/tempo:3.1.0`
  (`sha256:3076b8dcdfb32fd6bc5ccef85e7b7313e6199b9cb84366257fc17ecb696db5fd`):
  - `Config.User` is `10001:10001`, the entrypoint is `/tempo`, and the image declares no `VOLUME`;
  - `/etc/passwd` has `tempo:x:10001:10001`;
  - `/var/tempo` is an empty directory, `10001:10001` with mode 0755; `/tmp` is 1777.
- **Nothing in the configuration needs root** [CONFIG]. The course stack's `user: "0"` overrides the
  image's user, but:
  - Tempo's ports (3200, 4317, 4318, 9095) are unprivileged;
  - its configuration is a read-only bind mount;
  - it writes only under `/var/tempo`.
- **The development Tempo wrote nothing outside its volume.** It runs as root and had been up for
  3 days; `docker diff tempo` shows only the bind-mount point `/etc/tempo`.
- **What it writes, all under `/var/tempo`:**
  - `wal/` and `blocks/`, both configured in `tempo.yaml`;
  - `live-store/`, 256 `shard_NNN.json` files and `batches.pb`, at the volume's root. These are
    Tempo 3 defaults; which components write them was not read in the source [UNKNOWN].
- **The development volume** `nimuairy-observability_tempo-data` (created 2026-10-25, 77 MB):
  - its root is `10001:10001`, mode 0755, so Docker seeded it from the image;
  - everything Tempo wrote in it belongs to `0:0`: 456 directories with mode 0700, and 2106 files
    with mode 0600 or 0644;
  - as 10001, Tempo could not even enter those directories.
- **How Docker seeds volumes** [S]. Docker seeds a new, empty named volume from the image's
  directory, ownership included. It never changes a volume that already has content.
  - Source: moby, read for S4.2 at `docker-v29.9.2`.
  - Observed: for Alloy in S4.2, and for this volume's root above.

### 7.2 Target and decisions

Tempo runs as `10001:10001`, the image's own user. That is what upstream ships as the default. Alloy
is different: upstream calls running its image as non-root experimental.

| Choice | Decision (accepted 2026-11-14) | Why | Not chosen |
|---|---|---|---|
| Where the user is set (B4) | **In the base file**, `observability/compose.yaml`, for development, CI and production alike | It follows D2's reasoning and S4.2's precedent. Development, CI and production run Tempo with the same identity, and CI's fresh volumes test it on every run | The production overlay only. It would leave a root Tempo in development, split the two configurations, and make the limits check's overlay rule allow `user` |
| How it is set (B5) | **Explicitly**, `user: "10001:10001"` | It pins the identity that the volume's ownership depends on. When an image update changes its user, the storage check fails in CI on that update. Otherwise CI's fresh volume would be seeded for the new user, CI would pass, and the VPS's existing volume would break | No `user` key, so the image's default applies |

**Consequence**: every development volume that a root Tempo wrote needs the one-time migration of
§7.4 before the first `up` with the new configuration. The development volume on the operator's
machine is one of them (§7.1).

### 7.3 Volumes

| Volume | Owner today | Needed | Expected |
|---|---|---|---|
| CI, new on every run | — | Seeded as `10001:10001` from the image | Works without a migration [S]. S4b.3's CI run confirms it first (U4) |
| VPS (S6) | None is expected: the stack has never run there. P0 left existing `nimuairy-observability` volumes unconfirmed [PLAN] | S6 lists the volumes before its first `up`. A `tempo-data` volume written by root would be unexpected and would need a migration. S6 decides how: B6, the migration without a backup, covers development volumes only | No migration |
| Development, created before the change | Root directory `10001:10001`, content `0:0` [LOCAL, on this machine] | A one-time migration (§7.4) before the first `up` with the new configuration | Required |

What Tempo 3.1 does as 10001 on a volume written by root is [UNVERIFIED] (U5). It could fail at
start, or later, when it flushes or compacts blocks. N7 observes it on a scratch volume.

### 7.4 Migrating a development volume (outline for OBSERVABILITY.md, S4b.3)

**Decision (B6): a one-time `chown`, without a backup of the volume.**
- **Why no backup**: the volume holds only local development traces with a 7-day retention, and
  `chown` changes owners, not content.
- **The decision covers only this one-time migration of development volumes.** It does not change
  the rollout's decision to take no regular backups of telemetry data in production (§14), and it is
  no precedent for production data.

**What is migrated:**
- **The volume**: `nimuairy-observability_tempo-data`, the one Compose creates for the project
  `nimuairy-observability`.
- **The scope**: the whole volume, mounted at `/var/tempo`: its root and every entry under it.
  - On the operator's machine that is 456 directories and 2106 files owned by `0:0` (§7.1).
  - Their content stays the same.
- **The target owner**: `10001:10001` for every entry.

**Before the first migration of a real development volume, S4b.3 must have:**
- rehearsed this procedure on a scratch volume that holds root-owned 0700 directories, and checked
  the result;
- run N7 on such a volume;
- completed the one-time run in which Tempo, as 10001, flushes and compacts a block (§7.5).

**The steps**, built like
[Alloy volumes written by root](OBSERVABILITY.md#alloy-volumes-written-by-root), without its backup
steps:
1. **Check whether the migration is needed.**
   - A read-only helper container, without a network, lists the entries not owned by
     `10001:10001`.
   - It runs only if `docker volume inspect` finds the volume, because `docker run -v` would create
     it.
   - If it lists nothing, stop here.
2. **Stop Tempo**, so that it writes nothing during the change:
   `docker compose -f observability/compose.yaml stop -t 30 tempo`.
   - `docker inspect -f '{{.State.Running}}' tempo` must print `false`.
3. **Change the owners**: `chown -R 10001:10001` on the volume, from a throwaway root container
   without a network.
   - The Tempo image has no shell and no `chown`. The Alloy and Prometheus images have both.
   - An interrupted run can simply be repeated.
4. **Check again**: the listing of step 1 prints nothing.
5. **Start the stack**: `docker compose -f observability/compose.yaml up -d --wait`, which recreates
   Tempo as 10001. Then run the smoke test, including T-1 to T-5.

Rules:
- **The migration is a manual operation.** Nothing migrates automatically, and S4b adds no step that
  changes ownership when Compose starts the stack.
- **The operator runs it on their own development volume, with separate consent.** S4b.3 documents
  the procedure and rehearses it on a scratch volume only.
- **Order**: if the stack was started with the new configuration before the migration, Tempo may
  fail or write a mixture of owners (U5). Stop it, migrate as above, and start it again. `chown -R`
  covers both kinds of file.

### 7.5 Tests

In the smoke test, for development and CI, built like Alloy's checks:
- **T-1**: Tempo is configured as `10001:10001` (`docker inspect`).
- **T-2**: Tempo's PID 1 runs as `10001:10001`.
  - The image has no shell for `docker exec`.
  - So a probe reads `/proc/1/status` from Tempo's PID namespace (`--pid container:tempo`, as
    `nobody`, without a network), as the limits check does.
- **T-3**: Tempo wrote its storage during the run: files under `/var/tempo` changed after Tempo
  accepted the probe trace. S4b.3 decides which path is the earliest reliable sign, the live store
  or the WAL [UNKNOWN].
- **T-4**: every entry under `/var/tempo` belongs to `10001:10001`.
  - A read-only probe of the volume checks it, as 10001 with no capabilities.
  - So a directory the probe cannot enter fails the check.
- **T-5**: Tempo has logged no `permission denied` since its start.

Once, in S4b.3: a local run on a scratch project until Tempo has flushed at least one block and
completed one compaction job, all as 10001 (U6).
- CI's few minutes see neither.
- S4.4 saw both, but as root
  ([S4.4 §10.3(a)](S4.4_DESIGN_CONTRACT.md#103-local-evidence-docker-desktop)).

### 7.6 Further hardening (B7: deferred)

- `cap_drop: [ALL]` and `no-new-privileges` for Tempo, Prometheus, Loki and Grafana were proposed in
  October [PLAN], but D1's wording does not name them (§3.3).
- **B7 defers them; S4b does not implement them.**
  - Whether each service runs with them is not established.
  - The evaluation is recorded in
    [DEFERRED_WORK](DEFERRED_WORK.md#s4b--capability-drops-and-no-new-privileges-for-tempo-prometheus-loki-and-grafana).

## 8. Production validation and CI

### 8.1 Responsibilities

| Check | Kind | Runs in | Covers |
|---|---|---|---|
| `observability-limits-check.sh static` | static (renders) | CI, local | The resource keys, as today. Its strict allowlist, which says which overlay keys may change but not to what, gains the S4b keys (B11, §8.6) |
| `observability-prod-check.sh static` (new) | static (renders) | CI, local | The exact sets of port mappings of the production, base and test renders (§5.1); Grafana's production environment and secret; a base render that needs no secret (P-S1 to P-S6) |
| `observability-smoke-test.sh` | runtime | CI (phase A), local | As today, plus Tempo's user and storage (T-1 to T-5) |
| `observability-proxy-resilience-check.sh` | runtime | CI (phase A), local | Unchanged |
| `observability-limits-check.sh runtime` | runtime | CI, twice: after phase A's tests and after phase B's recreate; local | The script is unchanged. The second run checks the containers recreated from exactly the production files |
| `observability-prod-check.sh runtime` (new, S4b.4) | runtime, on the exact production files | CI phase B only, after the recreate: never in phase A, where the test overlay publishes five more mappings. The VPS in S6 (B8), each run there with separate consent | Host port bindings and connections; Grafana's `Config.Env` and authentication (P-R1 to P-R4) |
| `observability-prod-check.sh seed` and `verify` (new) | runtime, across the recreate | CI only: `seed` in phase A, `verify` in phase B | That the seeded trace, Tempo's storage and Grafana's password survive the recreate (P-V1) |
| Negative experiments N1 to N9 | negative | local, once, during implementation, with consent | That each check fails when its property is broken |

### 8.2 The test overlay

`observability/compose.test.yaml` (the name accepted in B9) sits on top of the production overlay.
It publishes again only the five loopback mappings that the test scripts use (§5.1). It does not
publish 4317, which no test uses.

```yaml
# For test runs only (CI and local): publishes again the loopback ports the test scripts use.
# Never part of a VPS command.
services:
  prometheus:
    ports: ["127.0.0.1:9090:9090"]
  loki:
    ports: ["127.0.0.1:3100:3100"]
  tempo:
    ports: ["127.0.0.1:3200:3200", "127.0.0.1:4318:4318"]
  alloy:
    ports: ["127.0.0.1:12345:12345"]
```

- **The render of the three files has six mappings**: Grafana's from the base file and these five
  [LOCAL, Compose v5.6.1, with this candidate as a scratch file].
  - The production check's `static` mode compares that set with the expected one (P-S3).
  - A mapping that a test script starts using must therefore be added to this file and to the check
    in the same change.
- **The file reaches the VPS too**, with `git archive … observability` (Q4, §3.1).
  - Its header says it is for tests only.
  - The VPS command passes exactly two files (S4.4 H1).

### 8.3 Job flow (B1: option A2, accepted)

The existing `observability` job runs both phases. S4b adds no second job.

**Phase A**, the job as today, with the test overlay added:
1. Set the Docker socket GID, and generate the disposable Grafana password (§6.5).
2. Validate the renders:
   - the base file;
   - the base file + the production overlay;
   - the base file + the production overlay + the test overlay;
   - the app's development files.
3. Run `limits-check static` and `prod-check static`.
4. Run `up -d --wait` with the three files.
5. Run the smoke test (with `GRAFANA_AUTH`), the outage check and `limits-check runtime`.
   - `limits-check runtime` renders its default files, `compose.yaml` + `compose.prod.yaml`, while
     these containers came from three files.
   - The test overlay changes only `ports`, which the limits check does not read, so the comparison
     holds.
6. Run `prod-check seed`: an OTLP trace with a known ID.

**Phase B**, the exact production files, `observability/compose.yaml` +
`observability/compose.prod.yaml`, without `compose.test.yaml`:

7. Run `up -d --wait --force-recreate` with these two files. Every container is recreated, the
   volumes stay, and the test ports are gone.
8. Run `prod-check runtime` (P-R1 to P-R4):
   - the port bindings and the host connections;
   - Grafana's `Config.Env` and authentication.

   This is the only step in CI that runs P-R1 to P-R4. No phase-A step runs them: a test overlay
   is up there.
9. Run `limits-check runtime` again, on the containers recreated in step 7:
   - their `HostConfig`, cgroup limits and `oom_score_adj`;
   - no OOM event;
   - no restart.

   The run of step 5 checked other containers.
10. Run `prod-check verify` (P-V1):
    - the trace seeded in step 6 can still be read, through Grafana's Tempo datasource or with
      `docker exec prometheus wget`;
    - Tempo's storage still belongs to `10001:10001`;
    - the datasources answer `OK` with the CI password.

**Then, as today**: no probe container is left, the proxy is running and healthy, and the job
prints the logs on failure.

Phase B adds about 1 to 1.5 min to the job's 2 min 50 s [ESTIMATE]. The 10-minute limit stays.

The options considered for B1:

| Option | For | Against |
|---|---|---|
| **A2** (accepted): the test overlay for the existing tests, then phase B with the exact files | The existing test scripts keep their logic. The exact production configuration starts in CI. The recreate checks that Tempo's data, written as 10001, and Grafana's password persist; S6's later updates rely on both | One more file and one more `up`. The existing tests run with ports that production does not have (host bindings only; container traffic is the same) |
| A1 (not chosen): the test overlay, with the ports checked only in the renders | The simplest CI | The exact production files never start in CI. There is no persistence check, and the runtime port check waits until S6 |
| B (not chosen): the scripts reach the services from inside the Docker networks (through a client container on `stack`), in one phase with the exact files | No test overlay, and every test runs on the exact configuration | Rewrites the transport of about 15 call sites in two long, reviewed scripts, and changes how development runs them |
| C (not chosen): a separate `observability-prod` job, as in the plan of 2026-10-31 | Runs in parallel, on fresh volumes | Duplicates the job's setup. Still needs A1, A2 or B for the existing tests. No recreate on the same volumes |

### 8.4 The production check

Four modes:

| Mode | Where | Needs |
|---|---|---|
| `static` | CI, local | `jq`, as the limits check does |
| `runtime` | CI phase B only, after the recreate (§8.3, step 8); the VPS in S6 (B8) | `bash`, `docker` and `curl` only. No `jq`: the VPS is not assumed to have it |
| `seed`, `verify` | CI only | as `runtime` |

**How the port checks compare.**
- They compare sets, never a count.
- Each mapping is the tuple `(service, host IP, host port, container port, protocol)`, and each
  check pins its expected set, which §5.1 lists.
- So each of these fails the check:
  - an additional mapping, a missing one, or one on another service;
  - a host IP other than `127.0.0.1`, which includes an empty one (all interfaces), `0.0.0.0` and
    `::`;
  - a port range, an ephemeral host port, or another protocol.
- Compose's `mode` is not compared: it matters only in Swarm.
- A change to a pinned set changes the Compose file and the check in the same commit, as for the
  app's memory limits in S4.4.3.

**`static`** runs these checks:
- **P-S1**: the production render (base + production) has exactly the set
  `{grafana 127.0.0.1:3000->3000/tcp}`.
  - So Grafana is the only host-published endpoint, on loopback only.
  - Prometheus, Loki, Tempo, Alloy and the proxy have no mapping.
- **P-S2**: the base render has exactly the seven development mappings of §5.1.
- **P-S3**: the render of base + production + test has exactly the six mappings of §5.1:
  Grafana's and the five test mappings.
- **P-S4**: Grafana in the production render, with the whole values of the keys that the limits
  check's allowlist admits for it (B11, §8.6):
  - its `environment` equals the base render's, with exactly two differences:
    `GF_SECURITY_ADMIN_PASSWORD` removed, and
    `GF_SECURITY_ADMIN_PASSWORD__FILE=/run/secrets/grafana_admin_password` added;
  - so `GF_AUTH_ANONYMOUS_ENABLED` and `GF_USERS_ALLOW_SIGN_UP` stay `"false"`, and no other
    variable changes;
  - its `secrets` mount exactly the one secret, `grafana_admin_password`, at
    `/run/secrets/grafana_admin_password`;
  - the top-level `secrets` hold exactly that one, with the file
    `<project directory>/secrets/grafana_admin_password`;
  - its `entrypoint` is the start guard of §6.3 (B3).
- **P-S5**: the base render has no top-level secret, its Grafana has no `__FILE` variable, and it
  has no guard. So development needs no secret file.
- **P-S6**: no service in the three renders uses `network_mode: host`, which would bypass port
  publishing.

**Credentials**: `runtime`, `seed` and `verify` read the Grafana password from the secret file or
from `GRAFANA_AUTH`. They pass it to `curl` on stdin (`-K -`) and never print it.

**`runtime`** runs these checks.
- **Where**: always on a stack started from exactly `compose.yaml` + `compose.prod.yaml`:
  - in CI, in phase B after the recreate (§8.3, step 8);
  - in S6, on the VPS.
- **Never in phase A.** The test overlay's five mappings there would fail P-R1 and P-R2 by design.
- So P-R1 to P-R4 have one execution phase in CI: phase B.

The checks:
- **P-R1**: the set of `HostConfig.PortBindings` over the stack's containers, and the output of
  `docker port`, are exactly P-S1's set. No container's `NetworkMode` is `host`.
- **P-R2**: from the host:
  - a connection is refused to each production-removed mapping of §5.1: `127.0.0.1` on 9090, 3100,
    3200, 4317, 4318 and 12345;
  - `127.0.0.1:3000/api/health` returns `200`, the positive control;
  - a listener check with `ss` is printed as `info` only, because what it shows depends on
    Docker's userland proxy.
- **P-R3**: Grafana's `Config.Env` holds no `GF_SECURITY_ADMIN_PASSWORD=`, and does hold the
  `__FILE` variable.
- **P-R4**: Grafana's authentication:
  - `admin:admin` gets `401` on an authenticated endpoint;
  - the configured password gets `200`;
  - an anonymous `GET /api/datasources` gets `401`;
  - sign-up is refused. S4b.2's one-time local check records the exact status and message, and
    S4b.4 pins them in this check.

**`seed`** (phase A) sends an OTLP trace with a known ID and records the ID for `verify`.

**`verify`** (phase B) runs one check:
- **P-V1**, after the recreate:
  - the datasources answer `OK` with the configured password, so Grafana's database kept it;
  - the seeded trace is found (U13);
  - Tempo's storage belongs to `10001:10001`.

Its probe containers behave as in the existing scripts: labelled per run, removed on exit, and
without a network unless they need one.

### 8.5 CI details

- **Path filter**: add `scripts/observability-prod-check.sh`.
  - `observability/*` already covers the test overlay and the overlay's changes.
  - `.gitignore` needs no entry.
- **"No probe containers left"** also filters on the production check's probe names.
- **"Stack status and logs"** stays as it is. Grafana's logs contain no password (§6.6).
- **The disposable password** is masked by GitHub and never becomes a repository secret.

### 8.6 The limits check

**Decision (B11, accepted 2026-11-14): L1.**
- Today's limits check fails on any overlay change besides the four resource keys: `mem_limit`,
  `memswap_limit`, `pids_limit` and `oom_score_adj` (§2.3).
- S4b.1 is the first step that changes the overlay in another way.

**The strict allowlist stays.** `observability-limits-check.sh static` keeps its responsibility for
which keys the production overlay may change. Each key the allowlist gains is admitted only where
listed here.

| Step | Key the allowlist gains | Only on |
|---|---|---|
| S4b.1 | `ports` | `prometheus`, `loki`, `tempo`, `alloy` |
| S4b.2 | `environment` | `grafana` |
| S4b.2 | `secrets` | `grafana` |
| S4b.2 | `entrypoint` (the start guard of §6.3) | `grafana` |
| S4b.2 | the top-level `secrets` | the Compose file's top level |

- **Each step adds its own keys**, in the same change as the overlay keys they admit: S4b.1 adds
  `ports`, and S4b.2 adds the others.
- **Everything else stays forbidden.**
  - An S4b key on another service, such as `ports` on `grafana` or `docker-socket-proxy`, or
    `environment` on `tempo`, fails the check.
  - So does any other key on any service, or any other top-level key, as today.
- **The allowlist admits a key, not a value.** That a key may change says nothing about what it may
  change to.

**The values are the production check's responsibility.** `observability-prod-check.sh static`
verifies the exact values and the required properties of these keys in the production render:
- `ports`: P-S1, the exact set of mappings;
- Grafana's `environment`, `secrets` and `entrypoint`, and the top-level `secrets`: P-S4.

Neither check alone accepts an overlay. It needs both: one admits the keys, and the other pins their
values. N9 shows each failing on its own responsibility (§8.7).

How the script expresses the allowlist is left to S4b.1. This contract fixes only the behaviour
above.

**Rejected: L2.** L2 would have moved the whole "nothing else changes" rule into the production
check. It was not chosen, because it would rewrite a check that S4.4 accepted and made stricter
([S4.4 §12.1](S4.4_DESIGN_CONTRACT.md#121-deviations-recorded-during-implementation)).

### 8.7 Negative experiments

Each runs once, during implementation, only with the operator's consent. Each is reported with its
goal, commands, result and conclusion, and how the setup was restored.

| # | Mutation | Expected |
|---|---|---|
| N1 | An extra published port in a scratch overlay, such as Prometheus on `127.0.0.1:9090` | `prod-check static` fails |
| N2 | Grafana's binding widened to `3000:3000`, on all interfaces | `prod-check static` fails |
| N3 | The secret file is missing | `up` fails before Grafana runs. The message is recorded, and nothing was created at the file's path (U1) |
| N4 | The secret file is empty; or unreadable for 472; or holds `admin` | Grafana exits with the guard's message before `run.sh` runs, and `up --wait` fails. The way `up --wait` reports each case under `unless-stopped` is recorded (U2, U3) |
| N5 | `GF_SECURITY_ADMIN_PASSWORD` left in the production render | `prod-check static` fails. At runtime, `run.sh` would exit [S] |
| N6 | Tempo with `user: "0"` | The smoke test fails (T-1, T-2) |
| N7 | Tempo as 10001 on a scratch volume that holds root-owned 0700 directories | The smoke test fails (T-4, and readiness or T-5). This also records Tempo's actual behaviour (U5) |
| N8 | Phase B started without the production overlay, or with the test overlay | `prod-check runtime` fails. Without the overlay, `limits-check runtime` fails too |
| N9 | (a) In a scratch overlay, an S4b key where the allowlist does not admit it, such as `ports` on `docker-socket-proxy` or `environment` on `tempo`. (b) A further variable in Grafana's `environment` | (a) `limits-check static` fails (B11). (b) `limits-check static` passes, because the key is admitted, and `prod-check static` fails on P-S4. Each check fails on its own responsibility (§8.6) |

### 8.8 Local runs

- **A local run of the production files must not reuse the development stack.** Both have the same
  project name, container names, ports and volumes.
  - The development `grafana-data` volume already stores `admin`.
  - So the secret would change nothing there, and the check that `admin:admin` gets `401` would
    fail.
- **Local runtime tests therefore use an isolated project**, as S4.4 did
  ([§10.3](S4.4_DESIGN_CONTRACT.md#103-local-evidence-docker-desktop)):
  - a project name of their own;
  - `container_name: !reset`;
  - no host port that clashes with the development stack, which holds `127.0.0.1:3000`;
  - never the development volumes.

## 9. Implementation stages

Rules for every step:
- **Its own branch and PR.**
- **Each step ends with a stop and a report**: the changes, the test results, any deviations from
  this contract, and any problems.
- **No commit, push, PR or merge without separate consent.** Each step updates the documentation
  its change makes stale.
- **Order**:
  - **The S4.4 close-out comes first** (B10). It is a separate documentation change in
    `docs/S4.4_DESIGN_CONTRACT.md`, ready before S4b.1 starts.
  - S4b.1 to S4b.3 do not depend on each other functionally. S4b.4 needs all three.
  - **S4b.1 and S4b.2 change the same files**:
    - `observability/compose.prod.yaml`;
    - `scripts/observability-limits-check.sh`, where each adds its keys to the allowlist (B11,
      §8.6);
    - `scripts/observability-prod-check.sh`, which S4b.1 creates for `static` or, if S4b.2 comes
      first, S4b.2 creates;
    - `.github/workflows/ci.yml`;
    - `docs/OBSERVABILITY.md`, in different sections in S4b.1 and S4b.2.

    So one of them is reviewed and merged before the other starts, in either order.
  - **S4b.3 touches neither check script.** It changes `observability/compose.yaml` and
    `scripts/observability-smoke-test.sh`. It shares only `docs/OBSERVABILITY.md` with the other
    two, in other sections.
    - It depends on neither of them.
    - It still goes through review as its own PR, one at a time, like every step of the rollout.
  - S4b.4 is the only other step that changes `observability-prod-check.sh` (`runtime`, `seed`,
    `verify`) and `ci.yml` (phase B).

### S4b.1 — Production port policy

- **Goal**: SG1, in the repository.
- **Scope**:
  - the port resets;
  - the test overlay with its five mappings (§8.2);
  - `prod-check static` with P-S1 to P-S3 and P-S6, comparing the exact sets of §5.1;
  - the limits check's allowlist: `ports` on `prometheus`, `loki`, `tempo` and `alloy` (B11,
    §8.6);
  - CI's phase A with three files.
- **Files**:
  - `observability/compose.prod.yaml` (the resets and the header comment);
  - `observability/compose.test.yaml` (new);
  - `scripts/observability-prod-check.sh` (new, `static`);
  - `scripts/observability-limits-check.sh`;
  - `.github/workflows/ci.yml`;
  - `docs/OBSERVABILITY.md` (Files, Resource limits, Where the overlay applies, the CI paragraph).
- **Depends on**: B1, B9 and B11 (accepted); the S4.4 close-out (B10).
- **Acceptance**:
  - `limits-check static` admits `ports` only on those four services. Any other overlay change
    still fails it, `ports` on `grafana` or `docker-socket-proxy` included;
  - the production render has exactly the set `{grafana 127.0.0.1:3000->3000/tcp}`;
  - the base render has exactly the seven development mappings, unchanged;
  - the test render has exactly the six test-run mappings (§5.1);
  - CI is green with the smoke test, the outage check and the limits check on three files;
  - N1, N2 and N9 (a), with `ports` on `docker-socket-proxy`, fail as expected. N8 needs
    `prod-check runtime`, so it belongs to S4b.4.
- **Tests**: the static checks, plus a one-time local runtime check of the bindings in an isolated
  project (§8.8).
- **Out of scope**: Grafana, Tempo, phase B.

### S4b.2 — Grafana production secret

- **Goal**: SG2.
- **Scope**:
  - G-A and the start guard (B2, B3);
  - `.gitignore`;
  - CI's disposable password and `GRAFANA_AUTH`: phase A's smoke test logs in with that password;
  - P-S4 and P-S5, in `prod-check static`;
  - a one-time local check of Grafana's runtime properties, in an isolated project (§8.8): those of
    P-R3 and P-R4;
  - the limits check's allowlist: `environment`, `secrets` and `entrypoint` on `grafana`, and the
    top-level `secrets` (B11, §8.6).
  - Not in this step: `prod-check runtime`. Its P-R3 and P-R4 run in CI only in phase B, which
    S4b.4 adds (§8.3). They are never run in phase A.
- **Files**:
  - `observability/compose.prod.yaml`;
  - `.gitignore`;
  - `scripts/observability-prod-check.sh` (it creates the script if S4b.1 has not);
  - `scripts/observability-limits-check.sh`;
  - `.github/workflows/ci.yml`;
  - `docs/OBSERVABILITY.md`.
- **Depends on**: B2, B3 and B11 (accepted).
- **Acceptance**:
  - **Static (CI)**:
    - `limits-check static` admits these keys only on `grafana` and at the top level. Any other
      overlay change still fails it;
    - `prod-check static`: P-S4 holds. The production render has no `GF_SECURITY_ADMIN_PASSWORD`,
      and has the `__FILE` variable, exactly the one secret and the guard;
    - P-S5 holds: the base render has neither a secret nor the guard.
  - **Phase A (CI)**: the smoke test passes with `GRAFANA_AUTH` set to the disposable password. So
    Grafana accepts that password, and its datasources answer `OK`.
  - **Once, locally, in an isolated project (§8.8)**, reported in the PR:
    - Grafana's `Config.Env` holds no password;
    - `admin:admin` gets `401`, and the configured password `200`;
    - an anonymous `GET /api/datasources` gets `401`;
    - sign-up is refused.

    These are the properties P-R3 and P-R4 check. Their permanent CI form comes with S4b.4, in
    phase B.
  - **N3 and N4, on real containers**: Grafana does not start when the file is missing,
    unreadable, empty or `admin`. The way `up --wait` reports each case is recorded (U1 to U3).
  - **N5**: with `GF_SECURITY_ADMIN_PASSWORD` left in the production render, `prod-check static`
    fails.
  - **N9 (a)**: with an S4b key where the allowlist does not admit it, such as `environment` on
    `tempo`, `limits-check static` fails. S4b.1 tests the variant with `ports` on
    `docker-socket-proxy`.
  - **N9 (b)**: a further variable in `grafana.environment` is a different mutation. The key-level
    allowlist admits it, so `limits-check static` passes. `prod-check static` then fails, because
    P-S4 checks Grafana's whole expected `environment`.
  - After a local run, `git status` shows no secret file.
- **Out of scope**: creating the secret on the VPS, the rotation runbook (S5, S6), the admin user's
  name.

### S4b.3 — Tempo non-root

- **Goal**: SG3.
- **Scope**:
  - `user: "10001:10001"` in the base file (B4, B5);
  - smoke-test checks T-1 to T-5;
  - the manual migration procedure of §7.4: `chown` without a backup (B6), rehearsed on a scratch
    volume;
  - the one-time run until Tempo flushes and compacts a block;
  - N6 and N7.
- **Files**:
  - `observability/compose.yaml`;
  - `scripts/observability-smoke-test.sh`;
  - `docs/OBSERVABILITY.md`: the change-table row, a new `#### Tempo volumes written by root`, the
    Verify bullets, an Update bullet.
- **Depends on**: B4, B5 and B6 (accepted).
- **Acceptance**:
  - CI's smoke test is green with T-1 to T-5 on a fresh volume (U4);
  - an isolated local run sees a block flushed and compacted as 10001, with every file owned by
    10001 (U6);
  - N6 and N7 fail as expected;
  - the migration procedure ran once on a scratch volume, not the development one, and its result
    was checked: every entry `10001:10001`, the content unchanged, and Tempo writing as 10001
    afterwards.
- **Out of scope**:
  - migrating the operator's own development volume, which is manual and needs separate consent;
  - any automatic migration;
  - Tempo's configuration and limits;
  - `cap_drop` and `no-new-privileges` (B7: deferred).

### S4b.4 — Production runtime check and CI phase B

- **Goal**: SG4, on the exact production files.
- **Scope**:
  - `prod-check runtime`, `seed` and `verify`; `runtime` needs only `bash`, `docker` and `curl`
    (B8);
  - CI's phase B: the recreate, `prod-check runtime`, a second `limits-check runtime`, and
    `prod-check verify` (§8.3);
  - the probe filter of "No probe containers left";
  - CI's first run of P-R1 to P-R4: `prod-check runtime` in phase B. That includes the Grafana
    properties S4b.2 checked once locally.
- **Files**: `scripts/observability-prod-check.sh`, `.github/workflows/ci.yml`,
  `docs/OBSERVABILITY.md`.
- **Depends on**: S4b.1 to S4b.3; B1 (A2) and B8 (accepted).
- **Acceptance**:
  - phase B is green:
    - P-R1: the bindings are exactly P-S1's set;
    - P-R2: connections to the removed mappings are refused, and the positive control on 3000
      passes;
    - P-R3 and P-R4: Grafana's `Config.Env` and authentication, after the recreate;
    - `limits-check runtime` passes on the recreated containers;
    - P-V1: the seeded trace can be read (U13), Tempo's storage belongs to 10001, and the password
      still works;
  - N8 fails as expected;
  - the job stays within 10 min.
- **Out of scope**: running the check on the VPS. That belongs to S6 (B8) and needs separate
  consent there.

### S4b.5 — Verification and close-out

- **Goal**: record the results, and leave the documents consistent.
- **Scope**:
  - this contract's status and its acceptance checklist (§10);
  - the OBSERVABILITY.md bullet "The stack is for local development only…", including its
    `admin`/`admin`;
  - the list of what S6 must do (§12.3).
- **Files**: `docs/S4b_DESIGN_CONTRACT.md`, `docs/OBSERVABILITY.md`. B7's DEFERRED_WORK entry is not
  part of this step: it came with this contract's revision 2.
- **Out of scope**:
  - the production runbook (S5);
  - VPS_FIREWALL.md and README.md, which change with S6.

## 10. Testing and acceptance criteria

- [ ] P-S1 to P-S3, comparing exact sets (§5.1):
  - the production render has exactly `{grafana 127.0.0.1:3000->3000/tcp}`;
  - the base render has exactly the seven development mappings;
  - the test render has exactly the six test-run mappings.
- [ ] P-S6: no render uses `network_mode: host`.
- [ ] `limits-check static`, B11: its allowlist admits exactly the keys of §8.6, each only where
      listed. Any other overlay change still fails it.
- [ ] P-S4 and P-S5:
  - Grafana's `environment` in the production render equals the base render's, with exactly two
    differences: `GF_SECURITY_ADMIN_PASSWORD` removed, and
    `GF_SECURITY_ADMIN_PASSWORD__FILE=/run/secrets/grafana_admin_password` added;
  - so anonymous access and sign-up stay off;
  - its `secrets` and the top-level `secrets` hold exactly the one secret, and its `entrypoint` is
    the start guard;
  - the base render has neither a secret nor the guard.
- [ ] N3 and N4 on real containers: Grafana does not start when its password file is missing,
      unreadable, empty or `admin`. A render alone does not count.
- [ ] T-1 to T-5: Tempo is configured as, and runs as, `10001:10001`. Its storage belongs entirely
      to `10001:10001`, was written during the run, and shows no permission error.
- [ ] A one-time run sees a block flushed and compacted as 10001.
- [ ] The migration of §7.4 rehearsed on a scratch volume, and its result checked.
- [ ] Phase B, after the recreate on exactly `compose.yaml` + `compose.prod.yaml`, passes:
  - P-R1 to P-R4:
    - the bindings, exactly P-S1's set, and the connections;
    - Grafana's `Config.Env`;
    - `admin:admin` gets `401`, and the CI password gets `200`;
    - anonymous requests get `401`, and sign-up is refused;
  - `limits-check runtime` on the recreated containers;
  - P-V1:
    - the datasources answer `OK`;
    - the seeded trace survives the recreate;
    - Tempo's storage still belongs to 10001.
- [ ] The existing checks still pass in phase A, with the same substance:
  - the smoke test: the exemplar link, the network and Docker API boundaries, log continuity,
    Alloy;
  - the outage check;
  - `limits-check static` and `runtime`.
- [ ] N1 to N9 each failed as expected, reported once.
- [ ] Unchanged: the resource keys, the networks, the proxy's command and allowlist, and the app's
      files.
- [ ] No secret file is tracked, and `.gitignore` covers `observability/secrets/`.
- [ ] Each step updated the documents its change made stale.

## 11. Migration and rollback

| Change | Development | CI | VPS |
|---|---|---|---|
| Ports | Nothing to do | The test overlay | Nothing is deployed. The first use is at S6 |
| Grafana secret | Nothing to do: the base file keeps `admin` | A disposable password on every run | S6 creates the file before the first `up`, with no `grafana-data` volume present |
| Tempo's user | A one-time, manual `chown` of an existing volume, without a backup (§7.4, B6), with the operator's consent | Fresh volumes | S6 expects no `tempo-data` volume and checks first |

**Rollback:**
- **Ports**: revert the overlay's lines. No data is involved.
- **Secret**: revert the overlay. Grafana keeps the password stored in its database, because the
  base file's `admin` applies only to a new database [S].
- **Tempo**: revert the base file's line.
  - A root Tempo reads and writes files owned by 10001: root has Docker's default capabilities
    [inference, as for Alloy in S4.2].
  - The files it then writes belong to root again, so a later return to 10001 needs the migration
    again.
  - **The development migration has no backup to restore (B6).**
    - `chown` changes only owners, and an interrupted run can be repeated.
    - A volume damaged in some other way would be recreated empty, and its local traces lost.
- **No S4b change modifies a volume on its own.** Only the documented development migration does,
  run by hand.

## 12. Risks and limitations

### 12.1 Unverified assumptions

| # | Assumption | Resolved by |
|---|---|---|
| U1 | The engine refuses a bind source that does not exist for a file secret (Mount API) | N3, S4b.2 |
| U2 | The guard's text reaches the container as written (the `$$` escapes), and `up --wait` fails clearly when Grafana exits under `unless-stopped` | N4, S4b.2 |
| U3 | An unreadable secret file leaves the password empty (bash's `export` semantics) | N4 |
| U4 | A new volume is seeded as `10001:10001` for Tempo | S4b.3's CI run |
| U5 | How Tempo behaves as 10001 on a volume root wrote | N7 |
| U6 | Tempo 3.1 flushes and compacts blocks as 10001 | S4b.3's one-time run |
| U7 | Compose 5.6.0 on the VPS applies `!reset` as 5.6.1 does locally | S6 renders before `up` |
| U8 | The VPS host has no untrusted users or services (§4.4) | The operator, at S6 |
| U9 | The LXC container maps UIDs 10001, 472 and 473 in a way that works. PR #112 left Alloy's 473 to S6 | S6 |
| U10 | The extraction on the VPS leaves the configuration files readable by every user (umask), as the non-root services need | S6 |
| U11 | Grafana 13's Tempo datasource proxy serves `/api/v2/traces/<id>` | S4b.4; otherwise `docker exec prometheus wget` |
| U12 | Whether the VPS has a public IPv6 address | S6 |
| U13 | Tempo 3.1 still serves a trace accepted shortly before a recreate (WAL replay) | S4b.4 |

### 12.2 Risks

- **The port reset is no access boundary against the VPS's own processes** (§4.4).
- **Phase A tests a configuration that has ports production lacks.** Phase B covers the difference
  (A2).
- **The guard ties the overlay to Grafana's `run.sh`** (§6.3).
- **The test overlay could be used on the VPS by mistake.** The loopback ports would be back, and
  `prod-check runtime` would fail.
- **A Tempo update that changes its UID fails CI.** That is intended; existing volumes then need
  the migration.
- **Grafana's password sits in its PID 1's environment.** A diagnostic that prints
  `/proc/1/environ` would show it.
- **Verifying the production files locally needs an isolated project** (§8.8).
- **The development migration takes no backup** (B6). A mistake in it costs the local traces at
  worst. That is why it is rehearsed on a scratch volume first (§7.4).
- **The expected port sets are pinned in the production check.** A change to a mapping in a Compose
  file fails the check until the check changes with it (§8.4). That is intended, but it is one more
  file to change.
- **CI takes about a third longer** [ESTIMATE].

### 12.3 Dependencies for S6 and S7

None of the items below has been done. S4b runs nothing on the VPS. Each operation S6 performs
there needs the operator's separate consent within S6.

S6 needs these, besides its own design:
- **the secret file**, created and checked before the first `up` (§6.5): non-empty, readable by 472,
  in a 0700 directory. The guard also stops a wrong file (§6.3);
- **a list of the existing `nimuairy-observability_*` volumes**, and of any listener on `:3000`:
  - an existing `grafana-data` volume would ignore the secret;
  - an existing `tempo-data` volume written by root would need a migration that S6 designs (§7.3);
- **a render on the VPS's Compose 5.6.0, before the first `up`**, that shows exactly P-S1's set
  (U7);
- **`observability-prod-check.sh runtime` on the VPS**, accepted as part of S6's procedure (B8):
  - it uses only `bash`, `docker` and `curl`; `jq` is not assumed (S4.4 found it not guaranteed);
  - running it there still needs the operator's consent within S6;
  - S6 also checks the stack's limits read-only, like
    [S4.4 §10.4](S4.4_DESIGN_CONTRACT.md#104-vps-the-operator-runs-these-read-only);
- **answers to U8 to U10 and U12**:
  - no untrusted users or services on the host;
  - the LXC mapping of UIDs 10001, 472 and 473;
  - the configuration files' modes after the extraction;
  - public IPv6;
- updates to the documents S6 makes stale:
  - VPS_FIREWALL.md says the production Compose files publish no host ports. From S6, Grafana is
    published on loopback;
  - README.md says the stack is not used in production.

S7: the port policy does not affect it, because the backend uses the Docker networks.

S3.3b stays deferred, and S4b does not affect it. DEFERRED_WORK asks to reconsider it before Alloy
collects logs on the VPS.

## 13. Decisions

### 13.1 Accepted by the operator (2026-11-14)

| # | Question | Decision | Where |
|---|---|---|---|
| B1 | How CI runs the tests once production publishes no test ports | **A2**, in the existing `observability` job, with no second job. Phase A: the base file + the production overlay + `compose.test.yaml`, for the tests that need host ports, and the seed of a known trace. Phase B: a recreate on exactly `compose.yaml` + `compose.prod.yaml`, then `prod-check runtime`, `limits-check runtime` again on the recreated containers, and `prod-check verify` | §8.3 |
| B2 | The mechanism for the Grafana secret | **G-A**: a file outside the repository, read through `GF_SECURITY_ADMIN_PASSWORD__FILE`. The production overlay removes the inherited `admin` with `!reset null`. `.gitignore` excludes `observability/secrets/`, and CI generates a disposable password per run. Its limitations are in §6.7 | §6.2, §6.4, §6.5, §6.7 |
| B3 | A password file that is missing, unreadable, empty or `admin` | **The start guard**: Grafana does not start. Detection after the start is not enough. Its behaviour in a real container, and how `up --wait` reports it, are still to be verified (U1 to U3) | §6.3 |
| B4 | Where Tempo's user is set | **The base file**, `observability/compose.yaml`: development, CI and production run the same identity | §7.2 |
| B5 | How Tempo's user is set | **Explicitly**: `user: "10001:10001"`, so CI detects a change of the image's UID | §7.2 |
| B6 | Migrating an existing development volume | **A one-time, manual `chown`, without a backup**. It covers development volumes only. It does not change the decision to take no regular backups of telemetry data in production | §7.4 |
| B7 | `cap_drop: [ALL]` and `no-new-privileges` for Tempo, Prometheus, Loki and Grafana | **Deferred**. Not implemented in S4b | §7.6; [DEFERRED_WORK](DEFERRED_WORK.md#s4b--capability-drops-and-no-new-privileges-for-tempo-prometheus-loki-and-grafana) |
| B8 | `prod-check runtime` on the VPS | **Part of S6's procedure**. It needs only `bash`, `docker` and `curl`, with no `jq`. Running it needs separate consent within S6. This is not consent to run anything on the VPS now | §8.4, §12.3 |
| B9 | The test overlay's name | **`observability/compose.test.yaml`** | §8.2 |
| B10 | Closing S4.4 | **A separate documentation change in `docs/S4.4_DESIGN_CONTRACT.md`, ready before S4b.1.** The release freeze ended with the merge of PR #116 on 2026-11-14 | §2.1, §9 |
| B11 | How the limits check treats the S4b keys of the production overlay | **L1**: `observability-limits-check.sh static` keeps its strict allowlist, which says which keys may change. The allowlist gains only these: `ports` on `prometheus`, `loki`, `tempo` and `alloy` (S4b.1); `environment`, `secrets` and `entrypoint` on `grafana`, and the top-level `secrets` (S4b.2). It admits these keys nowhere else, and admits no other key. `observability-prod-check.sh static` verifies these keys' exact values and the required properties (P-S1, P-S4). L2, moving the rule into the production check, was rejected | §8.6 |

### 13.2 No open operator decisions

B1 to B11 are all accepted (§13.1).

§12.1 lists the unverified technical assumptions U1 to U13. They are a separate kind:
- they are not operator decisions;
- they have not been verified;
- the tests of the implementation steps verify them.

None of them needs an operator decision before S4b.1.

## 14. Out of scope

- Resource limits, CPU limits and weights, `GOMEMLIMIT`.
- The networks, the socket proxy and its allowlist, Alloy's configuration.
- Any configuration of Tempo, Loki, Prometheus or Grafana beyond the user, the ports and the
  password.
- Grafana's admin user name, other users, SSO, TLS, `GF_SERVER_ROOT_URL`.
- Read-only root filesystems.
- `cap_drop` and `no-new-privileges` beyond Alloy's and the proxy's existing ones (B7: deferred).
- These [deferred](DEFERRED_WORK.md) items:
  - [the app's secrets in environment variables](DEFERRED_WORK.md#s3--application-secrets-out-of-container-environment-variables);
  - [S3.3b](DEFERRED_WORK.md#s33b--alloy-starting-while-the-socket-proxy-is-down);
  - [CPU weights](DEFERRED_WORK.md#s44--cpu-weights);
  - [capability drops for the other services](DEFERRED_WORK.md#s4b--capability-drops-and-no-new-privileges-for-tempo-prometheus-loki-and-grafana);
  - B5, the backup restore verification.
- Regular backups of telemetry data: the rollout decided against them. B6's migration without a
  backup concerns a development volume only.
- Any VPS operation and any deployment within S4b, including the production check's run on the VPS.
  That belongs to S6 (B8), with separate consent.
- A deploy workflow for the stack.
- Implementing S5, S6 or S7: the production documentation, the S6 runbook, the app's wiring.
- Changes to the app's configuration, its Compose files or its deploy workflow.
- Automatic migration of volumes.

## Appendix A. Evidence collected for this contract (2026-11-14)

All of it was read-only or render-only. The development stack was not changed.

Added in revision 2:
- **Port renders.** `ports` objects of the renders: `compose.yaml`; + `compose.prod.yaml`; + the
  candidate overlay; + the test overlay of §8.2 as a scratch file.
  - They show 7, 7, 1 and 6 mappings.
  - Each is `127.0.0.1`, `tcp`, `mode` `ingress`, with the host port equal to the container port.
- **Ports used by the scripts.** `grep` of the host ports in `scripts/observability-*.sh` and
  `.github/`. Nothing uses 4317.
- **The merged tree.** `git diff e3125d5 ebaa9fa` is empty: the squash commit's tree equals PR
  #116's head.
- **The images' default users** (`docker image inspect`): Prometheus `nobody`, Loki `10001`, Tempo
  `10001:10001`, Grafana `472`.

From revision 1:

- **Repository**: `master` = `origin/master` = `ebaa9fa`, with a clean working tree.
- **Renders** with Compose v5.6.1 and Docker 29.9.2 on Docker Desktop:
  - Compose got an empty `--env-file` from a session scratchpad, so it never read
    `observability/.env`;
  - rendered: the base file; base + production; + the candidate overlay of §5.2 and §6.4, with
    `config -q` exiting 0 although the secret file was missing; + revision 1's test overlay, which
    also had 4317 and gave seven mappings; + the guard of §6.3;
  - the scratch files are not in the repository.
- **Images**:
  - `docker image inspect` of `grafana/tempo:3.1.0` and `grafana/grafana-oss:13.0.2`;
  - a Tempo container that was created, never started (`--network none`), exported for
    `/var/tempo`'s ownership, then removed;
  - `docker cp` of `/etc/passwd` and `/etc/group` from the running `tempo`, and of `/run.sh` from
    the running `grafana`;
  - `docker diff tempo`.
- **The development volume**: a read-only helper container (`grafana/alloy:v1.20.1`,
  `--network none`, mounted `:ro`) listed `nimuairy-observability_tempo-data`.
- **Upstream source**, read through the GitHub API at the pinned tags:
  - docker/compose v5.6.0: `pkg/compose/create.go`, `pkg/compose/secrets.go`, `go.mod`;
  - compose-spec/compose-go v2.16.1: `loader/reset.go`;
  - grafana/grafana v13.0.2: `pkg/setting/setting.go`, `conf/defaults.ini`,
    `pkg/cmd/grafana-cli/commands/reset_password_command.go`.
- **CI and GitHub**: the step timings of run 43589477382 (master, 2026-11-14); PR #116's state;
  the `release.yml` runs (none after 2026-10-19T22:44:36Z).
- **Planning notes** [PLAN], outside the repository: the rollout plan of 2026-10-31 and the S4 plan
  of 2026-11-02, which hold D1's context and the original S4b sketch.
