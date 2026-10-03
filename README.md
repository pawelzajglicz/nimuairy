# nimuairy
turn based game java+angular

## Setup

Enable repo git hooks (keeps `.claude/skills` and `.junie/skills` in sync with `.agents/skills`):

```
git config core.hooksPath .githooks
```

## Running with Docker

The frontend and backend images are built on
[Docker Hardened Images](https://www.docker.com/products/hardened-images/) (`dhi.io`) base
images, and Postgres runs the DHI image directly, so a one-time setup is needed first:

1. Have a Docker Hub account and enroll it in the free Hardened Images **Community** tier at
   [docker.com/products/hardened-images](https://www.docker.com/products/hardened-images/#compare)
   ("Start building").
2. `docker login dhi.io` (separate from a regular `docker login`).

Then:

```bash
docker compose up --build
```

Then open [http://localhost:4200](http://localhost:4200). The browser only ever talks to the
frontend container; nginx proxies `/api/*` to the backend internally.

`docker compose up` merges `compose.yaml` with `compose.override.yaml`, which publishes the
ports for local development: frontend (`localhost:4200`), backend (`localhost:8000`) and
Postgres (`localhost:5432`). `compose.yaml` on its own publishes nothing.

### Production

```bash
docker compose -f compose.yaml -f compose.prod.yaml up -d --build
```

Passing files explicitly skips `compose.override.yaml`, so no host ports are published.
The app is reachable only through a Cloudflare Tunnel: the `cloudflared` container opens an
outbound connection to Cloudflare, and the tunnel's route points at `http://frontend:8080`.
Production also runs `cloudflare/cloudflared`, the only image not from DHI.

`.env` must define `POSTGRES_PASSWORD`, `JWT_SECRET` and `CLOUDFLARED_TOKEN`; the stack
refuses to start without them instead of falling back to the dev placeholders.
`.env.example` leaves them empty on purpose, so a copied `.env` fails fast until real
values are filled in. `JWT_SECRET` must be at least 32 characters.

Stop production:

```bash
docker compose -f compose.yaml -f compose.prod.yaml down
```

On a dedicated production host, set `COMPOSE_FILE=compose.yaml:compose.prod.yaml` in `.env`.
Plain `docker compose up`/`down`/`ps` then use the production files, so the dev override
(and its published ports) can't be picked up by accident.

Stop the dev stack:

```bash
docker compose down
```

Stop the stack and delete the Postgres data volume:

```bash
docker compose down -v
```

### Container architecture

```text
browser
   |
   |  dev:  localhost:4200
   |  prod: Cloudflare -> cloudflared (outbound tunnel)
   v
frontend (nginx, :8080)
   |
   | /api/*            network: frontend
   v
backend (Spring Boot, :8000)
   |
   |                   network: backend (internal, no outside access)
   v
postgres
```

Configuration is read from environment variables (see `.env.example`); copy it to `.env` to
override the defaults. For local development `.env` is optional: values left empty fall
back to the dev placeholders in `compose.yaml`. Production requires real values (see
[Production](#production)).

The backend and frontend runtime images are the hardened, distroless-style DHI tags: no
shell, no package manager, and they run as a non-root user by default. That's why the
backend has no container-level healthcheck (there's nothing to run `curl` with) and why
nginx listens on 8080 instead of 80 (a non-root process can't bind a privileged port).

For backend/frontend development outside Docker, see `nimuairy-api/CLAUDE.md` and
`frontend/CLAUDE.md`.
