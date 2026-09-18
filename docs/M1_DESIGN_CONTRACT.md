# M1 Design Contract — Demo Battle API

## 1. Purpose and Scope

This document defines the exact, binding contract for **M1 — Demo Battle API**, as
described in [`BATTLE_PLAN.md`](./BATTLE_PLAN.md).

M1 delivers a single backend endpoint that returns a deterministic, hard-coded
initial `BattleState`. It does not implement any battle rules, movement,
combat, or persistence.

This document is a **contract**, not a general design document. It exists to
remove ambiguity for implementation: exact coordinates, exact IDs, exact
statistics, and exact scope boundaries. It intentionally does not restate
gameplay rationale beyond what is needed to make the contract unambiguous.

## 2. Relationship to Other Documents

- [`GAME_DESIGN.md`](./GAME_DESIGN.md) is the source of truth for **gameplay
  concepts and rules** (what the game is). This contract must be consistent
  with it.
- [`BATTLE_PLAN.md`](./BATTLE_PLAN.md) is the source of truth for
  **milestone scope and implementation order**. This contract must be
  consistent with it.
- This document (`M1_DESIGN_CONTRACT.md`) is the source of truth for the
  **exact, concrete values** (coordinates, IDs, statistics, API shape) needed
  to implement M1. It does not introduce new gameplay rules beyond what
  `GAME_DESIGN.md` already describes.

