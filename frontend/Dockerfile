# syntax=docker/dockerfile:1

# Multi-stage build using Docker Hardened Images (dhi.io). Requires `docker
# login dhi.io` with a Docker Hub account enrolled in the free Community tier
# (docker.com/products/hardened-images) before these can be pulled.
#
# Node only exists in the build stage (compiling the Angular app); the -dev
# tag is used there since npm's install/build lifecycle needs a shell.
FROM dhi.io/node:26-alpine3.24-dev AS build
WORKDIR /app

COPY package.json package-lock.json ./
# The cache mount keeps npm's downloaded packages across builds even when
# the layer cache above it is invalidated (e.g. after a lockfile change).
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# The non-dev nginx runtime is distroless-style and already runs as a
# non-root user on port 8080 (unprivileged users can't bind port 80).
FROM dhi.io/nginx:1-alpine3.24
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html

EXPOSE 8080
