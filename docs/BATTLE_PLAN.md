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

- a `MOVE_UNIT` engine command that executes any valid simple path within the
  unit's remaining movement and charges that path's actual cost;
- remaining movement separate from the initial `moveRange` allowance;
- orthogonal movement cost `1` and diagonal movement cost `√2`;
- minimum-cost reachability/pathfinding for reachable cells and path previews;
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

`currentPlayer` is part of the domain `BattleState`. Because the demo API does
not carry it yet, the frontend mapper initializes it to LEFT during M4 as a
temporary fixture. This is not frontend ownership of turn state.

M4 should be implemented in small, reviewable steps rather than as one large
frontend/backend change. Domain movement rules should be tested independently
from Angular.

#### M4 steps

- **M4.1 — Movement domain foundation** (done). Movement state, command,
  result, and error contracts; see
  [`M4.1_DESIGN_CONTRACT.md`](./M4.1_DESIGN_CONTRACT.md).
- **M4.2 — Movement rules, reachability, and execution** (done). Domain only;
  no UI changes. Key decisions:
  - `currentPlayer` is added to the domain `BattleState`, with a temporary
    mapper default of LEFT;
  - one domain movement-rules module owns footprint validity, step legality
    (adjacency, obstacles, no corner cutting), and per-step movement cost;
    reachability and execution both use it;
  - movement cost stays a `number`; budget comparisons use a single
    tolerance, and remaining movement is clamped at `0`;
  - reachability uses Dijkstra from the unit's anchor, limited by its
    remaining movement, with deterministic tie-breaking; it produces
    minimum-cost paths for reachable cells and path previews;
  - execution validates the caller-selected path and charges its actual cost.
    It does not require a minimum-cost path and does not run pathfinding;
  - a path is valid for a single `MOVE_UNIT` only if it is non-empty, ends at
    the destination, is a simple path (distinct positions, start position not
    included), and every step is legal for the complete footprint;
  - commands carry the chosen cells as `readonly Position[]`; engine outputs
    (movement result and path preview) use `MovementStep { from, to, cost }`
    transitions, so per-step costs remain available for future terrain costs;
  - `INVALID_PATH` reasons become a small literal union.
- **M4.3 — Battle feature integration** (done). Connects the movement domain
  to the battle screen without re-implementing any movement rule in Angular.
  Split into three steps:
  - **M4.3.1 — Domain state in the store.** `BattleStore` holds the domain
    `BattleState` instead of the API DTO, and the board components render
    domain types. No visible change.
  - **M4.3.2 — Reachability, hover preview, and click-to-move.** Reachable
    destination highlighting, the hovered path and its cost, and moving by
    clicking a destination.
  - **M4.3.3 — Movement information and reset.** Movement information panel,
    spent-movement label on the selected unit, the last movement outcome, and
    the temporary reset control.

  Key decisions:
  - `battleState` is a linked store slice: the mapper seeds it from the HTTP
    response, and afterwards it is written only with `BattleEngine` results.
    The store keeps no separate `currentPlayer`. `loading`/`error` stay owned
    by the HTTP resource. A new response re-seeds the state, so a reload
    restarts the battle from server state; M4.3 has no reload path;
  - reachable destinations and the path preview are derived from
    `BattleEngine.reachability` and `pathTo`, never stored. Reachability is
    requested only for the selected unit in MOVE mode. The hovered destination
    is store state, because the movement information panel needs the preview
    too;
  - RIGHT units can be selected but show no movement range, because the
    engine rejects their reachability with `UNIT_CANNOT_MOVE`;
  - movement targets are destination anchors rendered by a separate movement
    overlay layer above the terrain and unit layers. Each board layer is its
    own stacking context, so a target that overlaps the moving unit's own
    current cells stays clickable and hoverable. Wherever there is no target,
    cells and units keep their existing interaction;
  - clicking a destination submits `MOVE_UNIT` with the `to` positions of the
    previewed steps, so the executed path is exactly the displayed one;
  - the temporary reset is `BattleEngine.resetMovement`, a technical
    transition for development and manual testing only;
  - movement feedback is a single technical line, not a battle log:
    `lastOutcome` is one global, replace-only slot holding the most recent
    move or reset attempt of any unit. It is kept across selection and mode
    changes and replaced only by the next attempt; there is no history and no
    per-unit record.

### M5 — Turns

Implement:

- current player,
- legal actions,
- ending a turn,
- switching players.

Turn rules determine which player may currently perform gameplay actions.

`currentPlayer` becomes part of the backend/API battle state: the Java
`BattleState`, `BattleStateResponse`, the OpenAPI contract, and the regenerated
client. The frontend mapper then maps it instead of defaulting to LEFT.

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