If a future conflict is found between this contract and `GAME_DESIGN.md` or
`BATTLE_PLAN.md`, see [Section 16, Conflict Resolution](#16-conflict-resolution).

## 3. Coordinate System

- Cartesian coordinates.
- Origin `(0,0)` is the **bottom-left** corner of the board.
- `x` increases to the right.
- `y` increases upward.

The domain model uses this coordinate system directly. Any translation to
screen coordinates (e.g. inverting `y` for on-screen rendering) is a frontend
concern and is out of scope for M1.

## 4. Board Dimensions and Geometry

- Width: `21`
- Height: `11`
- Valid coordinates: `x = 0..20`, `y = 0..10`
- Total cells: `21 * 11 = 231`

### 4.1 Horizontal layout

```
x:      0      1-2      3-17           18-19     20
      ORB  |  WALL  |  ARENA        |  WALL  |  ORB
      LEFT |  LEFT  |  (playable)   |  RIGHT | RIGHT
```

| Column range | Meaning              |
|--------------|----------------------|
| `x = 0`      | Left orb             |
| `x = 1..2`   | Left wall            |
| `x = 3..17`  | Playable arena       |
| `x = 18..19` | Right wall           |
| `x = 20`     | Right orb            |

The playable arena is the contested area in front of each wall. Each orb sits
behind its own wall, in the protected area on its player's side. Without
first dealing with the wall, the opposing player has no direct path to the
orb.

## 5. Position

`Position` is the anchor coordinate `(x, y)` of an object on the board. It is
a single reference point, not a description of every cell an object occupies.

## 6. Footprint

`Footprint` describes the cells an object occupies, expressed **relative to
its `Position` anchor**.

- Occupied cells = `Position + Footprint`.
- Occupied cells are **derived**, not stored as independent state.
- This model applies uniformly to units, structures, and objectives, and
  extends to multi-cell objects without changing the positioning model.

M1 footprints:

| Object type | Footprint  |
|-------------|------------|
| Unit        | `1x1`      |
| Wall        | `2x11`     |
| Orb         | `1x1`      |

## 7. Terrain

Terrain is represented as the complete board grid: **231 explicit terrain
cells** (`21 * 11`), each with at least:

- `Position`
- terrain type

Every M1 terrain cell has terrain type `PLAIN`. No default/implicit terrain
representation is used — all 231 cells are explicit, since establishing the
grid model is itself part of M1's purpose.

## 8. Conceptual Layers

Per `GAME_DESIGN.md` §3 and §9, the following remain distinct concepts and
are not merged into a single generic type:

- **Terrain** — per-cell properties of the board.
- **Structures** — persistent battlefield objects (walls).
- **Units** — player-controlled combatants.
- **Objectives** — interactive objects with a gameplay purpose (orbs).

A wall is a Structure. An orb is an Objective. Neither is a Unit.

## 9. Structures — Walls

Each player has one wall, position = anchor (bottom-left cell of its
footprint), footprint `2x11` (2 columns × 11 rows).

| Wall  | ID           | Position | Occupied cells (x, y)        | Health |
|-------|--------------|----------|-------------------------------|--------|
| Left  | `wall-left`  | `(1,0)`  | `x = 1..2`, `y = 0..10`       | 1500   |
| Right | `wall-right` | `(18,0)` | `x = 18..19`, `y = 0..10`     | 1500   |

Wall slots are **out of scope for M1** (see [Section 15](#15-out-of-scope)).

## 10. Objectives — Orbs

Each orb has: `Position`, `Footprint`, `Health`, owning `PlayerSide`. The orb is
on the board, using the same coordinate system as every other object.

| Orb   | ID          | Position | Owner | Health |
|-------|-------------|----------|-------|--------|
| Left  | `orb-left`  | `(0,5)`  | LEFT  | 75     |
| Right | `orb-right` | `(20,5)` | RIGHT | 75     |

### Victory condition

Destroying the opponent's orb immediately ends the battle and determines the
winner, regardless of how many units either player has remaining.

## 11. Units

Each unit has: `id`, `PlayerSide`, `Position`, `Footprint`, `Health`/health,
`attack`, `defense`, `moveRange`.

All M1 units use a `1x1` footprint. Rotation is not implemented in M1.

`moveRange` is the number of cells a unit may move during its turn. Movement
itself is not implemented in M1 — the field only needs to be present as
part of the unit's data.

### 11.1 M1 statistics (all units)

| Stat      | Value |
|-----------|-------|
| health    | 500   |
| attack    | 200   |
| defense   | 50    |
| moveRange | 3     |

### 11.2 Initial positions

| ID            | Side  | Position |
|---------------|-------|----------|
| `unit-left-1` | LEFT  | `(3,2)`  |
| `unit-left-2` | LEFT  | `(3,4)`  |
| `unit-left-3` | LEFT  | `(3,6)`  |
| `unit-left-4` | LEFT  | `(3,8)`  |
| `unit-right-1`| RIGHT | `(17,2)` |
| `unit-right-2`| RIGHT | `(17,4)` |
| `unit-right-3`| RIGHT | `(17,6)` |
| `unit-right-4`| RIGHT | `(17,8)` |

### 11.3 Board layout (ASCII, full geometry)

Each wall occupies its full `2x11` footprint — i.e. both wall columns are
occupied at **every** row `y=0..10`, not only at the orb's row. Each orb
occupies only its single cell at `y=5`; the rest of its column (`x=0` /
`x=20`) is plain terrain. Units occupy only their single listed cell.

```
y=10  . WW ............... WW .
y=9   . WW ............... WW .
y=8   . WW U.............U WW .   U = unit-left-4 / unit-right-4
y=7   . WW ............... WW .
y=6   . WW U.............U WW .   U = unit-left-3 / unit-right-3
y=5   O WW ............... WW O   O = orb
y=4   . WW U.............U WW .   U = unit-left-2 / unit-right-2
y=3   . WW ............... WW .
y=2   . WW U.............U WW .   U = unit-left-1 / unit-right-1
y=1   . WW ............... WW .
y=0   . WW ............... WW .
      0  1-2      3..17     18-19 20    (x)
```

`W` marks a wall-occupied cell (structure `wall-left` / `wall-right`); `.`
marks plain terrain.

## 12. PlayerSide

Two sides only: `LEFT`, `RIGHT`. No additional sides or factions in M1.

## 13. IDs

Deterministic, fixed IDs:

- Walls: `wall-left`, `wall-right`
- Orbs: `orb-left`, `orb-right`
- Units: `unit-left-1..4`, `unit-right-1..4`

## 14. API

### 14.1 Endpoint

```
GET /api/v1/battles/demo
```

### 14.2 JSON naming convention

All JSON field names use **camelCase**. This section distinguishes the
**domain type name** (used in the domain model, e.g. Java classes/records)
from the **JSON field name** it is serialized under:

| Domain concept              | JSON field name | JSON shape                          |
|------------------------------|------------------|--------------------------------------|
| `Position`                  | `position`       | object `{ "x": number, "y": number }` |
| `Footprint`                 | `footprint`      | array of relative offset objects, each `{ "x": number, "y": number }` (see [14.5](#145-footprint)) |
| `PlayerSide`                 | `owner`          | enum string: `"LEFT"` \| `"RIGHT"`   |
| health / Health (unit, wall, orb) | `health`        | number                               |
| unit type                    | `unitType`      | enum string, M1 value: `"SWORDSMAN"` |
| terrain type                 | `type`          | enum string, M1 value: `"PLAIN"`     |
| move range                   | `moveRange`     | number                               |
| identifier                   | `id`            | string                               |

No `leftPlayer` / `rightPlayer` nesting. Side ownership is expressed per
object (`owner` on each unit, wall, and orb), not by grouping objects under a
per-player structure.

### 14.3 Top-level response shape

```json
{
  "board": { "...": "see 14.4" },
  "orbs": [ "...": "see 14.6" ],
  "walls": [ "...": "see 14.7" ],
  "units": [ "...": "see 14.8" ]
}
```

### 14.4 `board`

`board` contains the board dimensions and the complete terrain grid — terrain
is nested inside `board`, not a sibling top-level key.

```json
{
  "width": 21,
  "height": 11,
  "terrain": [
    { "position": { "x": 0, "y": 0 }, "type": "PLAIN" },
    { "position": { "x": 1, "y": 0 }, "type": "PLAIN" },
    { "position": { "x": 2, "y": 0 }, "type": "PLAIN" },
    "... 231 entries total ...",
    { "position": { "x": 19, "y": 10 }, "type": "PLAIN" },
    { "position": { "x": 20, "y": 10 }, "type": "PLAIN" }
  ]
}
```

`terrain` contains exactly **231 entries** — one per cell, for every
combination of `x = 0..20` and `y = 0..10`. Every M1 entry has
`"type": "PLAIN"`. The example above is truncated for readability; the
actual response is not truncated.

### 14.5 `footprint`

Each footprint entry is a **relative offset from the object's `position`
anchor**, using the same `{ "x", "y" }` shape as `position` (offsets are
conceptually positions relative to the anchor, so they reuse the approved
`Position` JSON shape rather than introducing a second coordinate encoding).
Occupied cells = `position.x + offset.x`, `position.y + offset.y` for each
offset in `footprint`. This list is not a separate source of truth — it is
the serialized form of the domain `Footprint`.

- 1×1 footprint (all M1 units, both orbs):
  ```json
  [ { "x": 0, "y": 0 } ]
  ```
- 2×11 footprint (both walls), anchored at the wall's `position`
  (bottom-left cell), full 22 entries:
  ```json
  [
    { "x": 0, "y": 0 },  { "x": 1, "y": 0 },
    { "x": 0, "y": 1 },  { "x": 1, "y": 1 },
    { "x": 0, "y": 2 },  { "x": 1, "y": 2 },
    { "x": 0, "y": 3 },  { "x": 1, "y": 3 },
    { "x": 0, "y": 4 },  { "x": 1, "y": 4 },
    { "x": 0, "y": 5 },  { "x": 1, "y": 5 },
    { "x": 0, "y": 6 },  { "x": 1, "y": 6 },
    { "x": 0, "y": 7 },  { "x": 1, "y": 7 },
    { "x": 0, "y": 8 },  { "x": 1, "y": 8 },
    { "x": 0, "y": 9 },  { "x": 1, "y": 9 },
    { "x": 0, "y": 10 }, { "x": 1, "y": 10 }
  ]
  ```

### 14.6 `orbs`

```json
[
  {
    "id": "orb-left",
    "owner": "LEFT",
    "position": { "x": 0, "y": 5 },
    "footprint": [ { "x": 0, "y": 0 } ],
    "health": 75
  },
  {
    "id": "orb-right",
    "owner": "RIGHT",
    "position": { "x": 20, "y": 5 },
    "footprint": [ { "x": 0, "y": 0 } ],
    "health": 75
  }
]
```

### 14.7 `walls`

```json
[
  {
    "id": "wall-left",
    "owner": "LEFT",
    "position": { "x": 1, "y": 0 },
    "footprint": [ "... 22 entries, see 14.5 ..." ],
    "health": 1500
  },
  {
    "id": "wall-right",
    "owner": "RIGHT",
    "position": { "x": 18, "y": 0 },
    "footprint": [ "... 22 entries, see 14.5 ..." ],
    "health": 1500
  }
]
```

### 14.8 `units`

```json
[
  {
    "id": "unit-left-1",
    "owner": "LEFT",
    "unitType": "SWORDSMAN",
    "position": { "x": 3, "y": 2 },
    "footprint": [ { "x": 0, "y": 0 } ],
    "health": 500,
    "attack": 200,
    "defense": 50,
    "moveRange": 3
  },
  {
    "id": "unit-left-2",
    "owner": "LEFT",
    "unitType": "SWORDSMAN",
    "position": { "x": 3, "y": 4 },
    "footprint": [ { "x": 0, "y": 0 } ],
    "health": 500,
    "attack": 200,
    "defense": 50,
    "moveRange": 3
  },
  {
    "id": "unit-left-3",
    "owner": "LEFT",
    "unitType": "SWORDSMAN",
    "position": { "x": 3, "y": 6 },
    "footprint": [ { "x": 0, "y": 0 } ],
    "health": 500,
    "attack": 200,
    "defense": 50,
    "moveRange": 3
  },
  {
    "id": "unit-left-4",
    "owner": "LEFT",
    "unitType": "SWORDSMAN",
    "position": { "x": 3, "y": 8 },
    "footprint": [ { "x": 0, "y": 0 } ],
    "health": 500,
    "attack": 200,
    "defense": 50,
    "moveRange": 3
  },
  {
    "id": "unit-right-1",
    "owner": "RIGHT",
    "unitType": "SWORDSMAN",
    "position": { "x": 17, "y": 2 },
    "footprint": [ { "x": 0, "y": 0 } ],
    "health": 500,
    "attack": 200,
    "defense": 50,
    "moveRange": 3
  },
  {
    "id": "unit-right-2",
    "owner": "RIGHT",
    "unitType": "SWORDSMAN",
    "position": { "x": 17, "y": 4 },
    "footprint": [ { "x": 0, "y": 0 } ],
    "health": 500,
    "attack": 200,
    "defense": 50,
    "moveRange": 3
  },
  {
    "id": "unit-right-3",
    "owner": "RIGHT",
    "unitType": "SWORDSMAN",
    "position": { "x": 17, "y": 6 },
    "footprint": [ { "x": 0, "y": 0 } ],
    "health": 500,
    "attack": 200,
    "defense": 50,
    "moveRange": 3
  },
  {
    "id": "unit-right-4",
    "owner": "RIGHT",
    "unitType": "SWORDSMAN",
    "position": { "x": 17, "y": 8 },
    "footprint": [ { "x": 0, "y": 0 } ],
    "health": 500,
    "attack": 200,
    "defense": 50,
    "moveRange": 3
  }
]
```

## 15. Backend/Domain Architecture Constraints

Following existing conventions (`nimuairy-api/CLAUDE.md`, `GAME_DESIGN.md`
§9, `BATTLE_PLAN.md`):

- Responsibilities are layered approximately as:
  `Controller -> Application/Service -> Domain`.
- The domain model (`Position`, `Footprint`, `Board`, `Terrain`, `Wall`,
  `Orb`, `Unit`, `PlayerSide`, `BattleState`, ...) must not depend on Spring
  or JPA.
- No repository is required for M1 — the initial `BattleState` is hard-coded
  in a service.
- API DTOs are kept separate from the domain model, consistent with existing
  backend conventions (separate `XRequest`/`XResponse` records).
- The generated Angular API client must be regenerated (via Orval) once the
  OpenAPI contract for this endpoint exists; the generated code must not be
  hand-edited.

## 16. Out of Scope

The following are explicitly **not** part of M1:

- Persistence (repositories, database tables, battle persistence).
- Real-time battle state / WebSockets.
- Authentication changes.
- Battle UI/screen (belongs to M2).
- Movement implementation.
- Combat implementation.
- Unit rotation.
- Wall slots.
- Archers or any unit type beyond the M1 field unit.
- Special abilities.
- Advanced terrain behavior (non-`PLAIN` terrain).
- Multiplayer networking.

## 17. Acceptance Criteria

M1 is complete when:

1. `GET /api/v1/battles/demo` returns HTTP 200 with a body matching the exact
   shape in [Section 14.3](#143-top-level-response-shape) through
   [14.8](#148-units).
2. The board is `21 x 11`, using the coordinate system in
   [Section 3](#3-coordinate-system).
3. The response includes exactly 2 orbs and 2 walls, at the positions and
   with the IDs specified in [Section 9](#9-structures--walls) and
   [Section 10](#10-objectives--orbs).
4. The response includes exactly 8 units (4 per side), at the positions,
   with the IDs and statistics specified in [Section 11](#11-units).
5. Terrain data for all 231 cells is present, each cell typed `PLAIN`.
6. The domain classes underlying the response contain no Spring or JPA
   dependencies.
7. No database/persistence mechanism is introduced for battle state.
8. The Angular API client is regenerated from the OpenAPI contract for this
   endpoint (once the endpoint is implemented against real DTOs), and no
   generated file is hand-edited.

## 18. Conflict Resolution

If a conflict is discovered between this contract and `GAME_DESIGN.md` or
`BATTLE_PLAN.md`:

- Do not silently resolve it in either document or in code.
- Treat `GAME_DESIGN.md` as the source of truth for gameplay concepts and
  rules, and `BATTLE_PLAN.md` as the source of truth for milestone scope,
  per `BATTLE_PLAN.md`'s own stated rule.
- This contract's concrete values (coordinates, IDs, statistics, API shape)
  take precedence for M1 implementation details **only** once any such
  conflict has been raised and explicitly resolved by the project owner,
  and the affected document(s) updated to match.
