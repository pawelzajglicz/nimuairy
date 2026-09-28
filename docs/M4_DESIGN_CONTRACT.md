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

## 4. Movement Command

Movement is requested through the battle engine using a command-oriented API:

```text
engine.execute(state, {
    type: 'MOVE_UNIT',
    unitId,
    destination
})
```

The exact TypeScript types and command representation should follow the
existing project conventions.

Angular components and SignalStore must not implement movement rules directly.
They may request a movement and present the engine's results.

## 5. Movement Allowance

`moveRange` represents a unit's initial movement allowance.

M4 introduces a separate remaining-movement value:

```text
remainingMovement = moveRange
```

A successful move consumes movement according to the minimum-cost valid path.

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

## 6. Grid Movement

The board is a square grid with eight possible adjacent moves:

```text
↖  ↑  ↗
←  ·  →
↙  ↓  ↘
```

Movement costs are:

| Step | Cost |
|------|------|
| orthogonal | `1` |
| diagonal | `√2` |

A multi-step path has the sum of the costs of all its steps.

For example:

```text
→ → ↘
```

costs:

```text
1 + 1 + √2 ≈ 3.414
```

The implementation should avoid unnecessary floating-point equality checks.
Use an appropriate comparison/tolerance strategy or another representation
that preserves the intended movement semantics.

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
use the minimum-cost valid path.

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
5. overlaps another unit.

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
`dx` and `dy` are non-zero, the movement must have sufficient clearance through
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

## 12. Pathfinding and Reachability Algorithm

M4 needs a weighted shortest-path search because orthogonal and diagonal steps
have different costs.

The algorithm must:

- explore the eight neighboring cells;
- use step cost `1` or `√2`;
- reject invalid footprint positions;
- reject blocked diagonal transitions;
- respect board boundaries;
- respect the remaining movement budget;
- retain the minimum known cost for each reachable anchor position;
- be able to reconstruct a minimum-cost path for a selected destination.

Dijkstra's algorithm is sufficient for these requirements. A* is also valid if
implemented clearly and tested equivalently, but M4 should not introduce a
more complex algorithm solely for hypothetical performance needs.

The search should be implemented independently of Angular rendering.

## 13. Reachable Cells

When a unit is selected in MOVE mode, the engine/application layer should make
available the set of reachable destination anchor cells for that unit.

The reachable set includes the unit's current position as a valid zero-cost
state internally, but the UI does not need to present the current position as a
movement destination.

Only positions satisfying all movement rules and within the remaining movement
budget are reachable.

The frontend must not calculate reachability independently.

## 14. Hover Path Preview

When the pointer hovers a reachable destination:

- find the minimum-cost valid path from the selected unit's current anchor to
  that destination;
- display the path visually on the board;
- display the path's total movement cost.

The path is only a preview.

Clicking the destination executes the `MOVE_UNIT` command.

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
3. calculate/retrieve the minimum-cost valid path;
4. reject the command if no valid path exists within the remaining movement;
5. move the unit anchor to the requested destination;
6. preserve the unit footprint unchanged;
7. reduce `remainingMovement` by the path cost;
8. return a new immutable `BattleState`.

An invalid command must not partially mutate the battle state.

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

The movement path cost is based on the actual minimum valid path for that
individual move.

## 18. Current Player Restriction

M4 does not implement the full turn system.

For the demo only:

- LEFT is the current player;
- LEFT units can be moved;
- RIGHT units can be selected;
- RIGHT unit movement is rejected.

The engine should keep this restriction explicit rather than pretending that
M4 already has the final turn model.

M5 will introduce the actual current-player/turn rules.

## 19. Invalid Movement

The following must be rejected:

- destination outside the board;
- destination occupied by another unit;
- destination overlapping a wall or orb;
- destination on ROCK;
- destination where any footprint cell is invalid;
- destination requiring more movement than remains;
- destination with no valid path;
- diagonal movement through a blocked corner;
- movement of a RIGHT unit in the M4 demo context.

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

Do not introduce persistence or event sourcing in M4.

## 21. Testing Contract

Movement tests should be primarily framework-independent domain/unit tests.

At minimum, cover:

### Costs

- orthogonal step costs 1;
- diagonal step costs √2;
- multi-step costs accumulate correctly;
- movement exactly exhausting the budget is allowed;
- movement exceeding the budget is rejected.

### Paths

- shortest valid path is selected;
- obstacles can force a longer path;
- unreachable destinations are rejected;
- board boundaries are respected;
- blocked diagonal corners are rejected.

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
3. Orthogonal steps cost `1` and diagonal steps cost `√2`.
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
