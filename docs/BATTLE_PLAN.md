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

For milestones with substantial domain rules, a dedicated design contract may
also be created. The contract defines the concrete rules and acceptance
criteria for that milestone and should be kept consistent with this plan.

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

During M2, the Angular battle feature introduces a SignalStore as the
frontend state-management boundary for the battle screen. The store owns the
currently loaded `BattleState` and request lifecycle; it does not contain
battle rules.

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

M2 is a read-only rendering milestone. It does not implement selection,
movement, combat, turns, or other gameplay actions.

The intended frontend structure is:

    BattleDemoPage
        |
        v
    BattleBoard
        |
        +-- BoardGrid
        |     +-- CellComponent × 231
        |
        +-- EntityLayer
              +-- Wall visuals
              +-- Orb visuals
              +-- Unit visuals

Use one CSS Grid as the board's screen coordinate system. The board grid and
entity layer share the same board rectangle and the same domain-to-screen
coordinate mapping.

The domain coordinate system remains Cartesian with `(0,0)` at the
bottom-left. Inverting the Y axis for CSS/DOM rendering is a frontend
presentation concern.

Object rendering uses `position` as the anchor and `footprint` as relative
offsets. The UI must not assume that an object always occupies one cell.

`CellComponent` represents one terrain cell. 231 cells are intentionally
acceptable for this board size; M2 should not introduce canvas, SVG, or other
rendering infrastructure solely for premature performance optimization.

Battle state is managed by a SignalStore scoped to `BattleDemoPage`. This
allows the page and future child components around the board to consume the
same battle state without making the store a root-level singleton.

Keep terrain, structures, objectives, and units conceptually distinct even
though M2 uses a shared entity layer for their DOM rendering.

### M3 — Unit Selection

Allow selecting a unit belonging to the current player.

The selected unit is visually distinguished.

### M3.5 — Movement Test Fixture

Prepare the demo battle for movement development without implementing movement.

The fixture contains, for each player:

- one 1×1 unit,
- one horizontal 2×1 unit,
- one 2×2 unit,
- one vertical 1×3 unit.

The demo board also contains a small deterministic set of ROCK terrain cells
that can be used for future movement tests, including a compact obstacle, a
narrow passage, and a diagonal/corner configuration.

ROCK is non-traversable terrain and PLAIN is traversable terrain.

M3.5 does not implement movement, pathfinding, movement cost, turn switching,
or other M4 behaviour.

### M4 — Movement

M4 implements movement as a path-based reachability problem on the square grid.

The detailed movement rules and acceptance criteria are defined in
[`M4_DESIGN_CONTRACT.md`](./M4_DESIGN_CONTRACT.md).

At a high level, M4 introduces:

- a `MOVE_UNIT` engine command;
- remaining movement separate from the initial `moveRange` allowance;
- orthogonal movement cost `1` and diagonal movement cost `√2`;
- minimum-cost reachability/pathfinding;
- terrain, walls, orbs, and units as blocking objects for standard units;
- footprint-aware movement;
- diagonal corner blocking / no corner cutting;
- reachable-cell highlighting;
- hovered minimum-cost path preview;
- movement-cost and remaining-movement information;
- a temporary technical movement reset control.

M4 does not implement the real turn system or combat. For the demo, LEFT is
treated as the current player: LEFT units can move, while RIGHT units may be
selected and inspected but cannot be moved. Full turn ownership and legal
action rules remain an M5 responsibility.

M4 should be implemented in small, reviewable steps rather than as one large
frontend/backend change. Domain movement rules should be tested independently
from Angular.

### M5 — Turns

Implement:

- current player,
- legal actions,
- ending a turn,
- switching players.

Turn rules determine which player may currently perform gameplay actions.

### M6 — Combat

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
- possible event-sourced battle history/persistence

Event sourcing is a possible future architecture for storing battle history and
reconstructing battle state, but it is not part of M4.

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
- For milestones with a design contract, treat that contract as the source of
  truth for the milestone's concrete rules and acceptance criteria.
