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

Status:

- M1–M6 — done
- **M7 — Combat / Attacks — next**
- M8 — Victory — planned
- M9 — Refactoring — planned

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

> **Later change:** the vertical 1×3 unit was replaced by a three-cell L-shaped
> unit, because a 1×3 footprint could not get past the demo ROCK layout to the
> other side of the board. The LEFT and RIGHT L-shapes are horizontal mirror
> images of each other.

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
- reachability as an inspection query based on the unit's current
  `remainingMovement`, independent of whether the unit is currently allowed
  to execute a move;
- terrain, walls, orbs, and units as blocking objects for standard units;
- footprint-aware movement;
- diagonal corner blocking / no corner cutting;
- reachable-cell highlighting;
- hovered minimum-cost path preview;
- movement-cost and remaining-movement information;
- a temporary technical movement reset control *(superseded by M5.5: removed
  and replaced by the END TURN control)*.

> *Superseded by M6:* `moveRange` and `remainingMovement` are replaced by
> `actionPointBudget` and `remainingActionPoints`; movement then spends Action
> Points.

M4 does not implement the real turn system or combat. For the demo, LEFT is
treated as the current player: LEFT units can move, while RIGHT units may be
selected and inspected, including their movement reachability, but movement
execution for RIGHT units is rejected. Full turn ownership and legal action
rules remain an M5 responsibility.

`currentPlayer` is part of the domain `BattleState`. Because the demo API does
not carry it yet, the frontend mapper initializes it to LEFT during M4 as a
temporary fixture. This is not frontend ownership of turn state.

> *Superseded by M5:* M5.1 delivers `currentPlayer` from the backend/API, and
> the mapper no longer defaults it to LEFT. Since M5.3, `END_TURN` hands the
> turn to RIGHT, so RIGHT units can move during RIGHT's turn.

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
    mapper default of LEFT *(superseded by M5.1: read from the API)*;
  - one domain movement-rules module owns footprint validity, step legality
    (adjacency, obstacles, no corner cutting), and per-step movement cost;
    reachability and execution both use it;
  - movement cost stays a `number`; budget comparisons use a single
    tolerance, and remaining movement is clamped at `0`;
  - reachability uses Dijkstra from the unit's anchor, limited by its
    remaining movement, with deterministic tie-breaking; it produces
    minimum-cost paths for reachable cells and path previews;
  - reachability is an inspection query and does not enforce `currentPlayer`;
    execution remains responsible for checking whether the unit may actually
    move;
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
    the temporary reset control *(the reset is superseded by M5.5)*.

  Key decisions:
  - `battleState` is a linked store slice: the mapper seeds it from the HTTP
    response, and afterwards it is written only with `BattleEngine` results.
    The store keeps no separate `currentPlayer`. `loading`/`error` stay
    owned by the HTTP resource. A new response re-seeds the state, so a reload
    restarts the battle from server state; M4.3 has no reload path;
  - reachable destinations and the path preview are derived from
    `BattleEngine.reachability` and `pathTo`, never stored. Reachability is
    requested only for the selected unit in MOVE mode. The hovered destination
    is store state, because the movement information panel needs the preview
    too;
  - reachability is available for selected units regardless of
    `currentPlayer`. RIGHT units can be selected and inspected; their
    reachable cells are calculated from their current `remainingMovement`,
    while movement execution is rejected with `UNIT_CANNOT_MOVE` because
    RIGHT is not the current player;
  - movement targets are destination anchors rendered by a separate movement
    overlay layer above the terrain and unit layers. Each board layer is its
    own stacking context, so a target that overlaps the moving unit's own
    current cells stays clickable and hoverable. Wherever there is no target,
    cells and units keep their existing interaction;
  - clicking a destination submits `MOVE_UNIT` with the `to` positions of
    the previewed steps, so the executed path is exactly the displayed one;
  - the temporary reset is `BattleEngine.resetMovement`, a technical
    transition for development and manual testing only *(superseded by M5.5:
    `resetMovement` is removed, and `END_TURN` restores movement at turn
    start)*;
  - movement feedback is a single technical line, not a battle log:
    `lastOutcome` is one global, replace-only slot holding the most recent
    move or reset attempt of any unit. It is kept across selection and mode
    changes and replaced only by the next attempt; there is no history and no
    per-unit record. *(Since M5.5 it records move attempts only, because the
    reset is gone.)*

