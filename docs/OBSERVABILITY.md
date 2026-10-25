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
| Logs | Logback JSON on stdout → Docker → Alloy (`loki.source.docker`) → Loki |

Grafana links the three. A log line's `trace_id` opens the trace in Tempo, a span opens its log
lines in Loki, and a span opens the request rate and p95 latency in Prometheus.

### Files

| File | Role |
|---|---|
| `observability/compose.yaml` | The stack, a Compose project of its own (`nimuairy-observability`). It creates the `nimuairy-observability` network |
| `observability/{prometheus,tempo,loki,alloy,grafana}/` | Configuration of each service |
| `compose.observability.yaml` | Overlay for the app: attaches the agent and joins the `nimuairy-observability` network |
| `compose.observability.dev.yaml` | Development variant: `deployment.environment.name=development`, metrics port on `127.0.0.1:9464` |

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
| Network name `nimuairy-observability` (course: `observability`) | A generic name could clash with another project's network or a copy of the course stack. The Compose key stays `observability`, so the services' `networks:` entries are unchanged |
| Every port bound to `127.0.0.1` | As in `compose.override.yaml`: Docker's port publishing bypasses the host firewall, and Grafana's `admin/admin` and the unauthenticated Loki/Tempo endpoints must stay off the LAN |
| Prometheus job `nimuairy-api` → `backend-nimuairy:9464`, label `service_name: nimuairy-api` | Replaces the course's example `app` target. The agent's exporter puts `service.name` only on `target_info`, so the scrape adds it to every series |
| Grafana trace-to-logs maps `service.name` to the Loki label `app` | Alloy sets `app` from the container label `observability.app`; the course's `service` label does not exist |
| Grafana trace-to-metrics uses `http_server_request_duration_seconds` | The course queried its own Node metric |

`steps.md` was not copied; its content is in this document.

### Run

The stack images come from Docker Hub and need no `dhi.io` login. Start the stack, then the app
with the overlay:

```bash
docker compose -f observability/compose.yaml up -d --wait
docker compose -f compose.yaml -f compose.override.yaml \
  -f compose.observability.yaml -f compose.observability.dev.yaml up -d --build --wait
```

Without the stack the second command fails, because the external network
`nimuairy-observability` does not exist; nothing is sent anywhere else. The overlay only changes
the backend.
Run the second command without the two overlay files to go back to the backend without the
agent.

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
| label `observability.app` | `nimuairy-api` | Alloy turns it into the Loki label `app` |
| `OTEL_RESOURCE_ATTRIBUTES` (dev file) | `deployment.environment.name=development` | |

The agent adds `trace_id`, `span_id` and `trace_flags` to Logback's MDC for each log event,
captured on the thread that logs and only when a valid span is active. A log line written during a
request therefore carries the IDs, and the startup log does not. The application has no code
for this.

### Verify

The commands below use Git Bash. Set `MSYS_NO_PATHCONV=1` for commands whose arguments contain
paths such as `/api/v1/...`: Git Bash otherwise rewrites them (`C:/Program Files/Git/api/...`)
and queries silently match nothing. Generate some traffic first:

```bash
for i in $(seq 90); do curl -s -o /dev/null http://127.0.0.1:8000/api/v1/battles/demo; sleep 1; done
```

A trace becomes searchable in Tempo 10–15 s after its request (exporter batch plus Tempo's
`trace_idle_period`).

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

Query Prometheus with `curl -sG 127.0.0.1:9090/api/v1/query --data-urlencode 'query=...'` and
Loki with `curl -sG 127.0.0.1:3100/loki/api/v1/query_range --data-urlencode 'query=...'
--data-urlencode since=15m`, or use Grafana's Explore view.

### Update

- **Stack images**: Dependabot proposes tag bumps for `observability/compose.yaml` (weekly, after
  a 7-day cooldown), one PR per image; a manual bump works the same way. Read the release notes,
  then check out the change and run `docker compose -f observability/compose.yaml config -q`,
  `pull`, `up -d --wait` and the checks above before merging. The tags were tested together
  upstream, so take one bump at a time.
- **Prometheus scrape config**: after editing `observability/prometheus/prometheus.yml`, reload it
  with `curl -X POST 127.0.0.1:9090/-/reload` (the stack runs Prometheus with
  `--web.enable-lifecycle`).
- **Agent version**: change `opentelemetry-javaagent.version` in `nimuairy-api/pom.xml`. The
  local `otel` profile and the image both read it; rebuild the image.
- **A newer course stack**: run the `diff` from
  [Where the stack comes from](#where-the-stack-comes-from) against the new tag. Differences that
  are not in the table there come from the course and can be taken over.

### Known warnings and limits

- Prometheus 3.11 logs that `--enable-feature=native-histograms` is a no-op. Grafana 13 logs that
  `GF_FEATURE_TOGGLES_ENABLE` is deprecated. Loki logs one `empty ring` error while starting, and
  Tempo warns that the metrics generator is not configured. These flags come from the course and
  are kept as they are.
- With the agent attached, the JVM prints one plain-text line on stderr (`Sharing is only
  supported for boot loader classes…`). In Loki it is in the `logstream="stderr"` stream; add
  `| __error__=""` after `| json` to hide lines that are not JSON.
- The stack is for local development only. Alloy reads the Docker socket and ships the logs of
  every container on the host, including nginx access logs with client IPs. Server spans record
  `client.address` and `user_agent.original`. Grafana uses `admin`/`admin`. Running it on the VPS
  needs separate hardening and is not part of this stage.
