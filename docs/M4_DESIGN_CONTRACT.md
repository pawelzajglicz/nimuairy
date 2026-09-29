# M4 Design Contract — Movement

## 1. Purpose and Scope

This document defines the concrete gameplay and technical contract for **M4 — Movement**.

M4 adds movement to the existing frontend battle engine. It must provide
path-based reachability, footprint-aware validation, movement execution, and
the corresponding Battle Demo interaction.

M4 is intentionally not a turn-system or combat milestone.

This document is a contract for the current milestone. It should not introduce
future mechanics merely because they may eventually be useful.

## 2. Relationship to Other Documents

- [`GAME_DESIGN.md`](./GAME_DESIGN.md) is the source of truth for general gameplay concepts.
- [`BATTLE_PLAN.md`](./BATTLE_PLAN.md) is the source of truth for milestone order and scope.
- [`M4.1_DESIGN_CONTRACT.md`](./M4.1_DESIGN_CONTRACT.md) defines the M4.1 movement-domain foundation.
- This document is the source of truth for M4's concrete movement rules and acceptance criteria.

If a conflict is found, do not silently choose an interpretation. Raise it and
update the affected documentation before implementing the conflicting rule.

## 3. Current M4 Demo Context

The demo remains intentionally simplified:

- the board is 21 × 11;
- LEFT is temporarily treated as the current player;
- LEFT units may be moved;
- RIGHT units may be selected and inspected, but cannot be moved;
- the real turn system is M5;
- combat is not implemented in M4;
- the demo contains 8 units, with one 1×1, 2×1, 2×2, and 1×3 unit for each side;
- PLAIN terrain is traversable;
- ROCK terrain is not traversable.

The temporary LEFT-player rule is a demo/testing convenience, not the final
turn model.

`currentPlayer` is part of `BattleState`, even though M4 uses a fixed LEFT value.
M5 will introduce the actual turn transitions and rules for changing it.

Because the demo API does not carry `currentPlayer` yet, the frontend mapper
(`battle-state.mapper.ts`) initializes it to `LEFT` during M4. This is a
temporary fixture default, not frontend ownership of turn state. In M5,
`currentPlayer` becomes part of the backend/API battle state and the mapper
maps it instead.

## 4. Movement Command

Movement is requested through the battle engine using a command-oriented API.
The command contains the exact path selected by the caller:

```text
engine.execute(state, {
    type: 'MOVE_UNIT',
    unitId,
    destination,
    path
})
```

The path does not contain the starting position and its final cell must equal
the requested destination.

The command therefore expresses:

> Move this unit to this destination using this exact path.

The engine remains authoritative and must validate the supplied path rather than
trusting it.

Angular components and SignalStore must not implement movement rules directly.
They may request a movement and present the engine's results.

## 5. Movement Allowance

`moveRange` represents a unit's initial movement allowance.

M4 introduces a separate remaining-movement value:

```text
remainingMovement = moveRange
```

A successful move consumes movement according to the cost of the submitted,
validated path.

`moveRange` must not be mutated as a consequence of movement.

The separation is intentional because a future turn may contain sequences such
as:

```text
MOVE → ATTACK → MOVE
```

Combat is not implemented in M4; only the movement state must support the idea
that movement can occur more than once before the turn ends.

M4 also includes a temporary technical reset action/control that restores:

```text
remainingMovement = moveRange
```

This is a development aid, not yet a gameplay action.

## 6. Grid Movement and Movement Cost

The board is a square grid with eight possible adjacent moves:

```text
↖  ↑  ↗
←  ·  →
↙  ↓  ↘
```

For the M4 MVP, movement costs are:

| Step | Cost |
|------|------|
| orthogonal | `1` |
| diagonal | `√2` |

A path's cost is the sum of the costs of its individual steps.

For example:

```text
→ → ↘
```

costs:

```text
1 + 1 + √2 ≈ 3.414
```

The authoritative concept is **per-step movement cost**, not a count of
orthogonal and diagonal steps. The current MVP happens to derive the step cost
from the step direction.

This distinction is intentional so that future terrain or movement modifiers
can change the cost of an individual step without redesigning the path model.
For example, a future terrain such as SWAMP may make entering a cell more
expensive. Such terrain movement costs are out of scope for M4, but the M4
architecture must not assume that total path cost can always be reconstructed
from only `orthogonalSteps` and `diagonalSteps`.

Movement costs are represented as `number`. Because floating-point sums of `1`
and `√2` depend on summation order, the domain never compares costs directly:

