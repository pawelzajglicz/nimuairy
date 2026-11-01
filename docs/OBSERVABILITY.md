# Observability

OpenTelemetry is being introduced in small stages. Each section below covers one stage that
is already in place.

## Stage 1: backend traces on stdout

The backend runs locally with the [OpenTelemetry Java agent](https://opentelemetry.io/docs/zero-code/java/agent/),
which instruments Tomcat, Spring MVC, Spring Data, Hibernate and JDBC without code changes. It
prints every finished span to the console. Only traces are exported: metrics and logs are off,
and nothing is sent over OTLP.

### Requirements

- JDK 25 and the Maven Wrapper (`nimuairy-api/mvnw`).
- Postgres on `localhost:5432`: `docker compose up -d postgres` (the `dev` profile connects there).
- Access to Maven Central on the first run, to download the agent. It is cached in `~/.m2` after that.

### Run

```bash
cd nimuairy-api
./mvnw spring-boot:run -Potel -Dspring-boot.run.profiles=dev
```

The `otel` Maven profile in `nimuairy-api/pom.xml` does three things:

1. Copies `io.opentelemetry.javaagent:opentelemetry-javaagent` to
   `target/otel/opentelemetry-javaagent-<version>.jar`. The version is pinned in the
   `opentelemetry-javaagent.version` property.
2. Attaches the jar to the application JVM with `-javaagent`. Maven's own JVM is not
   instrumented, and the agent is never added to the application classpath.
3. Passes the agent configuration as environment variables:

| Variable | Value | Why |
|---|---|---|
| `OTEL_SERVICE_NAME` | `nimuairy-api` | Service identity on every span |
| `OTEL_TRACES_EXPORTER` | `console` | The agent's `LoggingSpanExporter`, with a simple (unbatched) span processor |
| `OTEL_METRICS_EXPORTER` | `none` | Metrics are a later stage. The agent's default would be OTLP |
| `OTEL_LOGS_EXPORTER` | `none` | Logs are a later stage. The agent's default would be OTLP |
| `OTEL_JAVAAGENT_LOGGING` | `application` | The console exporter writes through the agent's internal logger, which prints to **stderr** by default. `application` routes it through the app's Logback console instead, so spans land on **stdout** next to the application logs |

Without `-Potel` the backend runs exactly as before, with no agent. The default build and CI do
not use the profile. The Docker image only reuses its copy step to ship the agent jar (stage 2).

### Verify

With the app running, generate a few requests:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/api/v1/battles/demo   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/actuator/health       # 200
```

A request that reaches the database: a login for a user that doesn't exist returns 401 and
changes no data. CSRF is on, so the `XSRF-TOKEN` cookie is fetched first:

```bash
curl -s -c jar -o /dev/null http://localhost:8000/api/v1/battles/demo
curl -s -b jar -o /dev/null -w '%{http_code}\n' \
  -H "X-XSRF-TOKEN: $(awk '$6=="XSRF-TOKEN"{print $7}' jar)" -H 'Content-Type: application/json' \
  -d '{"username":"no-such-user","password":"x"}' http://localhost:8000/api/auth/login  # 401
rm jar
```

The agent logs its version once at startup:

```
i.o.javaagent.tooling.VersionLogger      : opentelemetry-javaagent - version: 2.32.0
```

Each finished span is one log line from `LoggingSpanExporter`, in the form
`'<span name>' : <trace id> <span id> <kind> [tracer: <instrumentation>:<version>] AttributesMap{...}`:

```
i.o.e.logging.LoggingSpanExporter        : 'GET /api/v1/battles/demo' : e6f8bd035c181a815fd73bf6c130914e ff10c0631ea8052a SERVER [tracer: io.opentelemetry.tomcat-10.0:2.32.0-alpha] AttributesMap{data={http.request.method=GET, http.route=/api/v1/battles/demo, http.response.status_code=200, ...}}
```

The login produces one trace: a `POST /api/auth/login` SERVER span plus `UserRepository.findByUsername`
(Spring Data), a Hibernate span and a `SELECT nimuairy.users` JDBC CLIENT span, all sharing the
same trace id. The JDBC instrumentation sanitizes SQL literals to `?` by default. Children are
printed before their parent, because a span is exported when it ends.

What else to expect:

- Startup prints many root JDBC spans (Liquibase and Hibernate schema checks on the `main`
  thread) and an HTTP CLIENT span to `config.liquibase.com`. That is Liquibase's own analytics
  check, which tracing merely makes visible.
- Every `/actuator/health` call is traced too.

Request bodies, headers and cookies are not recorded: the agent does not capture HTTP headers
unless configured to.

### Not covered in stage 1

Stage 1 runs the backend outside Docker and only prints spans. Stage 2 below runs it in Compose
and sends traces, metrics and logs to a local Grafana stack. Browser tracing is not covered yet.

## Stage 2: traces, metrics and logs in a local Grafana stack

The backend container runs with the same Java agent and sends every signal to a stack of
Prometheus, Tempo, Loki, Alloy and Grafana in `observability/`. There is no OpenTelemetry
Collector:

| Signal | Path |
|---|---|
| Traces | agent → OTLP http/protobuf → `http://tempo:4318/v1/traces` |
| Metrics | agent's Prometheus exporter on `:9464/metrics` ← scraped by Prometheus every 15 s |
| Logs | Logback JSON on stdout → Docker → Alloy (`loki.source.docker`, through `docker-socket-proxy`) → Loki, for containers labelled `observability.logs=true` only ([Which logs are collected](#which-logs-are-collected)) |

Grafana links the three. A log line's `trace_id` opens the trace in Tempo, a span opens its log
lines in Loki, and a span opens the request rate and p95 latency in Prometheus. A point on the
latency graph opens the trace of a request it counts
([stage 3](#stage-3-from-a-metric-to-its-trace-exemplars)).

### Files

| File | Role |
|---|---|
| `observability/compose.yaml` | The stack, a Compose project of its own (`nimuairy-observability`). It creates the `nimuairy-observability` network, which it shares with the app, and its own `nimuairy-observability_stack` and `nimuairy-observability_docker-api` networks ([Networks](#networks)). Its `docker-socket-proxy` is the only service that mounts the Docker socket ([Docker API access](#docker-api-access)) |
| `observability/{prometheus,tempo,loki,alloy,grafana}/` | Configuration of each service |
| `compose.observability.yaml` | Overlay for the app: attaches the agent, joins the `nimuairy-observability` network, and labels the backend and frontend for log collection |
| `compose.observability.dev.yaml` | Development variant: `deployment.environment.name=development`, metrics port on `127.0.0.1:9464` |
| `scripts/observability-smoke-test.sh` | Checks the running stack, its network boundaries and the Docker API boundary of the socket proxy without the backend; CI's `observability` job runs it (see [Verify](#verify-1)) |
| `scripts/observability-exemplar-check.sh` | Checks the metric-to-trace path with the backend running; manual (see [stage 3](#stage-3-from-a-metric-to-its-trace-exemplars)) |

The stack is a separate Compose project, so the app can be rebuilt, restarted or wiped
(`down -v`) without touching Grafana or the stored telemetry. A plain `docker compose up`
neither needs nor starts the stack.

### Where the stack comes from

The stack is vendored from the course repository `ewoludev/minitask`, tag
`solution-observability-v2` (commit `ab36586`). Upstream it was added in `e55e652` and is
unchanged up to `solution-metrics-to-traces-v2`. The course repository has no license; the
course asks participants to add this stack to their own application.

The files were first copied byte for byte. The table lists everything Nimuairy changed since;
to see the exact lines, compare with the course files (Git converts line endings on Windows,
hence `--strip-trailing-cr`):

```bash
git clone --depth 1 --branch solution-observability-v2 https://github.com/ewoludev/minitask.git <dir>
diff -r --strip-trailing-cr <dir>/observability-stack observability
```

| Change | Why |
|---|---|
| Project name `nimuairy-observability` | Its volumes never mix with a copy of the course stack |
| Network name `nimuairy-observability` (course: `observability`) | A generic name could clash with another project's network or a copy of the course stack. The Compose key stays `observability` |
| A second network, `stack`: Loki, Grafana and Alloy are only on it, and only Prometheus and Tempo stay on `nimuairy-observability` | On the course's single network, the backend could reach every service of the stack ([Networks](#networks)) |
| Every port bound to `127.0.0.1` | As in `compose.override.yaml`: Docker's port publishing bypasses the host firewall, and Grafana's `admin/admin` and the unauthenticated Loki/Tempo endpoints must stay off the LAN |
| Prometheus job `nimuairy-api` → `backend-nimuairy:9464`, label `service_name: nimuairy-api` | Replaces the course's example `app` target. The agent's exporter puts `service.name` only on `target_info`, so the scrape adds it to every series |
| Grafana trace-to-logs maps `service.name` to the Loki label `app` | Alloy sets `app` from the container label `observability.app`; the course's `service` label does not exist |
| Alloy collects only containers labelled `observability.logs=true` (a `filter` in `discovery.docker`) | The course ships the logs of every container on the host. Production may collect the backend and frontend only, and one allowlist for development and production keeps the two from drifting apart |
| Alloy reads the Docker API through `docker-socket-proxy` (`wollomatic/socket-proxy`) and no longer mounts the Docker socket | The socket is root-equivalent access to the host. The proxy passes on only the read calls Alloy makes ([Docker API access](#docker-api-access)) |
| Grafana trace-to-metrics uses `http_server_request_duration_seconds` | The course queried its own Node metric |
| Image tags | Dependabot updates them here; the course keeps its own. Never take the course's tags over, they are older |
| Tempo: no `ingester` and `compactor` blocks; the 7-day retention is `overrides.defaults.compaction.block_retention` | Tempo 3 removed both blocks and refuses to start with them (`field ingester not found`); the course still runs Tempo 2.10 |

`steps.md` was not copied; its content is in this document.

### Run

The stack images come from Docker Hub and need no `dhi.io` login.

On a Linux engine, first give the socket proxy the group of the Docker socket, in
`observability/.env` (Git ignores it):

```bash
echo "DOCKER_SOCKET_GID=$(stat -c %g /var/run/docker.sock)" >> observability/.env
```

Docker Desktop needs nothing: its socket belongs to `root:root` with mode `0660`, and the default
group is `0`. With a wrong group the proxy cannot open the socket and exits, so `up --wait` fails
and Alloy does not start.

Start the stack, then the app with the overlay:

```bash
docker compose -f observability/compose.yaml up -d --wait
docker compose -f compose.yaml -f compose.override.yaml \
  -f compose.observability.yaml -f compose.observability.dev.yaml up -d --build --wait
```

Without the stack the second command fails, because the external network
`nimuairy-observability` does not exist; nothing is sent anywhere else. The overlay changes the
backend and adds a label to the frontend.
Run the second command without the two overlay files to go back to the backend without the
agent. Without the overlay no app container is labelled, so Alloy ships none of their logs.

| Service | URL (host) |
|---|---|
| Grafana | <http://127.0.0.1:3000> (`admin`/`admin`; it asks for a new password on first login) |
| Prometheus | <http://127.0.0.1:9090> |
| Tempo API | <http://127.0.0.1:3200>; OTLP on `127.0.0.1:4317` (gRPC) and `127.0.0.1:4318` (HTTP) |
| Loki API | <http://127.0.0.1:3100> |
| Alloy UI | <http://127.0.0.1:12345> |
| Backend metrics | <http://127.0.0.1:9464/metrics> (dev variant only) |

Stop the stack with `docker compose -f observability/compose.yaml down`. Add `-v` to also
delete the stored metrics, traces, logs and Grafana state.

### What the overlay sets

| Setting | Value | Why |
|---|---|---|
| `entrypoint` | `java -javaagent:/app/otel/opentelemetry-javaagent.jar -jar app.jar` | The image ships the agent (`nimuairy-api/Dockerfile`) but does not attach it. `JAVA_TOOL_OPTIONS` would attach it to the `HEALTHCHECK` JVM too, which would then fight the app for port 9464 |
| `OTEL_SERVICE_NAME` | `nimuairy-api` | Service identity on every signal |
| `OTEL_TRACES_EXPORTER`, `OTEL_EXPORTER_OTLP_PROTOCOL` | `otlp`, `http/protobuf` | |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | `http://tempo:4318/v1/traces` | Traces only. The base `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` stay unset: Tempo needs no auth and metrics do not go over OTLP |
| `OTEL_METRICS_EXPORTER` | `prometheus` | The agent serves `/metrics` itself (`OTEL_EXPORTER_PROMETHEUS_HOST`/`_PORT`: `0.0.0.0`, `9464`) instead of pushing OTLP |
| `OTEL_LOGS_EXPORTER` | `none` | Logs reach Loki from stdout; this does not affect the app's own Logback output |
| `OTEL_JAVAAGENT_LOGGING` | `application` | Agent warnings (e.g. failed exports) go through Logback, so they are JSON too |
| `LOGGING_STRUCTURED_FORMAT_CONSOLE` | `logstash` | Spring Boot's built-in structured logging: one JSON object per line, stack traces in a single `stack_trace` field, no banner |
| label `observability.logs` (backend and frontend) | `"true"` | Alloy collects the logs of labelled containers only ([Which logs are collected](#which-logs-are-collected)) |
| label `observability.app` (backend) | `nimuairy-api` | Alloy turns it into the Loki label `app` |
| `OTEL_RESOURCE_ATTRIBUTES` (dev file) | `deployment.environment.name=development` | |

The agent adds `trace_id`, `span_id` and `trace_flags` to Logback's MDC for each log event,
captured on the thread that logs and only when a valid span is active. A log line written during a
request therefore carries the IDs, and the startup log does not. The application has no code
for this.

### Which logs are collected

Alloy ships a container's logs only if the container has the label `observability.logs=true`. This
allowlist is the same in development and production. `discovery.docker` passes it to the Docker API
as a filter, so Alloy never lists, inspects or tails any other container. With the overlay that means
the backend and the frontend (nginx writes access lines to stdout and errors to stderr). Without the
overlay it means nothing from the app.

- `observability.app` alone does not opt a container in. It only sets the Loki label `app`. The
  frontend has no `app` label, so query it with `{container="frontend-nimuairy"}`.
- The allowlist is what Alloy collects, not a security boundary. The socket proxy cannot see the
  filter, so a compromised Alloy could still list, inspect and read every container
  ([Docker API access](#docker-api-access)).
- Postgres, the stack's own services and every other container are not collected. Read their logs
  with `docker logs <container>`. To collect another container, add the label to its Compose
  service.
- Compose does not restart Alloy when `observability/alloy/config.alloy` changes. Run
  `docker compose -f observability/compose.yaml restart alloy`.

### Networks

The app and the stack share one network, and on the stack's side only the services the backend must
talk to join it:

| Network | Created by | Members | Carries |
|---|---|---|---|
| `nimuairy-observability` | the stack; the app joins it as an external network (`compose.observability.yaml`) | backend, Tempo, Prometheus | traces to `tempo:4318`; Prometheus's scrape of `backend-nimuairy:9464` |
| `nimuairy-observability_stack` | the stack | Prometheus, Tempo, Loki, Grafana, Alloy | Grafana's queries; Alloy's pushes to Loki; Prometheus's scrape of Alloy |
| `nimuairy-observability_docker-api` (internal) | the stack | Alloy, docker-socket-proxy | Alloy's Docker API calls ([Docker API access](#docker-api-access)) |

So the backend shares no network with Loki, Grafana or Alloy, and their names don't resolve on its
networks. Whether a connection to their addresses is also dropped depends on the Docker engine: a
Linux engine drops it, while Docker Desktop lets connections to published ports through (see below).
The frontend joins neither network: Alloy reads its logs, and the backend's, through the Docker API,
via the socket proxy.

Keep the definition of `nimuairy-observability` (key, name and settings) as it is. Compose stores a
hash of it on the network and would have to recreate the network after a change, which Docker refuses
while the backend, from the other project, is attached.

What the separation does not do:

- **It does not filter ports.** Membership opens every port of a network's members, so besides
  Tempo's OTLP intake the backend also reaches Tempo's query API (`3200`) and Prometheus's API
  (`9090`). This is an accepted limitation.
- **It does not limit who reaches the backend's metrics.** The agent serves them on `0.0.0.0:9464`,
  so every container on the backend's other networks reaches the port too: the frontend (and, in
  production, cloudflared) on `frontend`, Postgres on `backend`. Also accepted. nginx has no route
  to the port.
- **It is not enforced on Docker Desktop for published ports.** A container there can connect to a
  published port of a container in another network by its address, while a Linux engine drops
  such connections (with a raw-table rule since Docker 28.2). Unpublished ports are dropped on both.
  With the stack's development ports, the backend can therefore reach Loki, Grafana and Alloy by
  address on Docker Desktop. The smoke test reports these connections as `WARN`, never as passed.
  Only a Linux engine, such as CI or the VPS, verifies the isolation.
- **`internal: true` would not help for the first two networks.** Docker publishes a container's
  ports only through a non-internal network, and every service on them publishes one. An internal
  network does not separate a container from the host either: the host reaches every container
  address, and containers reach host services on the bridge's address. Only
  `nimuairy-observability_docker-api` is internal: no port is published through it, and the proxy
  needs no traffic beyond Alloy's requests. That the host can still reach the proxy's address is why
  the proxy also accepts only Alloy as a client. Docker's documentation says so too: the bridge of an
  internal network normally gets a host address, so "processes on the Docker host can access the
  network" (only the opt-in gateway mode `isolated` removes that address). The smoke test checks
  that a client in the host's network namespace gets `403` from the proxy, strictly on a Linux engine
  only ([Verify](#verify-1)).

### Docker API access

Alloy finds containers and reads their logs through the Docker Engine API. Access to the Docker
socket is root-equivalent: anything that can call the API can start a privileged container. So the
stack's `docker-socket-proxy` ([wollomatic/socket-proxy](https://github.com/wollomatic/socket-proxy))
is the only service that mounts the socket, and Alloy reaches it over the internal
`nimuairy-observability_docker-api` network at `tcp://docker-socket-proxy:2375`:

```
Alloy ──tcp://docker-socket-proxy:2375──► docker-socket-proxy ──/var/run/docker.sock──► Docker Engine (root)
      nimuairy-observability_docker-api     user 65534, the socket's group,
      (internal: Alloy and the proxy only)  read-only root filesystem, no capabilities
```

The proxy allows only the requests that Alloy v1.20 makes, as read in its source and in the Docker
client it uses:

| Request | Made by | Why |
|---|---|---|
| `HEAD /_ping` | both components | API version negotiation |
| `GET /v1.NN/containers/json` | `discovery.docker`, every 5 s | Lists the labelled containers (the label filter is a query parameter) |
| `GET /v1.NN/networks` | `discovery.docker`, every 5 s | Network metadata; a refresh fails without it |
| `GET /v1.NN/containers/<64-hex id>/json` | `loki.source.docker`, at start and every 5 s per container | Container state and TTY mode |
| `GET /v1.NN/containers/<64-hex id>/logs` | `loki.source.docker` | The followed log stream |

The proxy checks each request in this order and refuses it at the first check it fails:

| Check | Refusal | Logged reason |
|---|---|---|
| Client: only `alloy` (`-allowfrom=alloy`, resolved through Docker's DNS on each request) | `403 Forbidden` | `forbidden IP` |
| Method: only `HEAD` and `GET` | `405 Method Not Allowed` | `method not allowed` |
| Path: the patterns above, anchored at both ends and matched against the decoded path, without removing `.` or `..` segments | `403 Forbidden` | `path not allowed` |

So any other client gets `403` even for a request Alloy may make. The proxy logs every refusal before
it answers, as a `blocked request` line with the reason, method, URL (query string included) and
client address. Containers are addressed by their full ID only, so `/containers/<name>/json` and
short IDs are refused as well. The proxy publishes no port.

The proxy takes its rules only from its command-line flags and from `SP_*` environment variables.
`SP_ALLOW_<METHOD>` would allow another method, and `-proxycontainername` (or
`SP_PROXYCONTAINERNAME`) would add allowlists read from container labels. The stack sets neither; the
smoke test pins the proxy's exact command and fails on any `SP_*` variable. `-allowfrom` trusts
Docker's DNS: a container that joined `nimuairy-observability_docker-api` under the alias `alloy`
would be accepted. Joining a network takes access to the Docker API, which is root-equivalent anyway.

**A `403` is not a network block.** A `403` from the proxy is an HTTP answer: the client reached the
proxy over TCP and the proxy refused it. A name that does not resolve, or a connection that is
refused or times out, is a block below HTTP. The two prove different things, so the smoke test
expects the one that fits where the client is:

| Client | Expected |
|---|---|
| Alloy (the smoke test uses a probe in Alloy's network namespace) | `200` for the requests above, `403` `path not allowed` for other paths, `405` `method not allowed` for other methods |
| Another container on `nimuairy-observability_docker-api` | Reaches the proxy; `403` `forbidden IP` for every request |
| A container on `nimuairy-observability` only, or on `nimuairy-observability_stack` only | `docker-socket-proxy` does not resolve, and its address takes no TCP connection |
| A process in the host's network namespace, Linux engine | Reaches the proxy's address ([Networks](#networks)); `403` `forbidden IP`, logged with the network's gateway as the client |
| The same on Docker Desktop | Not verified: host networking there is an opt-in feature, and Docker does not document which network namespace it uses |

**`tcp://`, not `http://`.** For `http(s)://` hosts, Alloy v1.20 gives `loki.source.docker` an HTTP
client whose timeout is `refresh_interval`, and that timeout also covers reading the response body.
Every followed log stream would end after 5 s and restart from a timestamp with one-second
precision ([grafana/alloy#7290](https://github.com/grafana/alloy/issues/7290), fixed in v1.21).
With `tcp://` the Docker client uses its own HTTP client, which has no timeout, and the
`refresh_interval` of `loki.source.docker` has no effect.

**Health and readiness.** The proxy's health check proves less than "the API works":

| Signal | Proves | Does not prove |
|---|---|---|
| The proxy is `healthy` (the image's `/healthcheck`) | The proxy runs and can open the Docker socket with its group. Its listener on 2375 is bound: the proxy exits if binding fails, before it starts the health check server | That 2375 answers HTTP, that the allowlist and `-allowfrom` work, or that the Docker API answers |
| Alloy's `depends_on` the proxy being `service_healthy` | `up` starts Alloy only once the proxy can open the socket, and a wrong group fails `up --wait` | Anything after a daemon restart or a reboot: restart policies start containers without that order |

What brings log collection back is Alloy's own retry. `discovery.docker` repeats a failed refresh
every 5 s and keeps the targets it found last. `loki.source.docker` inspects each container every
5 s and reopens its log stream when it has ended. If the proxy's API does not answer yet when Alloy
starts, or goes away later, collection resumes within about 5 s of it answering again, without a
restart of Alloy. Alloy has no backoff, so during a long outage it logs an error every 5 s. The
smoke test sends its probe's logs along this whole path ([Verify](#verify-1)).

What the proxy does not protect:

- **The environment of every container.** `GET /containers/<id>/json` returns `Config.Env`, and
  container IDs are opaque, so the allowlist cannot limit which container is inspected. Whoever
  controls Alloy can read the environment of any container, including the secrets the production
  app passes as variables (`POSTGRES_PASSWORD`, `SPRING_DATASOURCE_PASSWORD`, `JWT_SECRET`,
  `TUNNEL_TOKEN`). Moving them out of the environment is
  [deferred](DEFERRED_WORK.md#s3--application-secrets-out-of-container-environment-variables).
  This is an accepted risk, and the smoke test confirms it with a harmless variable of its own probe.
- **The label allowlist.** The proxy matches paths, not query parameters, so it never sees the
  `observability.logs=true` filter. The filter decides what Alloy collects; it is not a security
  boundary of the Docker API. A compromised Alloy could list every container and read the logs of
  any of them. The smoke test shows Alloy's address inspecting a container without the label.
- **Against its own flaws, only partly.** The proxy holds the socket. Its user, read-only file
  system and dropped capabilities limit what a flaw in the proxy process could do, nothing more.
  Anyone else with access to the Docker API, such as the members of the host's `docker` group, has
  root anyway.
- **Every log line.** When a stream ends, Alloy resumes it from the second of the last line it read,
  so lines of that second can arrive twice. It also drops the container's saved position; if Alloy
  itself restarts before the stream reopens, it reads that container's log from the start again
  (duplicates, or lines Loki rejects as too old). Lines written during a short interruption are
  read once the stream reopens, as long as Docker's log driver still keeps them. Collection is not
  guaranteed to be lossless, for example across a long outage or a log rotation.
- **Against a hanging API.** Alloy v1.20 sets no timeout on inspecting a container or opening its
  log stream, just as with the socket before. A proxy or daemon that hangs stalls collection until
  it answers.

To find out why logs are missing:

- `docker logs docker-socket-proxy`: `blocked request` lines show what the proxy refused. Alloy
  should never appear there. If it does after an Alloy upgrade, the new version makes another API
  call; extend the allowlist only for a call you have traced to Alloy. `socket not available` with
  `permission denied` at start means a wrong `DOCKER_SOCKET_GID`.
- `docker logs alloy`: `Unable to refresh target groups` means discovery cannot reach the API;
  `could not inspect container info` and `could not fetch logs` mean a stream cannot start;
  `could not transfer logs` and `finished transferring logs` mean a stream ended. In normal
  operation the last two appear only when a container stops.
- The Alloy UI (<http://127.0.0.1:12345>), component `loki.source.docker.containers`: each target's
  `is_running` and `last_error`.
- To see every request the proxy lets through, add `-loglevel=debug` to its `command` for a while.

### Verify

Check the stack on its own first:

```bash
bash scripts/observability-smoke-test.sh
```

It waits for every service to be ready, checks Grafana's three datasources and the Prometheus
targets, checks that Prometheus stores exemplars and Grafana links them to Tempo, and sends a probe
through each path: an OTLP trace to Tempo, and the logs of a container labelled
`observability.logs=true` and `observability.app` through Alloy to Loki.

A second container that has only `observability.app` must stay out of Loki. After the labelled
container's log reaches Loki, the test waits another 20 s before checking that the unlabelled
container's log is still missing from every stream. This gives Alloy time for at least three
discovery rounds and Loki time to ingest the log, had it been collected.

The test then checks the [network boundaries](#networks) with a stand-in for the backend: a container
on `nimuairy-observability`.

- The stand-in must reach Tempo's OTLP intake, and Prometheus must reach the stand-in.
- Loki, Grafana and Alloy must not be on that network and must not resolve there.
- Connections from the stand-in to their addresses on `nimuairy-observability_stack` must fail. A
  name that doesn't resolve is no proof on its own.
- Every negative check has a positive counterpart, so a broken probe cannot pass as isolation. The
  stand-in must resolve `tempo` and connect to it with the same tools (`nslookup`, `nc`).
  Prometheus, on `nimuairy-observability_stack`, must connect to each address and port the stand-in
  must not reach.

On Docker Desktop, a connection that succeeds to a published port is reported as `WARN`. On any other
engine, including one the test cannot identify, it fails the test. With warnings, the run ends with
"No check failed, but the WARN checks above were not verified" instead of "All checks passed". The
`info` lines show the accepted limitation: the stand-in reaches Tempo's and Prometheus's APIs.

Last, the test checks the [Docker API boundary](#docker-api-access) of `docker-socket-proxy`.

- Its probes run the Grafana image, which has `curl`, `nc` and `nslookup`. Busybox `nc` cannot be the
  HTTP client: it half-closes the connection once it has sent the request, and the proxy then
  cancels a request it is passing on to Docker (`502`).
- Before a probe is used, its network mode and networks are checked, so each result describes only
  that probe's network position.

What it checks:

- **Configuration**, as the running containers have it:
  - only the proxy, of the stack's containers, mounts the Docker socket;
  - it publishes no port and is on `nimuairy-observability_docker-api` only, which is internal and
    has only Alloy and the proxy;
  - its image, user, read-only root filesystem, capabilities and `no-new-privileges`;
  - its exact command, and no `SP_*` variable.
- **Alloy's requests**, from a probe in Alloy's network namespace:
  - `HEAD /_ping` and the four `GET` requests return `200` with Docker's data;
  - `HEAD /_ping` is retried for up to 60 s. It is the first answer of the proxy's API, which
    `healthy` does not prove.
- **Refusals**: other paths get `403` and other methods `405`, for example `GET /v1.NN/info`, a
  container name or short ID, or `DELETE` and `PUT` on a container.
  - Docker would answer most of these itself, so each status must come with the proxy's
    `blocked request` line for that exact request. Every request carries its own `smoke=` query
    parameter, which the proxy logs and Docker ignores.
  - The `DELETE` targets the test's own container, which must still run unchanged afterwards.
- **Accepted risk**: Alloy's address can inspect the test's unlabelled container, environment
  included. The test fails if that ever changes, because this document would then be wrong.
- **Other clients**, as in the table under Docker API access:
  - another container on `nimuairy-observability_docker-api` resolves the proxy, connects to it and
    gets `403` `forbidden IP`;
  - a container on `nimuairy-observability` alone, and one on `nimuairy-observability_stack` alone,
    neither resolves the proxy nor connects to its address. Each must still resolve and reach a
    service of its own network (Tempo, Loki), and a probe in Alloy's network namespace must
    connect to that address;
  - a client in the host's network namespace gets `403` `forbidden IP`, with the gateway of
    `nimuairy-observability_docker-api` as its address.

  A failed connection never counts as a refusal by the proxy. A TCP check counts as isolation only
  when `nc` ran in the probe and reported that it could not connect (timed out or refused). A probe
  that could not run fails the check. The DNS and TCP checks are strict on every engine, because the
  proxy's port is not published and its network is internal. The host check is strict on a Linux
  engine and a `WARN` on Docker Desktop, even when the proxy refuses the client there.
- **Log continuity in normal operation**: the labelled probe writes numbered lines. At the end, Loki
  must hold every line from 1 to the last one the probe wrote, at least 15.
  - The query covers the probe's lifetime. If it returns as many lines as its limit (1000), the
    result may be cut off. The check then fails instead of judging completeness.
  - Duplicates are reported as `info`.
  - Alloy must log no `could not transfer logs` for the probe while the probe and Alloy keep
    running. That message means a followed stream broke with an error. It is also the sign of an
    `http://` host in `config.alloy`, whose streams restart every 5 s and could pass the line
    check with duplicates.
  - `finished transferring logs` (a stream that ended cleanly, normally because its container
    stopped) and failed attempts to open a stream are only counted, as `info`. Alloy reopens a
    stream within 5 s from the last second it read, so these say nothing about loss.
  - This covers normal operation during the run only. It covers no outage, and it is no proof that
    collection is lossless.
- **Alloy's own requests**: at the end, no refusal in the proxy's log since the run started may come
  from Alloy.
  - A refusal is Alloy's when it comes from Alloy's address without a `smoke=` parameter, so the
    test's own refusals from that address never count.
  - Requests Alloy made before the run, such as its first `HEAD /_ping`, are not covered.

The test starts and changes nothing but its own probe containers. It removes them when it exits,
including when it is interrupted, and checks that only Alloy and the proxy are left on
`nimuairy-observability_docker-api`.

CI's `observability` job starts the stack and runs it on every PR that touches the stack, the
overlay files or the script. Set `GRAFANA_AUTH` (default `admin:admin`) if you changed Grafana's
password.

The checks with the backend below stay manual. The commands use Git Bash. Set `MSYS_NO_PATHCONV=1` for commands whose arguments contain
paths such as `/api/v1/...`: Git Bash otherwise rewrites them (`C:/Program Files/Git/api/...`)
and queries silently match nothing. Generate some traffic first:

```bash
for i in $(seq 90); do curl -s -o /dev/null http://127.0.0.1:8000/api/v1/battles/demo; sleep 1; done
```

Tempo returns a trace by ID about 2 s after its request, but TraceQL search finds it only after
about 30 s (measured with Tempo 3.1).

| Signal | Check | Expected |
|---|---|---|
| Stack | `docker compose -f observability/compose.yaml ps` | All services up, ports only on `127.0.0.1`. Prometheus and Grafana `healthy` |
| Stack | `curl -u admin:admin 127.0.0.1:3000/api/datasources/uid/{prometheus,loki,tempo}/health` | `"status":"OK"` for each |
| Traces | `curl -sG 127.0.0.1:3200/api/search --data-urlencode 'q={ resource.service.name = "nimuairy-api" && span.http.route = "/api/v1/battles/demo" }'` | At least one trace |
| Traces | `docker logs backend-nimuairy 2>&1 \| grep -ci "failed to export"` | `0` |
| Metrics | `docker exec prometheus wget -qO- http://backend-nimuairy:9464/metrics \| grep '^http_server_request_duration_seconds'` | `_bucket`, `_sum`, `_count` with `http_route`, `http_request_method`, `http_response_status_code` |
| Metrics | Prometheus `up{job="nimuairy-api"}` | `1` |
| Metrics | `http_server_request_duration_seconds_count{service_name="nimuairy-api",http_route="/api/v1/battles/demo"}` | Greater than 0 |
| Metrics | `histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{service_name="nimuairy-api"}[2m])))` | A number, not `NaN` |
| Logs | `docker logs backend-nimuairy 2>/dev/null \| grep -vc '^{'` | `0`: every stdout line is JSON |
| Logs | A rejected login (the curl recipe from stage 1), then `docker logs backend-nimuairy \| grep 'Login rejected'` | One JSON line with `trace_id` and `span_id`. That trace in Tempo has the root span `POST /api/auth/login` with the same span ID |
| Logs | The `Started NimuairyApiApplication` line | No `trace_id`/`span_id` |
| Logs | Loki: `{app="nimuairy-api"} \| json \| trace_id="<id>"` | The login line. `trace_id` is a parsed field, not an indexed label (`/loki/api/v1/labels`) |
| Logs | `curl -s -o /dev/null 127.0.0.1:4200/`, then Loki: `{container="frontend-nimuairy"}` | The nginx access line of that request |
| Logs | `curl -sG 127.0.0.1:3100/loki/api/v1/query --data-urlencode 'query=sum by (container) (count_over_time({stack="observability"}[5m]))'` | Only `backend-nimuairy` and `frontend-nimuairy` (plus the smoke test's probe, if it ran in that window). Use this, not `/label/container/values`: label values also list streams that have no lines in the time range |

To check the network boundaries from the backend itself, run a probe in its network namespace. The
backend and frontend images have no shell.

```bash
image=$(docker inspect --format '{{.Config.Image}}' prometheus)
loki_ip=$(docker inspect -f '{{(index .NetworkSettings.Networks "nimuairy-observability_stack").IPAddress}}' loki)
docker run --rm --network container:backend-nimuairy --entrypoint sh "$image" -c \
  "nslookup tempo.; nslookup loki.; nc -w 3 $loki_ip 3100 </dev/null; echo nc=\$?"
```

What to expect:

- `tempo.` resolves, so it prints a `Name:` line. `loki.` does not resolve and prints no `Name:`
  line. Busybox reports that as either `can't find … NXDOMAIN` or `Can't find …: No answer`, and
  the exit code can be 0 either way, so look for the `Name:` line. The trailing dot matters: with a
  search domain in `resolv.conf`, busybox `nslookup` queries only `<name>.<search domain>`, so a bare
  `loki` would never resolve and prove nothing. `tempo.` shows that the lookup itself works.
- `nc=1` on a Linux engine. Docker Desktop prints `nc=0` ([Networks](#networks)).
- Repeat the check for `grafana` (`3000`) and `alloy` (`12345`).
- From `container:frontend-nimuairy`, also check `tempo` and `prometheus`: the frontend shares no
  network with the stack.
- Check the backend's port `9464` with `nc` only, which sends no request. An HTTP request to
  `/metrics` discards exemplars ([stage 3](#stage-3-from-a-metric-to-its-trace-exemplars)).

Query Prometheus with `curl -sG 127.0.0.1:9090/api/v1/query --data-urlencode 'query=...'` and
Loki with `curl -sG 127.0.0.1:3100/loki/api/v1/query_range --data-urlencode 'query=...'
--data-urlencode since=15m`, or use Grafana's Explore view.

Fetching `/metrics` by hand, as in the first metrics check, discards the exemplars the backend
collected since the last scrape, so Prometheus never stores them
([stage 3](#stage-3-from-a-metric-to-its-trace-exemplars)).

### Update

- **Stack images**: Dependabot proposes tag bumps for `observability/compose.yaml` (weekly, after
  a 7-day cooldown), one PR per image; a manual bump works the same way. Read the release notes
  and wait for CI's `observability` job, which starts the stack with the new image and runs the
  smoke test. It does not start the backend, so for a bump that can change what the app sees
  (Tempo's OTLP intake, Prometheus scraping, Loki or Grafana queries) also run the backend checks
  above and `scripts/observability-exemplar-check.sh` before merging.
  Take one bump at a time: a major version can need config changes, as Tempo 3 did.
- **Alloy and the socket proxy**: a new Alloy version may make a Docker API call the proxy refuses.
  - The smoke test fails on any refusal of Alloy's own requests during its run, so CI catches that
    on the bump's PR.
  - Calls Alloy makes only at startup fall before that window. After a bump, also check
    `docker logs docker-socket-proxy` for `blocked request` lines from Alloy's address
    ([Docker API access](#docker-api-access)).
  - The smoke test pins the proxy's image and exact command. A new proxy version, or a change to
    its command, therefore needs the script updated too, once the checks pass with it.
- **Prometheus scrape config**: after editing `observability/prometheus/prometheus.yml`, reload it
  with `curl -X POST 127.0.0.1:9090/-/reload` (the stack runs Prometheus with
  `--web.enable-lifecycle`).
- **Agent version**: change `opentelemetry-javaagent.version` in `nimuairy-api/pom.xml`. The
  local `otel` profile and the image both read it; rebuild the image. Then run
  `bash scripts/observability-exemplar-check.sh`: the exporter that writes the exemplars ships
  inside the agent.
- **A newer course stack**: run the `diff` from
  [Where the stack comes from](#where-the-stack-comes-from) against the new tag. Differences that
  are not in the table there come from the course and can be taken over.

### Known warnings and limits

- Prometheus 3.11+ logs that `--enable-feature=native-histograms` is a no-op. Grafana 13 logs that
  `GF_FEATURE_TOGGLES_ENABLE` is deprecated. Loki logs one `empty ring` error while starting, and
  Tempo warns that the metrics generator is not configured. These flags come from the course and
  are kept as they are.
- Grafana logs errors at startup for the provisioning directories the stack does not use
  (`dashboards`, `plugins`, `alerting`) and for a failed background install of the bundled
  `elasticsearch` plugin. Neither affects the provisioned datasources.
- Tempo 3 logs `error calling scheduler … no jobs found` about once a minute while it has no
  compaction work ([grafana/tempo#7666](https://github.com/grafana/tempo/issues/7666)). At start it
  also warns about empty worker and scheduler addresses in single-binary mode and an `unowned file
  entry` in the WAL.
- With the agent attached, the JVM prints one plain-text line on stderr (`Sharing is only
  supported for boot loader classes…`). In Loki it is in the `logstream="stderr"` stream; add
  `| __error__=""` after `| json` to hide lines that are not JSON.
- The stack is for local development only. Only the socket proxy mounts the Docker socket, but
  through it Alloy can still read the environment and logs of every container
  ([Docker API access](#docker-api-access)). Alloy ships the logs of the labelled containers,
  including nginx access logs with client IPs. Server spans record `client.address` and
  `user_agent.original`. Grafana uses `admin`/`admin`, and the other services publish their ports on
  `127.0.0.1`. Running it on the VPS needs further hardening, which later stages add.

## Stage 3: from a metric to its trace (exemplars)

A point on the HTTP latency graph in Grafana links to the trace of a request it counts. The link
comes from an *exemplar*: one measurement stored next to a histogram bucket, together with the
`trace_id` and `span_id` of the span that was active when it was recorded.

Stage 2 already had every piece in place, so this stage changed no application code and no
configuration. It adds checks and this section. The course's stack is unchanged up to its
`solution-metrics-to-traces-v2` tag too. The course's Node app needed `prom-client` code for this
stage, but the Java agent's exporter writes exemplars on its own.

| Step | Where | What happens |
|---|---|---|
| Record | OTel SDK in the agent | The default exemplar filter, `trace_based`, keeps a measurement only while a sampled span is active, so a request's exemplar names its SERVER span. Each histogram bucket keeps one exemplar, the latest, until the next scrape |
| Expose | The agent's Prometheus exporter, `:9464/metrics` | Writes exemplars only in the OpenMetrics format, as `# {span_id="…",trace_id="…"} <value> <timestamp>` after a bucket line. The plain text format (`text/plain; version=0.0.4`) has none |
| Store | Prometheus | Asks for OpenMetrics first (its default `scrape_protocols`) and keeps the exemplars because of `--enable-feature=exemplar-storage` |
| Link | Grafana | The Prometheus datasource's `exemplarTraceIdDestinations` turns the exemplar label `trace_id` into a link to the Tempo datasource |

### Verify

With the stack and the app running as in [stage 2](#run-1):

```bash
bash scripts/observability-exemplar-check.sh
```

It sends requests to `/api/v1/battles/demo` and checks, in this order, that:

1. Prometheus stores an exemplar of that route from its own scrape (`/api/v1/query_exemplars`).
2. Tempo has the trace with that `trace_id`, and the exemplar's `span_id` is its SERVER span
   `GET /api/v1/battles/demo`.
3. Grafana returns the exemplar through its Prometheus datasource (`/api/ds/query`).
4. `/metrics` shows a bucket line with an exemplar when asked for OpenMetrics.

It takes about 15 s. CI runs only the smoke test, which checks the stack's side without the
backend: Prometheus stores exemplars, and Grafana links them to Tempo.

Grafana's frontend adds the link itself, so check it in the browser:

1. Generate traffic, for example with the loop from stage 2's [Verify](#verify-1).
2. In Explore, choose Prometheus and enter in Code mode:
   `histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{service_name="nimuairy-api"}[2m])))`.
   Under Options, set Type to Range and turn on Exemplars.
3. Hover over an exemplar marker on the graph and choose **View in Tempo**. The trace opens in a
   split view. Its Trace ID is the exemplar's `trace_id`, and its root span is the request, for
   example `GET /api/v1/battles/demo`.
4. From that trace, the links to the span's logs in Loki and to the request rate and p95 latency
   in Prometheus work as in stage 2.

To see raw exemplars, ask for OpenMetrics. This takes the exemplars away from Prometheus (see
below):

```bash
curl -s -H 'Accept: application/openmetrics-text; version=1.0.0' http://127.0.0.1:9464/metrics | grep ' # {'
```

```
http_server_request_duration_seconds_bucket{http_request_method="GET",http_response_status_code="200",http_route="/api/v1/battles/demo",...,le="0.005"} 112 # {span_id="a6e9a9361de138f7",trace_id="4949ce1fe3eb040f3cd3a025356a8ba7"} 0.004837072 1792957872.270
```

### Limits

- **Every scrape of `/metrics` resets the exemplars.** The backend holds only the exemplars
  recorded since the previous scrape, and any scrape takes them: a manual `curl`, or the `wget` in
  stage 2's checks. Prometheus then never stores them. A scrape in the plain text format discards
  them without showing them. The check script reads `/metrics` last for this reason.
- An exemplar is a sample: at most one per bucket per scrape interval, not one per request.
- Only sampled spans produce exemplars. The agent's default sampler (`parentbased_always_on`)
  samples every request. With a lower sampling rate, exemplars would follow the sampled traces.
- The image's health check calls `/actuator/health` every 30 s, so that route always has
  exemplars.
- Prometheus keeps the latest 100 000 exemplars (`storage.exemplars.max_exemplars`), independently
  of Tempo's 7-day retention. An old exemplar can point to a trace that Tempo has already deleted.
- On a `histogram_quantile(...)` graph, the exemplars come from the bucket series in the query.
  A marker shows the measured duration, not the quantile.
- `trace_id` and `span_id` are exemplar labels, not series labels, so they add no series.
