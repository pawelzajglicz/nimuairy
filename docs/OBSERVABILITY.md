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
lines in Loki, and a span opens the request rate and p95 latency in Prometheus. A point on the
latency graph opens the trace of a request it counts
([stage 3](#stage-3-from-a-metric-to-its-trace-exemplars)).

### Files

| File | Role |
|---|---|
| `observability/compose.yaml` | The stack, a Compose project of its own (`nimuairy-observability`). It creates the `nimuairy-observability` network |
| `observability/{prometheus,tempo,loki,alloy,grafana}/` | Configuration of each service |
| `compose.observability.yaml` | Overlay for the app: attaches the agent and joins the `nimuairy-observability` network |
| `compose.observability.dev.yaml` | Development variant: `deployment.environment.name=development`, metrics port on `127.0.0.1:9464` |
| `scripts/observability-smoke-test.sh` | Checks the running stack without the backend; CI's `observability` job runs it (see [Verify](#verify)) |
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
| Network name `nimuairy-observability` (course: `observability`) | A generic name could clash with another project's network or a copy of the course stack. The Compose key stays `observability`, so the services' `networks:` entries are unchanged |
| Every port bound to `127.0.0.1` | As in `compose.override.yaml`: Docker's port publishing bypasses the host firewall, and Grafana's `admin/admin` and the unauthenticated Loki/Tempo endpoints must stay off the LAN |
| Prometheus job `nimuairy-api` → `backend-nimuairy:9464`, label `service_name: nimuairy-api` | Replaces the course's example `app` target. The agent's exporter puts `service.name` only on `target_info`, so the scrape adds it to every series |
| Grafana trace-to-logs maps `service.name` to the Loki label `app` | Alloy sets `app` from the container label `observability.app`; the course's `service` label does not exist |
| Grafana trace-to-metrics uses `http_server_request_duration_seconds` | The course queried its own Node metric |
| Image tags | Dependabot updates them here; the course keeps its own. Never take the course's tags over, they are older |
| Tempo: no `ingester` and `compactor` blocks; the 7-day retention is `overrides.defaults.compaction.block_retention` | Tempo 3 removed both blocks and refuses to start with them (`field ingester not found`); the course still runs Tempo 2.10 |

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

Check the stack on its own first:

```bash
bash scripts/observability-smoke-test.sh
```

It waits for every service to be ready, checks Grafana's three datasources and the Prometheus
targets, checks that Prometheus stores exemplars and Grafana links them to Tempo, and sends a probe
through each path: an OTLP trace to Tempo and the logs of a container labelled `observability.app`
through Alloy to Loki. CI's `observability` job starts the stack and runs it on every PR that
touches the stack, the overlay files or the script. Set `GRAFANA_AUTH`
(default `admin:admin`) if you changed Grafana's password.

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
- The stack is for local development only. Alloy reads the Docker socket and ships the logs of
  every container on the host, including nginx access logs with client IPs. Server spans record
  `client.address` and `user_agent.original`. Grafana uses `admin`/`admin`. Running it on the VPS
  needs separate hardening and is not part of this stage.

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
