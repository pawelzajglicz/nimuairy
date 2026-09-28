# nimuairy
turn based game java+angular

## Setup

Enable repo git hooks (keeps `.claude/skills` and `.junie/skills` in sync with `.agents/skills`):

```
git config core.hooksPath .githooks
```

## Running with Docker

All three images are built from [Docker Hardened Images](https://www.docker.com/products/hardened-images/)
(`dhi.io`), so a one-time setup is needed before the first build:

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

Stop the stack:

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
   v
frontend (nginx, :4200 -> :8080)
   |
   | /api/*
   v
backend (Spring Boot, :8000)
   |
   v
postgres
```

Configuration is read from environment variables (see `.env.example`); copy it to `.env` to
override the defaults. The `JWT_SECRET` and Postgres credentials in `.env.example` are
local-development placeholders, not production secrets.

The backend and frontend runtime images are the hardened, distroless-style DHI tags: no
shell, no package manager, and they run as a non-root user by default. That's why the
backend has no container-level healthcheck (there's nothing to run `curl` with) and why
nginx listens on 8080 instead of 80 (a non-root process can't bind a privileged port).

For backend/frontend development outside Docker, see `nimuairy-api/CLAUDE.md` and
`frontend/CLAUDE.md`.