- all cost comparisons go through a single tolerance (`COST_EPSILON`) defined
  in the domain movement-cost module;
- a move is within budget when `cost <= remainingMovement + COST_EPSILON`, so
  a move that uses exactly the remaining movement is allowed;
- after a move, `remainingMovement` is clamped at `0`, so the tolerance cannot
  break the invariant `0 <= remainingMovement`;
- a path's cost is summed step by step from the start, both in pathfinding and
  in execution, so a previewed cost equals the executed cost exactly.

Future step costs must be greater than `0`; pathfinding and the simple-path
rule rely on it.

Engine outputs represent a path as engine-evaluated transitions:

```text
MovementStep { from, to, cost }
```

The movement result and the path preview therefore keep the cost of every
individual step, which remains available when future terrain makes steps cost
differently (`A --1--> B --2--> C`). Commands still carry only positions; costs
are always computed by the engine.

## 7. Reachability Is Path-Based

Movement is a reachability problem, not a straight-line distance check.

A destination is reachable when there exists a valid path from the unit's
current anchor to that destination whose total cost does not exceed the unit's
current `remainingMovement`.

The direct Euclidean distance between origin and destination is therefore not
sufficient to determine reachability.

A destination may be close to the unit but unreachable because obstacles force
the available path to be too expensive or because no valid path exists.

When multiple valid paths exist, the relevant movement cost and preview path
use the minimum-cost valid path for reachability and preview purposes.

Reachability/pathfinding and movement execution are separate responsibilities:

- **reachability/pathfinding** calculates minimum-cost paths. The movement UI
  uses them for reachable cells and path previews;
- **movement execution** validates the path selected by the caller and
  charges that path's actual cost.

When the player selects a path, `MOVE_UNIT` carries that path. Execution
accepts any valid path (see §16) whose actual cost is within
`remainingMovement`. It does not require the path to be a minimum-cost path and
does not run pathfinding to compare against one. The movement UI normally
submits a minimum-cost path taken from reachability; since both use the same
domain movement rules, such a path always passes validation.

## 8. Standard Traversability Rules

For standard units in M4:

- `PLAIN` terrain is traversable;
- `ROCK` terrain is not traversable;
- walls are blocking;
- orbs are blocking;
- other units are blocking;
- a unit cannot move onto another unit;
- a unit cannot move through another unit;
- a unit cannot move through a wall or orb.

The selected unit's own current footprint is not treated as an obstacle to
itself.

Future movement types such as ghosts, flying units, wall-jumping, or
teleportation are out of scope.

## 9. Destination Validation

For every candidate anchor position, the complete unit footprint must be valid.

A position is invalid when any footprint cell:

1. is outside the board;
2. is on non-traversable terrain;
3. overlaps a wall;
4. overlaps an orb;
5. overlaps another unit;
6. has no terrain entry.

A cell without a terrain entry is treated as non-traversable rather than
assumed to be PLAIN. The backend always provides terrain for every cell.

All footprint cells must therefore be valid simultaneously.

The anchor cell alone is never sufficient to validate a multi-cell unit.

## 10. Footprint-Aware Movement

A unit moves by translating its footprint together with its anchor position.

For example, a 2×2 unit occupies four cells at every position along its path.
It cannot temporarily shrink to 1×1 to pass through an obstacle.

A narrow passage is therefore traversable only when the entire footprint fits
through it.

This rule applies to:

- reachability;
- pathfinding;
- destination validation;
- movement execution;
- hover path preview.

There must be one domain-level rule for footprint validity rather than separate
frontend approximations.

## 11. Diagonal Movement and Corner Blocking

Diagonal movement is allowed, but the unit must not cut through a blocked
corner.

For a diagonal anchor transition from `(x,y)` to `(x+dx,y+dy)`, where both
dx and dy are non-zero, the movement must have sufficient clearance through
both corresponding orthogonal transitions as well as the diagonal destination.

Conceptually, this configuration is blocked:

```text
A #
# B
```

The unit must not move:

```text
A ↘ B
```

merely because B itself is free.

For a multi-cell footprint, the same principle applies to the entire footprint.
The unit cannot use a diagonal transition to squeeze through a corner or a gap
that its footprint cannot clear.

A practical domain interpretation is:

- validate the destination footprint;
- for a diagonal transition, also require both intermediate orthogonal anchor
  positions to be valid for the complete footprint;
- reject the diagonal transition if either intermediate position is blocked.

This intentionally uses a conservative no-corner-cutting rule and keeps the
movement behaviour deterministic.

