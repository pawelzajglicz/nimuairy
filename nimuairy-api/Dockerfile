# syntax=docker/dockerfile:1

# Multi-stage build using Docker Hardened Images (dhi.io). Requires `docker
# login dhi.io` with a Docker Hub account enrolled in the free Community tier
# (docker.com/products/hardened-images) before these can be pulled.
FROM dhi.io/eclipse-temurin:25-jdk-alpine3.24-dev AS build
WORKDIR /app

# Resolve dependencies first so they're cached across source-only changes.
# The cache mount keeps Maven's downloaded artifacts across builds even when
# the layer cache above it is invalidated (e.g. after a pom.xml change).
COPY .mvn/ .mvn/
COPY mvnw pom.xml ./
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B dependency:go-offline

COPY src ./src
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B -DskipTests package

# The non-dev runtime tag is distroless-style: no shell, no package manager,
# and it already runs as a non-root user by default, so there's nothing left
# to install or harden here.
FROM dhi.io/eclipse-temurin:25-alpine3.24
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar

ENV SPRING_PROFILES_ACTIVE=docker
EXPOSE 8000

ENTRYPOINT ["java", "-jar", "app.jar"]
