# Battle System Plan

## Goal

Implement the turn-based battle system incrementally while using the project
as a learning environment for AI-assisted software development.

The current prototype runs battle rules on the frontend.

The future production architecture will move the authoritative battle engine
to the backend.

## Design Reference

The gameplay model and domain design are defined in [`GAME_DESIGN.md`](./GAME_DESIGN.md).

`BATTLE_PLAN.md` defines implementation order and milestone scope. It should
not duplicate the full game design.

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

Backend returns a deterministic, hard-coded initial `BattleState`.

Contains:

- a 21 × 11 board,
- terrain information for the board,
- one orb for each player,
- one wall protecting each player's orb,
- walls two cells wide,
- four units for player 1,
- four units for player 2,
- unit type,
- HP,
- defense,
- attack,
- anchor position,
- footprint,
- player ownership.

All initial units use a one-cell footprint.

Orbs and walls use the same board coordinate system as units; they are not
positioned outside the grid.

The domain model remains independent of Spring, JPA, and persistence concerns.

No database.

### M2 — Battle Board

Load the battle from the backend and render the complete 21 × 11 board:

- terrain,
- both orbs,
- both walls,
- units.

Orbs and walls use the same grid coordinate system as units.

The UI must render unit footprints rather than assuming that every unit
occupies exactly one cell.

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

Movement validation operates on the complete unit footprint, not only on the
unit's anchor cell. A move is valid only when all cells covered by the unit's
footprint satisfy the movement rules.

### M5 — Combat

Implement:

- selecting an enemy target,
- attack validation,
- damage calculation,
- HP changes,
- attacked-unit highlighting,
- unit death.

Combat targets are not limited to units. An orb is a valid combat target.

Destroying the opponent's orb immediately ends the battle and determines the
winner, regardless of the number or state of the remaining units.

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

The primary victory condition is destruction of the opponent's orb.

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
- Keep the domain model independent from Spring and JPA.
- Treat `GAME_DESIGN.md` as the source of truth for gameplay concepts and rules.