The rule is exactly the area swept by the footprint. When a footprint slides
diagonally from `A` to `B`, each of its cells passes only through itself, its
two orthogonal neighbours in the direction of movement, and its diagonal
neighbour. The union of the footprint placed at `A`, `A + (dx, 0)`,
`A + (0, dy)`, and `B` is therefore precisely the area the unit touches during
the move. The moving unit's own current cells are not obstacles.

For a `↗` move from anchor `(x, y)`, the checked area and the cells that block
the move without being part of the start or destination footprint are:

| Footprint | Checked area | Blocking corner cells |
|---|---|---|
| 1×1 | `x..x+1 × y..y+1` | `(x+1, y)`, `(x, y+1)`: one blocked corner is enough |
| 2×1 | `x..x+2 × y..y+1` | `(x+2, y)`, `(x, y+1)` |
| 2×2 | `x..x+2 × y..y+2` | `(x+2, y)`, `(x, y+2)` |
| 1×3 | `x..x+1 × y..y+3` | `(x+1, y)`, `(x, y+3)` |

A consequence is that one-cell-wide diagonal corridors cannot be passed, and a
multi-cell unit may need two orthogonal steps where a diagonal step would clip
a corner.

## 12. Pathfinding and Reachability Algorithm

M4 needs a weighted shortest-path search because orthogonal and diagonal steps
have different costs.

The algorithm must:

- explore the eight neighboring cells;
- use step cost `1` or `√2` for the current MVP;
- obtain the cost of each transition through a domain-level movement-cost rule,
  rather than hard-coding total path cost as step counts;
- reject invalid footprint positions;
- reject blocked diagonal transitions;
- respect board boundaries;
- respect the remaining movement budget;
- retain the minimum known cost for each reachable anchor position;
- be able to reconstruct a minimum-cost path for a selected destination.

Dijkstra's algorithm is sufficient for these requirements. A* is also valid if
implemented clearly and tested equivalently, but M4 should not introduce a
more complex algorithm solely for hypothetical performance needs.

M4 uses Dijkstra's algorithm, searching from the unit's current anchor. A* is
not needed: reachability needs every reachable destination in one pass, not a
path to a single target, and the board is small.

The search must be deterministic:

- neighbours are explored in the fixed order E, N, W, S, NE, NW, SW, SE;
- among equally cheap candidates (within `COST_EPSILON`), the one discovered
  first is settled first;
- a cell's recorded path is replaced only by a strictly cheaper one, so among
  equal-cost paths the first one found wins;
- neighbours whose cost would exceed the remaining movement are never
  recorded.

Each destination therefore has one canonical minimum-cost path, and the same
state always produces the same paths.

The search should be implemented independently of Angular rendering.

## 13. Reachable Cells

When a unit is selected in MOVE mode, the engine/application layer should make
available the set of reachable destination anchor cells for that unit.

The reachable set includes the unit's current position as a valid zero-cost
state internally, but the UI does not need to present the current position as a
movement destination.

Only positions satisfying all movement rules and within the remaining movement
budget are reachable.

The reachability result maps each reachable anchor to:

- its minimum movement cost from the unit's current anchor;
- the last `MovementStep` of its canonical minimum-cost path, or none for the
  current position.

The current position is included at cost `0`. The complete path to a reachable
cell is reconstructed by following these steps back to the current position,
and is returned as `MovementStep`s.

Requesting reachability for a unit that does not belong to the current player
is rejected with `UNIT_CANNOT_MOVE`, so the UI never presents a movement range
for a unit that cannot move.

The frontend must not calculate reachability independently.

## 14. Hover Path Preview

When the pointer hovers a reachable destination:

- find the minimum-cost valid path from the selected unit's current anchor to
  that destination;
- display the path visually on the board;
- display the path's total movement cost.

The preview path is the reconstructed sequence of `MovementStep`s from the
reachability result, so per-step costs are available without recalculating
them.

The path is only a preview.

Clicking the destination executes the `MOVE_UNIT` command with the selected
path, i.e. the `to` positions of the previewed steps.

Hovering an invalid or unreachable cell must not produce a misleading valid
path. The previous preview should be cleared or replaced according to the
existing UI conventions.

## 15. Movement Information in the UI

The selected unit should expose its movement state visually.

At minimum the UI should communicate:

- initial movement allowance (`moveRange`);
- movement already spent;
- remaining movement.

A compact representation such as:

```text
Move: 3.41 / 5
```

is acceptable, provided the meaning is clear.

