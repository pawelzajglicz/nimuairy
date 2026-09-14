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

### Battle development phase

The battle system is currently being developed as a prototype.

During the current prototype phase:

- The backend provides the initial battle state through an API.
- Battle rules and battle state transitions temporarily run on the frontend.
- Battle logic must still be implemented as a separate, framework-independent domain module.
- Battle logic must not be placed directly inside Angular components or templates.
- The frontend battle engine should follow the pure `(state, action) -> state` model.
- The architecture must make it possible to move the battle engine to the backend later.
- Do not implement multiplayer networking yet.

The future target architecture is:

    Angular
      -> BattleAction
      -> Backend
      -> BattleEngine
      -> new BattleState
      -> Angular

The current prototype intentionally uses:

    Backend
      -> initial BattleState
      -> Angular BattleEngine
      -> new BattleState

## Working with me

This project is also how I'm learning — explain why when you introduce a new pattern.
Ask before adding a dependency. Prefer small changes over big refactors.

### Working on the battle system

Work on the battle system in small milestones.

Before implementing a milestone:

1. Inspect the existing code and relevant documentation.
2. Explain the proposed approach briefly.
3. Identify files that will be changed.
4. Wait for approval if the task contains architectural ambiguity.

Do not implement multiple battle milestones in one change unless explicitly requested.

Prefer small, reviewable commits over large feature implementations.

## My preferences

<!-- Project-wide rules. e.g. commit message style, when to plan before coding,
     whether to write tests by default. -->