### M5 — Turns

M5 implements the first real turn system.

The concrete M5 gameplay and technical rules are defined in
[`M5_DESIGN_CONTRACT.md`](./M5_DESIGN_CONTRACT.md).

Turn model:

- exactly one unit may act during a turn;
- the active unit may perform multiple actions during that turn;
- `END_TURN` is the only action that ends the turn;
- exhausting `remainingMovement` does not end the turn;
- a turn may be ended while movement remains;
- turn ownership is defined by `BattleState.currentPlayer`;
- only the current player's unit may perform gameplay actions;
- at the start of a player's new turn, every unit owned by that player has
  `remainingMovement` restored to `moveRange`;
- movement restoration happens at turn start, not while ending the previous turn.

> *Superseded by M6:* turn-start restoration of `remainingMovement = moveRange`
> becomes `remainingActionPoints = actionPointBudget`. The turn model itself is
> unchanged.

M5 scope:

- `currentPlayer` becomes part of the backend/API battle state:
  Java `BattleState`, `BattleStateResponse`, OpenAPI, and regenerated
  Angular client;
- legal-action representation is prepared so future actions can be added
  without introducing combat in M5;
- `END_TURN` is implemented as the sole turn-ending gameplay action;
- switching players is implemented in the domain engine;
- the temporary development-only movement reset is removed/replaced by the
  real turn lifecycle;
- the Angular battle feature exposes a player-facing end-turn control;
- M5 remains frontend-engine based; it does not move authoritative battle
  execution to the backend.

M5 steps:

- **M5.1 — Current player and API contract** (done). Add `currentPlayer` to backend
  battle state and response, update OpenAPI, regenerate the Angular client,
  and map the value into the domain state instead of defaulting to LEFT.
- **M5.2 — Legal actions** (done). Introduce the domain representation needed to
  determine which gameplay actions are legal for the current turn. Include
  `MOVE` and `END_TURN`; keep the model open to future actions such as
  `ATTACK` without implementing them in M5.
- **M5.2.5 — Active unit claiming** (done). Connect `activeUnitId` to movement
  execution. A successful `MOVE_UNIT` claims the turn by setting
  `activeUnitId` to the moved unit; a failed move leaves the state unchanged
  and does not claim the turn. Once the turn is claimed, `MOVE_UNIT` for any
  other unit is rejected with the existing `UNIT_CANNOT_MOVE` error. Execution
  and the legal-action queries use one shared domain rule for whether a unit
  may act, so an action reported as legal is never rejected for turn-ownership
  reasons. The temporary `resetMovement` is not a gameplay action and does not
  claim the turn *(superseded by M5.5: `resetMovement` is removed)*. Clearing
  `activeUnitId` belongs to `END_TURN` in M5.3.
- **M5.3 — End turn and player switching** (done). Add `END_TURN` to the
  engine. It switches `currentPlayer`, clears `activeUnitId`, and returns a
  new immutable `BattleState`. It does not restore movement; that is M5.4.
- **M5.4 — Turn-start movement restoration** (done). When `END_TURN` switches to the
  next player, restore `remainingMovement = moveRange` for all units owned
  by that newly active player. Do not reset movement for the player whose turn
  just ended.
- **M5.5 — Battle feature integration** (done). The battle screen shows the
  current player and offers a player-facing END TURN control, which applies
  `BattleEngine.endTurn()` and stores the returned `BattleState`. Switching
  the player and restoring movement stay domain responsibilities; the store
  and components do neither. The temporary `resetMovement` is removed from
  both the UI and the engine, since `END_TURN` now restores movement. Keep
  action legality and state transitions in the domain engine.

  UI decisions:
  - END TURN clears the UI state of the turn that ended (`selectedUnitId` and
    `hoveredDestination`) and keeps `interactionMode` and `lastOutcome`;
  - END TURN is always enabled, because `END_TURN` is always legal;
  - the active unit has no separate indicator yet. The UI shows the current
    player, and the domain enforces the active unit;
  - any unit, including friendly units other than the active one and the
    opponent's units, can still be selected and inspected, with movement
    reachability. Only the engine decides whether it may act, and it rejects
    a move by any other unit with `UNIT_CANNOT_MOVE`.