The unit should also have a visible movement-cost label showing movement
already spent during the current turn.

Example sequence:

```text
initial:       0
move 2 cells:  2
then diagonal: 3.41
```

The exact visual styling is an implementation detail.

## 16. Movement Execution

A successful `MOVE_UNIT` command must:

1. identify the requested unit;
2. validate that the unit may move in the current demo context;
3. validate the submitted path according to all movement rules;
4. calculate the submitted path's cost using the domain movement-cost rule;
5. reject the command if the path is invalid or exceeds remaining movement;
6. move the unit anchor to the requested destination;
7. preserve the unit footprint unchanged;
8. reduce `remainingMovement` by the validated path cost;
9. return a new immutable `BattleState` together with the executed steps
   (`MovementStep[]`) and the total cost charged.

The submitted path must end at `destination`.

An invalid command must not partially mutate the battle state.

### Path validity

A command is checked in the following order. The first failing rule determines
the returned error:

| # | Rule | Error |
|---|---|---|
| 1 | the unit exists | `UNIT_NOT_FOUND` |
| 2 | the unit belongs to `state.currentPlayer` | `UNIT_CANNOT_MOVE` |
| 3 | the path is not empty | `INVALID_PATH` / `EMPTY` |
| 4 | the last path position equals `destination` | `INVALID_PATH` / `DESTINATION_MISMATCH` |
| 5 | the unit's complete footprint is valid at `destination` (§9) | `INVALID_DESTINATION` |
| 6 | each path position has not been visited yet in this command, including the start | `INVALID_PATH` / `REVISITED` |
| 7 | each path position is one of the eight neighbours of the previous position | `INVALID_PATH` / `NOT_ADJACENT` |
| 8 | the unit's complete footprint is valid at each path position | `INVALID_PATH` / `BLOCKED` |
| 9 | each diagonal step has clearance through both orthogonal positions (§11) | `INVALID_PATH` / `CORNER_BLOCKED` |
| 10 | the path's total cost is within `remainingMovement` (§6) | `INSUFFICIENT_MOVEMENT` |

Rules 6–9 are evaluated per path position, in path order.

**Simple-path invariant.** Within a single `MOVE_UNIT` command, every path
position must be distinct and the starting position must not occur in the
path. Loops and paths returning to the start are therefore invalid. The
invariant applies to one command only: a later movement in the same turn may
enter the same cells again.

Adjacency requires each coordinate offset to be exactly `-1`, `0`, or `1`, so
positions with fractional or non-numeric coordinates are rejected as well.

Execution never requires the path to be a minimum-cost path (§7).

## 17. Repeated Movement

M4 must support more than one movement action before movement is reset.

For example, with an initial allowance of `5`:

```text
move orthogonally by 2 cells
remaining = 3

move diagonally by 1 cell
remaining ≈ 1.586
```

The second movement is evaluated from the unit's new position and against its
new remaining movement.

The movement path cost is based on the validated path for that individual move.

## 18. Current Player Restriction

M4 does not implement the full turn system.

For the demo only:

- `BattleState.currentPlayer` is `LEFT`;
- LEFT units can be moved;
- RIGHT units can be selected;
- RIGHT unit movement is rejected.

The engine must read the current player from `BattleState` rather than depending
on Angular store state or another hidden external value.

In M4 the frontend mapper initializes `currentPlayer` to `LEFT` as a temporary
fixture (§3). Once `BattleStore` holds the domain `BattleState`, it must not
keep a separate copy of the current player.

M5 will introduce the actual turn transitions and rules for changing it.

## 19. Invalid Movement

The following must be rejected:

- destination outside the board;
- destination occupied by another unit;
- destination overlapping a wall or orb;
- destination on ROCK;
- destination where any footprint cell is invalid;
- destination requiring more movement than remains;
- destination with no valid path;
- submitted path that is not valid;
- submitted path that does not end at the destination;
- diagonal movement through a blocked corner;
- movement of a RIGHT unit in the M4 demo context.

These cases map to `MovementError` as follows, with the precedence defined in
§16:

| Case | Error |
|---|---|
| destination outside the board, on another unit, overlapping a wall or orb, on ROCK, or with any invalid footprint cell | `INVALID_DESTINATION` |
| destination requiring more movement than remains | `INSUFFICIENT_MOVEMENT` |
| submitted path that is not valid | `INVALID_PATH` with the reason of the failing rule |
| submitted path that does not end at the destination | `INVALID_PATH` / `DESTINATION_MISMATCH` |
| diagonal movement through a blocked corner | `INVALID_PATH` / `CORNER_BLOCKED` |
| movement of a RIGHT unit | `UNIT_CANNOT_MOVE` |

