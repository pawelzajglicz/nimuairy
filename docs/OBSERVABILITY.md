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

Without `-Potel` the backend runs exactly as before, with no agent. The default build, CI and
the Docker image do not use the profile.

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

### Not covered yet

Later stages will add Docker/Compose with the agent, OTLP export to Tempo, metrics, logs with
trace correlation, resource attributes such as `deployment.environment.name`, and browser
tracing.
