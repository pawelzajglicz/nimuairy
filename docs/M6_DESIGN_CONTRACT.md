# M6 Design Contract — Action Points

## 1. Purpose

This document defines the concrete gameplay and technical contract for
M6 — Action Points.

M6 replaces the movement resource of M4/M5 (`moveRange` / `remainingMovement`)
with Action Points (AP): one shared, integer, per-turn resource that every
gameplay action of a unit draws from. MOVE is the first and, in M6, the only
action that spends AP.

GAME_DESIGN.md is the source of truth for gameplay concepts.
BATTLE_PLAN.md is the source of truth for milestone order and scope.
This document is the source of truth for M6-specific rules and acceptance
criteria.

## 2. Scope

M6 includes:

- the unit statistics `actionPointBudget` and `movementCostFactor`;
- the per-unit battle state `remainingActionPoints`;
- turn-start AP restoration;
- MOVE cost in AP (§8), reachability limited by AP (§9), atomic AP deduction
  (§10);
- removal of `moveRange` and `remainingMovement` (§14);
- backend model, DTO, OpenAPI and regenerated Angular client (§11);
- presenting AP instead of movement in the battle UI (§13).

M6 keeps unchanged:

- the M5 turn model: `currentPlayer`, `activeUnitId`, `END_TURN`;
- the M4 movement rules: footprints, obstacles, corner blocking,
  simple-path validation, deterministic canonical paths.

See §17 for what M6 does not do.

## 3. Terminology

| Term | Kind | Meaning |
|---|---|---|
| Action Points (AP) | concept | integer per-turn resource shared by all unit actions |
| `actionPointBudget` | unit statistic | AP a unit has at the start of each of its owner's turns |
| `movementCostFactor` | unit statistic | per-unit multiplier of every movement step's cost |
| `remainingActionPoints` | battle state, per unit | AP the unit has left in the current turn |
| `activeUnitId` | battle state | unit that has claimed the current turn (M5) |
| `selectedUnitId` | UI state | unit chosen for display or inspection (M5) |
| step cost | domain value, fractional | `movementCostFactor × stepCost × terrainCost` of one step |
| path cost | domain value, fractional | sum of the step costs of a path |
| MOVE AP cost | domain value, integer | `ceil` of the path cost (§8) |

The name `movementCostFactor` is final.

## 4. Action Point model

- AP are integers. Fractional values exist only while calculating a MOVE cost
  (§8).
- AP are a single resource per unit. ATTACK, ABILITY and other future actions
  will spend the same `remainingActionPoints`; M6 does not add separate
  per-action allowances.
- `END_TURN` costs 0 AP, is always legal, and is legal at
  `remainingActionPoints = 0`.
- `remainingActionPoints = 0` never ends the turn automatically.
- AP are restored at the start of the owner's turn (§7), never on turn end.

## 5. Unit statistics

Every unit has, in the backend model, the API and the frontend domain model:

| Field | Type | Invariant |
|---|---|---|
| `actionPointBudget` | integer | `> 0` |
| `movementCostFactor` | integer | `> 0` |

Both are statistics: they are read, never changed by any M6 transition.

They replace `moveRange` (§14). The other unit fields (`id`, `owner`,
`unitType`, `position`, `footprint`, `health`, `attack`, `defense`) are
unchanged.

Both invariants are mandatory design invariants: a unit with a non-positive
or non-integer value is invalid battle state and must not be accepted. (A
factor of 0 would also make steps free and break Dijkstra's positive-cost
assumption, documented in `movement-cost.ts`.) Only the exact validation
boundary is decided during implementation (§18.1), without weakening the
invariants.

Demo units (`BattleService.unit(...)`), all eight:

    actionPointBudget = 3
    movementCostFactor = 1

They replace today's `moveRange = 3`. With factor 1 and an integer budget of
3, each demo unit reaches exactly the cells it reaches today
(`ceil(c) <= 3 ⇔ c <= 3`); only the charged amounts become integer AP.

## 6. Runtime state

The frontend domain `Unit` (`frontend/src/app/battle/domain/battle-state.ts`)
gets:

    readonly remainingActionPoints: number;

Invariant: integer, `remainingActionPoints >= 0`. (It also never exceeds
`actionPointBudget`, as a consequence of the rules rather than an extra rule:
MOVE only decreases it and restoration sets it to the budget.)