Execution does not search for paths, so "destination with no valid path"
surfaces as an invalid submitted path (`INVALID_PATH`) or as
`INSUFFICIENT_MOVEMENT`.

Rejected movement must leave the `BattleState` unchanged.

## 20. State and Architecture

Movement rules belong in `BattleEngine` or domain-level helpers called by it.

Angular components are responsible for presentation and user interaction.

The SignalStore owns feature/application state and request lifecycle, but must
not become a second movement engine.

The domain movement implementation must not depend on:

- Angular;
- DOM APIs;
- HTTP;
- Spring;
- JPA;
- browser-specific rendering.

Prefer immutable state transitions, consistent with the existing battle
architecture.

The frontend domain model is intentionally a separate architectural boundary
from generated API DTOs. The API DTO is mapped into the framework-independent
domain model before domain logic uses it. No broad DTO/domain alignment refactor
is required as part of M4.1.

The backend and frontend models may be aligned further in a later milestone
when the authoritative battle engine moves toward the backend.

Do not introduce persistence or event sourcing in M4.

## 21. Testing Contract

Movement tests should be primarily framework-independent domain/unit tests.

At minimum, cover:

### Costs

- orthogonal step costs 1;
- diagonal step costs √2;
- multi-step costs accumulate correctly;
- movement exactly exhausting the budget is allowed, including when
  floating-point summation order makes the cost differ by rounding error;
- movement exceeding the budget is rejected;
- the executed steps carry the cost of each step and chain from the start to
  the destination.

### Paths

- shortest valid path is selected;
- obstacles can force a longer path;
- unreachable destinations are rejected;
- board boundaries are respected;
- blocked diagonal corners are rejected;
- cells without a terrain entry are not traversable;
- a valid non-minimal path is accepted and charged its actual cost;
- paths revisiting a cell or returning to the start are rejected;
- the canonical path among equal-cost paths is deterministic;
- every path produced by reachability is accepted by execution with the same
  steps and cost.

### Footprints

- 1×1 unit can use a one-cell-wide passage;
- a larger footprint cannot use a passage that is too narrow;
- 2×2 and 1×3 footprints are validated using all occupied cells;
- a footprint cannot overlap ROCK, walls, orbs, or another unit.

### State

- successful movement changes the anchor;
- successful movement deducts movement cost;
- repeated movement uses remaining movement;
- invalid movement leaves state unchanged;
- reset restores remaining movement to `moveRange`.

### Demo context

- LEFT unit can move;
- RIGHT unit cannot move;
- RIGHT unit can still be selected/inspected.

Frontend tests should verify integration and presentation rather than duplicate
pathfinding logic.

Playwright should verify the real interaction flow, including selection,
reachable-cell highlighting, hover path/cost preview, movement, and movement
information.

## 22. Scope Exclusions

The following are explicitly not part of M4:

- real turn switching;
- ending turns;
- attack implementation;
- attack range;
- damage calculation;
- victory/defeat;
- backend-authoritative battle execution;
- persistence;
- event sourcing;
- multiplayer networking;
- special movement types;
- flying/ghost/wall-jumping movement;
- terrain movement costs beyond traversable/non-traversable;
- unit rotation;
- wall slots.

## 23. Acceptance Criteria

M4 is complete when:

1. A LEFT unit can be selected and its reachable cells are derived from the
   movement engine.
2. Reachability uses path cost rather than direct origin/destination distance.
3. Orthogonal steps cost `1` and diagonal steps cost `√2` in the M4 MVP.
4. Obstacles, board boundaries, and complete unit footprints are respected.
5. Diagonal corner cutting is rejected.
6. A minimum-cost path can be reconstructed for a reachable destination.
7. Hovering a reachable destination displays its path and movement cost.
8. Clicking a reachable destination moves the unit and deducts the actual path
   cost.
9. A second movement can consume the remaining movement budget.
10. An invalid or too-expensive move leaves the battle state unchanged.
11. RIGHT units can be selected/inspected but cannot be moved in the M4 demo.
12. A temporary technical reset restores the selected unit's remaining movement
    to its initial `moveRange`.
13. The UI communicates movement already spent and remaining movement.
14. Movement rules are covered by deterministic automated tests.
15. Existing M1–M3.5 behaviour remains intact.
16. No persistence, event sourcing, or real turn system is introduced.
