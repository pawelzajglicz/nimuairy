# Nimuairy

A turn-based game. Java/Spring Boot backend (`nimuairy-api/`), Angular frontend (`frontend/`),
PostgreSQL via `docker compose up -d`. Each subproject has its own CLAUDE.md.

Implemented: register/login with JWT, character CRUD. Not built yet: the turn/battle engine.

## Terms

- **Character** — a playable unit owned by a user; the thing that fights.
- **Turn** — one action by one character. **Round** — every participant has taken a turn.
- **Battle** — a sequence of rounds. **Action** — attack, defend, use ability.

## Rules

- **Game logic lives on the backend.** The server decides damage, turn order and outcomes;
  the frontend displays and requests. Keeps the game authoritative.
- Backend DTOs and `frontend/src/app/models/` must change in the same commit.
- Backend needs the `dev` profile to start: `./mvnw spring-boot:run -Dspring-boot.run.profiles=dev`
- `jwt.secret` in `application.yml` is a dev placeholder — don't commit real secrets.

## Working with me

This project is also how I'm learning — explain why when you introduce a new pattern.
Ask before adding a dependency. Prefer small changes over big refactors.

## My preferences

<!-- Project-wide rules. e.g. commit message style, when to plan before coding,
     whether to write tests by default. -->