`remainingActionPoints` is runtime/domain state, exactly like `activeUnitId`
in M5:

- it is not part of the Java `BattleState`/`Unit`, `UnitDto`, OpenAPI or the
  generated client;
- the mapper (`battle/battle-state.mapper.ts`) initialises it as
  `remainingActionPoints = actionPointBudget` for every unit, as it does today
  with `remainingMovement = moveRange`. A loaded battle therefore starts with
  full AP for both players, and the current turn unclaimed.

It is stored rather than derived from history so a turn can contain several
actions (existing rationale of `remainingMovement`, kept).

## 7. Turn interaction

The M5 turn model is unchanged; only the restored resource changes.

`BattleEngine.endTurn(state)`:

1. switches `currentPlayer` to the opponent;
2. clears `activeUnitId`;
3. sets `remainingActionPoints = actionPointBudget` for every unit owned by
   the new `currentPlayer`;
4. leaves the units of the player whose turn ended unchanged (they keep
   partially spent AP until their owner's next turn);
5. returns a new state; the input state is not mutated; units whose AP do
   not change keep their object identity (existing behaviour).

`END_TURN` is legal with any AP, including 0, and before any unit acted.

`activeUnitId` (M5, unchanged):

- `undefined` at turn start;
- set by the turn's first successful MOVE;
- a failed MOVE (including one rejected for insufficient AP) does not set it;
- once set, only that unit may act; others get `UNIT_CANNOT_MOVE`;
- a unit at 0 AP keeps the claim: no other unit may act until `END_TURN`.

## 8. MOVE cost calculation

The AP cost of one MOVE is calculated once for its whole path:

    movementCost = ceil( Σ over all steps:
                         movementCostFactor × stepCost × terrainCost )

M6 values:

- orthogonal step: `stepCost = 1`;
- diagonal step: `stepCost = √2` (`Math.SQRT2`);
- `terrainCost = 1` for every traversable terrain (today only `PLAIN`;
  `ROCK` is not traversable).

Rules:

- each step's cost is `movementCostFactor × stepCost × terrainCost` and stays
  fractional (`MovementStep.cost`);
- the path cost is the sum of the step costs and stays fractional;
- `ceil` is applied exactly once, to the whole path cost of one MOVE — never
  per step, never per prefix;
- the result is an integer and is the AP charged.

Required examples:

| factor | path | AP |
|---|---|---|
| 1 | 1 orthogonal | 1 |
| 1 | 1 diagonal | `ceil(√2)` = 2 |
| 1 | 2 diagonal | `ceil(2√2)` = 3 |
| 3 | 1 orthogonal | 3 |
| 3 | 1 diagonal | `ceil(3√2)` = 5 |

Consequence (intended): two MOVEs can cost more than one MOVE along the same
cells, e.g. factor 1, two diagonals: one MOVE = 3 AP, two MOVEs = 2 + 2 = 4 AP.
M6 adds no mechanism to compensate for this.

### 8.1 Where the cost is calculated

`domain/movement-cost.ts` stays the single place that decides why a step
costs what it does (its existing contract). In M6:

- the per-step cost includes `movementCostFactor`. The unit is available in
  `movementRules(state, unit)` (`domain/movement-rules.ts`), which builds
  every `MovementStep` today via `stepCost(from, to)`; the factor is passed
  from there;
- `terrainCost` is not introduced as code in M6: it is `1` for all current
  terrain, so it is a documented identity factor. A future terrain cost is
  added in `movement-cost.ts` without changing the AP model;
- one domain function converts a fractional path cost into AP (`ceil` with
  the tolerance of §8.2). Every place that needs a MOVE's AP cost uses it;
  no other code calls `Math.ceil` on movement costs.

### 8.2 Floating point (`COST_EPSILON`)

Existing mechanism (`domain/movement-cost.ts`):

- `COST_EPSILON = 1e-9` — tolerance for every movement-cost comparison,
  because sums of `1` and `√2` differ by ~1e-15 depending on summation order;
- `isCheaper(cost, than)`: `cost < than - COST_EPSILON` (Dijkstra ordering and
  canonical-path tie-breaking);
- `isWithinBudget(cost, budget)`: `cost <= budget + COST_EPSILON`
  (reachability pruning in `pathfinding.ts`, execution check in
  `battle-engine.ts`);
- execution clamps `remainingMovement` at 0 because the tolerance can accept
  a cost marginally above the budget.

M6 reuses this mechanism; it introduces no new tolerance strategy:

- the AP conversion is `ceil(pathCost - COST_EPSILON)`. A path cost that
  exceeds an integer only by rounding error therefore does not round up to
  the next AP;
- for an integer `remainingActionPoints`,
  `ceil(pathCost - COST_EPSILON) <= remainingActionPoints` is mathematically
  equivalent to the existing `isWithinBudget(pathCost, remainingActionPoints)`.
  Reachability pruning and the execution check must stay consistent with
  each other (one rule for both, as in M4); tests pin the boundary;
- `isCheaper` and Dijkstra keep working on fractional path costs.

Implementation points (to resolve in the implementation step, without
changing the semantics above):

- the conversion of a zero cost must return `0`, not `-0`
  (`Math.ceil(-1e-9) === -0`; Vitest `toBe(0)` fails on `-0`). Only the
  origin has cost 0, but the function must still be correct;
- since the charged AP and `remainingActionPoints` are integers, the result
  of the deduction is exact; the `Math.max(0, …)` clamp in `execute` and its
  comment become unnecessary or must be re-justified;
- the `COST_EPSILON` comment ("sums of 1 and √2") must be updated to cover
  the factor-weighted step costs. Path costs grow by the factor (at most the
  low hundreds on this board), so rounding error stays around 1e-13, still
  far below `COST_EPSILON`, while genuinely different costs still differ by
  far more than it.

## 9. Pathfinding and reachability

### 9.1 Current state

- `domain/pathfinding.ts` `findReachable(rules, origin, budget)`: Dijkstra
  over anchors with a linear-scan priority, fixed neighbour order (E, N, W,
  S, then diagonals) and first-found tie-breaking. It returns a shortest-path
  tree (`Reachability.cells`: `ReachableCell { position, cost, via }`) where
  `cost` is the minimum fractional path cost. It never records a cell whose
  cost fails `isWithinBudget(cost, budget)`.
- `pathTo(reachability, destination)` rebuilds the canonical minimum-cost
  path.
- Step legality and step cost come from `movementRules` (`movement-rules.ts`).
- `BattleEngine.reachability(state, unitId)` calls `findReachable` with
  `unit.remainingMovement`; it is an inspection query that does not check
  `currentPlayer`.
- `canMoveAnywhere` (in `battle-engine.ts`) runs the same search to decide
  whether MOVE is a legal action.
- The store (`battle/battle.store.ts`) derives `reachableDestinations` and
  `movementPreview` (`battle/movement-preview.ts`, `toMovementPreview`) from
  `BattleEngine.reachability`; clicking a destination submits exactly the
  previewed path.

So pathfinding already uses the cheapest legal path; M6 changes the cost and
the budget, not the algorithm.

### 9.2 M6 rules

- The cost of a destination is the AP cost (§8) of the cheapest legal path to
  it.
- A destination is reachable iff that AP cost `<= remainingActionPoints`.
- Dijkstra keeps minimising the fractional path cost. Because `ceil` is
  monotonic, the path with minimum fractional cost also has minimum AP cost,
  so the canonical path is a cheapest path in AP too. Search must not apply
  `ceil` to prefixes (that would charge rounding per step).
- The budget passed to the search is `remainingActionPoints`.
- Reachability stays an inspection query for any unit (including the
  opponent's), limited by that unit's current `remainingActionPoints`.
- MOVE is a legal action for a unit iff the unit may act (M5) and at least
  one destination other than its anchor is reachable. A unit with 0 AP, with
  fewer AP than its cheapest step, or boxed in has no MOVE (the existing
  `canMoveAnywhere` approach is kept; its comment example `5 - 3√2` must be
  updated, e.g. 1 AP left with `movementCostFactor = 2`).

### 9.3 Required changes (implementation, not now)

- `movement-rules.ts`: step cost includes the unit's `movementCostFactor`.
- `battle-engine.ts`: `reachability` and `canMoveAnywhere` pass
  `remainingActionPoints` as the budget.
- `ReachableCell` keeps its fractional `cost` (the search key) and gains an
  integer AP cost field, so the UI displays the AP cost without calculating
  it. The field name is chosen in the implementation step.
- `MovementPreview.cost` (`toMovementPreview`) becomes the AP cost of the
  previewed path.
- The algorithm, neighbour order and tie-breaking of `findReachable` and
  `pathTo` are not changed.

## 10. MOVE execution and atomicity

`BattleEngine.execute(state, MoveUnitCommand)` keeps its M4/M5 validation
order and rules:

1. unit exists (`UNIT_NOT_FOUND`);
2. unit may act — owner is `currentPlayer`, turn unclaimed or claimed by it
   (`UNIT_CANNOT_MOVE`);
3. path non-empty and ending at the destination (`INVALID_PATH`);
4. destination occupiable (`INVALID_DESTINATION`);
5. path is a legal simple path (`walkPath`; `INVALID_PATH`);
6. AP cost of the submitted path `<= remainingActionPoints`
   (`INSUFFICIENT_ACTION_POINTS`, §10.1).

Execution validates the caller-submitted path and charges that path's AP
cost. As in M4, it does not run pathfinding and does not reject a legal
submitted path for being more expensive than the cheapest one; it charges the
path actually submitted. The UI always submits the canonical cheapest path
from reachability, so for UI moves the executed cost equals the previewed
cost.

Atomicity:

- on success, one new state contains all of: the new `position`,
  `remainingActionPoints - movementCost`, and `activeUnitId = unit.id`;
- on any failure, `execute` returns an error and the caller keeps the input
  state: position, `remainingActionPoints` and `activeUnitId` are unchanged;
- there is no partial move: a path whose full AP cost exceeds
  `remainingActionPoints` is rejected as a whole; the unit does not move
  along an affordable prefix;
- the input state is never mutated; only the moved unit gets a new object.

`MovementResult.cost` is the integer AP charged. `MovementResult.steps` keeps
the fractional per-step costs.

A unit may perform several MOVEs in a turn while it has enough AP; each MOVE
is costed (and rounded) on its own.

### 10.1 Insufficient AP error

`INSUFFICIENT_MOVEMENT { required, available }` is replaced by:

    { type: 'INSUFFICIENT_ACTION_POINTS'; required: number; available: number }

`required` is the integer AP cost of the submitted path; `available` is
`remainingActionPoints`. All other `MovementError` variants are unchanged.

## 11. API / OpenAPI impact

The OpenAPI spec is generated by springdoc from the Java records at
`/v3/api-docs`; there is no committed spec file. Orval
(`frontend/orval.config.ts`, `npm run api:generate`) reads it from the running
backend (`dev` profile, port 8000) and writes
`frontend/src/app/api/generated/` (with `clean: true`).

Changes:

| Element | Change |
|---|---|
| `battle/Unit.java` (record) | `int moveRange` → `int actionPointBudget`, `int movementCostFactor` |
| `dto/UnitDto.java` | same fields; `from(Unit)` maps them |
| `service/BattleService.java` | demo units: `actionPointBudget = 3`, `movementCostFactor = 1` (§5) |
| OpenAPI `UnitDto` schema | `moveRange` removed; `actionPointBudget`, `movementCostFactor` (integer, int32) added — follows from the records |
| generated `model/unitDto.ts` | regenerated, never edited by hand |
| `BattleState.java` / `BattleStateResponse` | unchanged |

Not added to Java, DTOs or OpenAPI: `remainingActionPoints`, `activeUnitId`.

No database or Liquibase change: battle state is not persisted, and the
persisted `Character` has no movement fields.

Per CLAUDE.md, the backend DTO change, the regenerated client and the
frontend mapper change land in the same commit.

Known regeneration gotcha (from the OpenAPI cleanup after M5): springdoc's
`Page`/`Pageable` field order can vary between backend runs, so Orval may
reorder `pageCharacterResponse.ts` / `pageableObject.ts`. Such unrelated
diffs are reverted, not committed.

## 12. Frontend / SignalStore impact

Domain (`frontend/src/app/battle/domain/`):

- `battle-state.ts`: `Unit` replaces `moveRange`, `remainingMovement` with
  `actionPointBudget`, `movementCostFactor`, `remainingActionPoints`; header
  and field comments updated;
- `movement-cost.ts`: factor-weighted step cost, AP conversion (§8);
- `movement-rules.ts`: passes the unit's factor into step costs;
- `pathfinding.ts`: algorithm unchanged; budget is AP;
- `movement.ts`: AP cost field on `ReachableCell` (§9.3);
  `INSUFFICIENT_ACTION_POINTS` (§10.1); `MovementResult.cost` is AP;
- `battle-engine.ts`: `execute`, `endTurn`, `reachability`,
  `canMoveAnywhere` use AP;
- `testing/battle-fixtures.ts`: `testUnit()` defaults use the new fields.

Mapper (`battle/battle-state.mapper.ts`): reads `actionPointBudget` and
`movementCostFactor` with the existing fail-fast `required(...)`; sets
`remainingActionPoints = actionPointBudget`; no longer reads `moveRange`.

SignalStore (`battle/battle.store.ts`):

- remains the state-management boundary; gains no battle rule;
- reachability and preview stay derived from `BattleEngine.reachability`;
  `moveSelectedUnit` still submits exactly the previewed path and stores
  `execute` results; `endTurn` still stores `BattleEngine.endTurn`;
- no new store state is needed for AP: AP live in `battleState`;
- `lastOutcome` keeps the charged AP from `MovementResult.cost`;
- internal names such as `_movementRange` are not renamed in M6 (no
  refactoring beyond the AP change).

`movement-outcome.ts` / `movement-preview.ts`: types follow the domain
(`cost` = AP), no logic of their own.

## 13. UI requirements

The UI replaces the movement resource with AP. Every number shown comes from
the domain; components only format it.

- Selected unit (`components/movement-info`): shows AP — spent
  (`actionPointBudget - remainingActionPoints`, display arithmetic only),
  `actionPointBudget` and `remainingActionPoints`, labelled as AP instead of
  "Move … remaining …".
- Spent label on the unit's anchor (`components/movement-overlay`,
  `spentLabel`): spent AP.
- Reachable destinations: only cells whose cheapest-path AP cost
  `<= remainingActionPoints` are offered (from reachability). Each target's
  accessible name and the hover preview show the integer AP cost.
- Preview and last-move line show integer AP. AP values are integers, so no
  fractional formatting is needed for them.
- A unit at 0 AP (or that cannot afford any step) has no destinations; a
  MOVE whose full cost exceeds the remaining AP cannot be submitted from the
  UI because the UI only offers reachable destinations. The engine still
  rejects such a MOVE if submitted.
- Rejected moves are shown via the existing `lastOutcome` line with the
  insufficient-AP error (required/available as integers).
- END TURN stays always enabled, including at 0 AP.
- The UI decides no legality and calculates no cost; the domain engine is the
  source of truth.
- No new UI elements beyond replacing movement information with AP. Component
  names (`MovementInfoComponent`, `MovementOverlayComponent`) are kept.

## 14. Removal of `moveRange` / `remainingMovement`

After M6, `moveRange` and `remainingMovement` do not exist in the active
model:

- not in Java `Unit`, `UnitDto`, OpenAPI or the generated client;
- not in the frontend domain, mapper, store, components or templates;
- not in test fixtures: `testUnit()`, unit/component specs, Playwright
  mocked API responses (`e2e/battle-board.spec.ts`, `e2e/movement.spec.ts`,
  `e2e/unit-selection.spec.ts`), `BattleServiceTest`, `BattleControllerTest`;
- `INSUFFICIENT_MOVEMENT` is replaced by `INSUFFICIENT_ACTION_POINTS`
  (§10.1).

No compatibility alias or fallback mapping from `moveRange` is kept.

Historical docs (M1, M4, M4.1, M5 contracts) keep `moveRange` as history;
they are not rewritten (GAME_DESIGN.md / BATTLE_PLAN.md already carry
"superseded by M6" notes).

A repository search for `moveRange|remainingMovement` outside `docs/` and
outside historical text returns no results.

## 15. Acceptance criteria

M6 is complete when:

Statistics and state
1. Every unit has integer `actionPointBudget > 0`.
2. Every unit has integer `movementCostFactor > 0`.
3. `remainingActionPoints` is an integer `>= 0` after every transition.
4. A loaded battle starts with `remainingActionPoints = actionPointBudget` for
   every unit.
5. A unit with `actionPointBudget <= 0` or `movementCostFactor <= 0` is
   rejected as invalid battle state.
6. The demo battle's units have `actionPointBudget = 3` and
   `movementCostFactor = 1`.

Turns
7. `END_TURN` restores `remainingActionPoints = actionPointBudget` for every
   unit of the new current player.
8. Units of the player whose turn ended keep their AP until their owner's
   next turn.
9. `END_TURN` is legal and succeeds at `remainingActionPoints = 0`.
10. `remainingActionPoints = 0` does not end the turn; `currentPlayer`
    changes only through `END_TURN`.
11. `activeUnitId` behaves as in M5: unset at turn start, set by the first
    successful MOVE, not set by a failed MOVE (including insufficient AP),
    cleared by `END_TURN`; another unit cannot act once it is set, also when
    the active unit has 0 AP.

MOVE cost
12. One orthogonal step costs `movementCostFactor` AP
    (factor 1 → 1, factor 3 → 3).
13. One diagonal step costs `ceil(movementCostFactor × √2)` AP
    (factor 1 → 2, factor 3 → 5).
14. `ceil` is applied once per MOVE: factor 1, two diagonals in one MOVE cost
    3 AP; as two MOVEs they cost 4 AP.
15. A path cost exceeding an integer only by floating-point error is not
    rounded up (`COST_EPSILON`).

Reachability and execution
16. Reachability uses the cheapest legal path; a destination's cost is that
    path's AP cost.
17. A destination is reachable iff its cost `<= remainingActionPoints`.
18. MOVE is a legal action only for a unit that may act and can reach at
    least one destination.
19. A MOVE whose full AP cost exceeds `remainingActionPoints` is rejected;
    there is no partial move.
20. A successful MOVE deducts exactly the AP cost of the submitted path and
    updates position, `remainingActionPoints` and `activeUnitId` in one new
    state.
21. A legal submitted path that is not the cheapest is accepted and charged
    its own AP cost.
22. A failed MOVE changes nothing (position, AP, `activeUnitId`).
23. The UI submits the canonical cheapest path, so the executed cost equals
    the previewed cost.

API and removal
24. `UnitDto`/OpenAPI/generated client contain `actionPointBudget` and
    `movementCostFactor`, and neither `moveRange` nor
    `remainingActionPoints`/`activeUnitId`.
25. `moveRange`/`remainingMovement` are removed from the active model (§14).

UI
26. The battle UI shows AP (spent/budget/remaining) instead of movement, and
    integer AP costs for targets, preview and last move.
27. END TURN is enabled at 0 AP.
28. The UI calculates no cost and decides no legality.

Regression
29. All M4 movement rules and M5 turn rules not changed by this contract
    still hold, and their tests pass (adapted to AP only where they assert
    movement values). Pathfinding algorithm and tie-breaking are unchanged.
30. Domain transitions remain immutable.

## 16. Testing contract

Tests extend the existing specs; no new test infrastructure. Unit tests use
Vitest with explicit `import { describe, it, expect } from 'vitest'`.

Movement cost — `domain/movement-cost.spec.ts`
- step cost: orthogonal = factor, diagonal = factor × √2, for factor 1 and 3;
- AP conversion: the five examples of §8; exact integers stay unchanged
  (`3 → 3`); integer + rounding error (`3 + 1e-12 → 3`); genuinely above
  (`3.001 → 4`); `0 → 0` (not `-0`);
- existing `isCheaper`/`isWithinBudget` tests kept.

Movement rules — `domain/movement-rules.spec.ts`
- `step` returns the factor-weighted cost; `walkPath` sums weighted costs;
- existing obstacle/footprint/corner tests unchanged.

Pathfinding — `domain/pathfinding.spec.ts`
- budget in AP: a destination whose AP cost equals the budget is included,
  one AP above is excluded;
- two diagonals reachable with 3 AP at factor 1 (cost 2.83 → 3);
- one diagonal not reachable with 4 AP at factor 3 (needs 5);
- cheapest path chosen when a cheaper detour exists;
- existing determinism/tie-breaking/footprint/gap tests kept unchanged.

Engine — `domain/battle-engine.spec.ts`
- MOVE_UNIT: deducts the AP cost; one ceil per path; exactly exhausting AP
  allowed; insufficient AP rejected with required/available integers;
  rejected at 0 AP; no partial move; failed MOVE leaves the input state
  identical (position, AP, `activeUnitId`); non-minimal valid path charged
  its own AP cost; split MOVEs cost more than one MOVE (§8);
- reachability: limited by `remainingActionPoints`, also for the opponent's
  units; exposes AP cost per destination;
- legal actions: no MOVE at 0 AP; no MOVE when the cheapest step is
  unaffordable; END_TURN offered at 0 AP;
- active unit: insufficient-AP failure does not claim the turn; active unit
  at 0 AP still blocks other units;
- endTurn: AP restoration for the new player only; partially spent AP kept
  by the other player; END_TURN at 0 AP; immutability/identity tests kept;
- "reachability and execution" block: every offered destination executes
  successfully and charges exactly the offered AP cost.

Domain types — `domain/movement.spec.ts`: adapted to the renamed error and
AP cost fields.

Mapper — `battle/battle-state.mapper.spec.ts`
- maps `actionPointBudget`, `movementCostFactor`; sets
  `remainingActionPoints = actionPointBudget`; fails fast on missing fields;
  invariant validation tests at the boundary chosen per §18.1.

Store — `battle/battle.store.spec.ts`
- destinations limited by AP; preview shows AP cost; move deducts AP; END
  TURN restores AP and works at 0 AP.

Components — `components/movement-info`, `components/movement-overlay`,
`pages/battle-demo-page` specs
- AP spent/budget/remaining rendered; integer AP costs in target labels,
  preview and last outcome; insufficient-AP rejection text; END TURN
  enabled at 0 AP.

Backend — `BattleServiceTest`, `BattleControllerTest`
- demo units have `actionPointBudget = 3`, `movementCostFactor = 1`;
- JSON contains both fields and no `moveRange`, `remainingActionPoints`,
  `activeUnitId`;
- invariant validation tests at the boundary chosen per §18.1.

API/client
- regenerated `model/unitDto.ts` contains the new fields only; no hand
  edits; frontend build (`ng build`) and lint pass.

Playwright — `e2e/movement.spec.ts` (+ mocked responses in
`battle-board.spec.ts`, `unit-selection.spec.ts`)
- AP shown for the selected unit; target labels and preview in AP;
  moving deducts AP; a unit at 0 AP has no targets; END TURN at 0 AP
  restores the next player's AP.

Regression: the full existing M4/M5 unit, component, backend and Playwright
suites pass, changed only where they assert `moveRange`/`remainingMovement`
values.

## 17. Out of scope

M6 does not:

- design or implement ATTACK, ABILITY or their AP costs (M7+);
- introduce terrain with `terrainCost != 1` or new terrain types;
- add any acceleration/deceleration or other compensation for split MOVEs;
- add partial moves;
- add `remainingActionPoints` or `activeUnitId` to the API;
- move the engine to the backend, add backend actions, persistence,
  networking or a database;
- add an active-unit indicator or other new UI elements;
- rename existing components, store members or files beyond the AP change;
- change pathfinding's algorithm or tie-breaking.

## 18. Open implementation questions

### 18.1 Validation boundary of the unit-statistic invariants

The invariants `actionPointBudget > 0` and `movementCostFactor > 0`
(integers) are closed (§5). Open is only where they are validated; the
choice must not weaken them. Today nothing validates unit statistics: the
Java records have no compact constructors, and the mapper checks presence
only (`required(...)`). Candidate boundaries:

- the Java `Unit` record (compact constructor), where the battle state
  originates;
- the frontend mapper, failing fast like `required(...)`, because the
  frontend engine is the one that relies on the invariants in M6.

### 18.2 Implementation details already noted in this contract

Not open decisions, listed so they are not lost: the AP conversion returns
`0`, not `-0` (§8.2); the `Math.max(0, …)` clamp and the `COST_EPSILON`
and `canMoveAnywhere` comments are revised (§8.2, §9.2); the field name of
the AP cost on `ReachableCell` (§9.3).

### 18.3 Proposed M6 steps

BATTLE_PLAN.md says the M6 steps are defined in the design review. Proposal:

- **M6.1 — AP cost functions.** `movement-cost.ts` (factor-weighted step
  cost, AP conversion) with tests. Pure functions, not yet wired; no model
  change.
- **M6.2 — AP model end to end.** Java `Unit`/`UnitDto`/demo values,
  OpenAPI + Orval regeneration, mapper, domain `Unit`, engine
  (`execute`, `endTurn`, reachability, legal actions), error rename,
  fixtures, and the minimal component/e2e updates needed to compile and
  pass. One step because removing `moveRange` from the API breaks the
  mapper, and CLAUDE.md requires DTO and frontend changes in one commit.
- **M6.3 — AP presentation.** Movement info, overlay labels, target labels,
  error text as AP; component and Playwright tests.
- **M6.4 — Verification and documentation.** Check acceptance criteria,
  close test gaps, record the M6 steps and status in BATTLE_PLAN.md.