- **M5.6 — Verification and documentation** (done). Verify the implementation
  against the acceptance criteria in `M5_DESIGN_CONTRACT.md`, close any
  remaining gaps in the unit, integration, and Playwright tests required by
  its testing contract, and complete the M5 design/acceptance documentation.

### M6 — Action Points

M6 introduces Action Points (AP): one shared, integer resource that all
actions of a unit draw from. MOVE is its first user; ATTACK, ABILITY and other
future actions will use the same resource. The rules are defined in
[`GAME_DESIGN.md`](./GAME_DESIGN.md) §2.4 (Action Points) and §8.2 (Movement
cost).

At a high level:

- each unit has `actionPointBudget`, its AP for one turn;
- each unit has `remainingActionPoints`, its current AP in battle state;
- `moveRange` is removed from the gameplay model; `remainingMovement` is
  replaced by `remainingActionPoints`;
- MOVE costs `ceil(sum of movementCostFactor × stepCost × terrainCost)` for the
  whole path, with `stepCost` `1` orthogonal / `√2` diagonal and
  `terrainCost = 1` for all current terrain;
- reachability and the path preview are limited by `remainingActionPoints`;
- `END_TURN` costs no AP and is always possible, also at `0 AP`;
- `0 AP` does not end the turn automatically;
- the active unit is still `activeUnitId`, as in M5;
- at the start of a player's turn, all of that player's units restore
  `remainingActionPoints = actionPointBudget`.

M6 scope:

- domain model and engine: AP state, movement cost in AP, turn-start
  restoration;
- backend/API: unit statistics (`actionPointBudget`, `movementCostFactor`)
  replace `moveRange`; update OpenAPI and regenerate the Angular client;
- battle UI shows AP instead of movement.

M6 does not design ATTACK or ABILITY, and does not introduce terrain with a
cost other than `1`. The concrete M6 rules and acceptance criteria are defined
in [`M6_DESIGN_CONTRACT.md`](./M6_DESIGN_CONTRACT.md).

#### M6 steps

- **M6.1 — AP cost functions** (done). Pure domain functions in
  `movement-cost.ts`, not yet wired: the step cost includes
  `movementCostFactor`, and `actionPointCost` converts a fractional path cost
  into integer AP as `ceil(pathCost - COST_EPSILON)`, returning `0` rather
  than `-0`.
- **M6.2 — AP model end to end** (done). Java `Unit`/`UnitDto`, demo values,
  OpenAPI and the regenerated client, mapper, domain `Unit`, engine, error
  rename, fixtures, and the minimal component updates needed to compile. One
  step, because removing `moveRange` from the API breaks the mapper. Key
  decisions:
  - the unit-statistic invariants are validated in both places: the Java
    `Unit` compact constructor, where battle state originates, and the
    frontend mapper, which the frontend engine relies on;
  - `ReachableCell` keeps its fractional `cost` as the search key and gains an
    integer `actionPointCost`; the path preview shows the AP cost;
  - reachability still prunes with `isWithinBudget` on the fractional cost,
    while execution compares integer AP (`actionPointCost(cost) <=
    remainingActionPoints`). For an integer AP budget, the fractional
    reachability check and the rounded execution check admit the same
    destinations. The charged AP and the remaining AP are integers, so the
    `Math.max(0, …)` clamp is gone;
  - `remainingActionPoints` and `activeUnitId` stay out of the API, and a
    loaded battle starts with full AP.
- **M6.3 — AP presentation** (done). The battle UI shows AP instead of
  movement. UI decisions:
  - wording "cost N AP": the panel shows `AP spent x / y · remaining z`, and
    the preview, last move, insufficient-AP error and target labels show
    integer AP costs;
  - target labels read `ReachableCell.actionPointCost`; AP are integers, so
    no decimal formatting is applied;
  - component names, CSS classes and the movement panel's label are kept;
  - END TURN stays always enabled, including at 0 AP.
- **M6.4 — Verification and documentation** (done). Verify the
  implementation against the acceptance criteria in `M6_DESIGN_CONTRACT.md`,
  close the remaining test gaps, and record the M6 steps.

### M7 — Combat / Attacks

Combat uses the AP system from M6: an attack spends the attacking unit's
`remainingActionPoints`. The AP cost of attacks is defined in M7.

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

### M8 — Victory

Implement:

- victory detection,
- defeat state,
- victory screen,
- attacked/dead unit handling.

The primary victory condition is destruction of the opponent's orb.

### M9 — Refactoring

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
