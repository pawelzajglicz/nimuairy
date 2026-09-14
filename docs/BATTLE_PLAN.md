# Battle System Plan

## Goal

Implement the turn-based battle system incrementally while using the project
as a learning environment for AI-assisted software development.

The current prototype runs battle rules on the frontend.

The future production architecture will move the authoritative battle engine
to the backend.

## Current architecture

    Backend
        |
        | initial BattleState
        v
    Angular
        |
        v
    BattleEngine
        |
        v
    new BattleState

## Future architecture

    Angular
        |
        | BattleAction
        v
    Backend
        |
        v
    BattleEngine
        |
        v
    new BattleState
        |
        v
    Angular clients

## Milestones

### M1 — Demo Battle API

Backend returns a hard-coded initial battle.

Contains:

- board
- orb
- walls
- four units for player 1
- four units for player 2
- unit type
- HP
- defense
- attack
- position
- player ownership

No database.

### M2 — Battle Board

Load the battle from the backend and render:

- board
- orb
- walls
- units

### M3 — Unit Selection

Allow selecting a unit belonging to the current player.

The selected unit is visually distinguished.

### M4 — Movement

Implement:

- selecting a destination,
- validating movement,
- moving a unit,
- changing turns where appropriate.

Movement rules live in `BattleEngine`.

### M5 — Combat

Implement:

- selecting an enemy target,
- attack validation,
- damage calculation,
- HP changes,
- attacked-unit highlighting,
- unit death.

Initial damage formula:

    damage = max(0, attacker.attack - defender.defense)

### M6 — Turns

Implement:

- current player,
- legal actions,
- ending a turn,
- switching players.

### M7 — Victory

Implement:

- victory detection,
- defeat state,
- victory screen,
- attacked/dead unit handling.

### M8 — Refactoring

Review the battle domain and prepare it for moving the engine to Java.

### Later

- persistent battles
- authentication integration
- online multiplayer
- server-authoritative battle engine
- army selection
- different unit compositions
- matchmaking / lobby

## Rules for implementation

- Implement one milestone at a time.
- Keep changes small and reviewable.
- Do not implement future multiplayer infrastructure prematurely.
- Keep battle rules outside Angular components.
- Prefer immutable state transitions.
- Add tests for battle rules.
- Do not introduce a database until persistence is actually needed.