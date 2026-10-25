# syntax=docker/dockerfile:1

# Multi-stage build using Docker Hardened Images (dhi.io). Requires `docker
# login dhi.io` with a Docker Hub account enrolled in the free Community tier
# (docker.com/products/hardened-images) before these can be pulled.
FROM dhi.io/eclipse-temurin:26-jdk-alpine3.24-dev AS build
WORKDIR /app

# Resolve dependencies first so they're cached across source-only changes.
# The cache mount keeps Maven's downloaded artifacts across builds even when
# the layer cache above it is invalidated (e.g. after a pom.xml change).
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B dependency:go-offline

# The OpenTelemetry agent ships in every image but is attached only by
# compose.observability.yaml. Reusing the otel profile's copy execution keeps
# the agent version in one place (pom.xml).
RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw -B -Potel -Dmdep.stripVersion=true dependency:copy@copy-opentelemetry-javaagent

COPY src ./src
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B -DskipTests package

# Compiled here because the runtime image is a JRE without javac.
COPY docker/HealthCheck.java ./docker/
RUN javac -d /app/healthcheck docker/HealthCheck.java

# The non-dev runtime tag is distroless-style: no shell, no package manager,
# and it already runs as a non-root user by default, so there's nothing left
# to install or harden here.
FROM dhi.io/eclipse-temurin:26-alpine3.24
# Same UID as the base image default; stated here so the guarantee doesn't
# depend on the base tag and the Trivy IaC scan (DS-0002) can see it.
USER 65532
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
COPY --from=build /app/healthcheck ./healthcheck
COPY --from=build /app/target/otel/opentelemetry-javaagent.jar ./otel/opentelemetry-javaagent.jar

ENV SPRING_PROFILES_ACTIVE=docker
EXPOSE 8000

# Each probe starts a short-lived JVM, so the steady-state interval is
# relaxed; --start-interval polls faster only while the app is booting.
# SerialGC and a small heap keep the probe JVM's footprint minimal.
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    --start-period=90s --start-interval=3s \
    CMD ["java", "-XX:+UseSerialGC", "-Xmx16m", "-cp", "/app/healthcheck", "HealthCheck"]

# Runs without the OpenTelemetry agent. compose.observability.yaml overrides this
# entrypoint to add -javaagent, so a change to the start command must be copied
# there too.
ENTRYPOINT ["java", "-jar", "app.jar"]
