# Game Design

## Purpose

This document describes the gameplay model and domain concepts of Nimuairy.

It is intentionally separate from `BATTLE_PLAN.md`:

- `GAME_DESIGN.md` describes **what the game is and how its rules are intended to work**.
- `BATTLE_PLAN.md` describes **the implementation roadmap and milestone order**.
- `LEARNING_GOALS.md` describes **what we want to learn while building the project**.

This is a living design document. Ideas listed as future ideas are not implementation commitments.

## 1. Core Concept

Nimuairy is a turn-based battle game played on a grid.

Two players control units on the same board. Each player has an orb protected by a wall.

The primary objective is to destroy the opponent's orb.

Destroying the opponent's orb immediately ends the battle and determines the winner, regardless of how many units either player has remaining.

## 2. Turn Model

The battle is divided into player turns.

During a turn:

- exactly one unit may act;
- the unit may perform multiple actions during that turn;
- the player may choose to perform another action with the same unit until the turn is ended;
- `END_TURN` is the action that ends the current turn;
- `remainingActionPoints = 0` does not end the turn automatically.

The other player's turn begins only after `END_TURN`.

At the start of a new player's turn, every unit belonging to that player has its
`remainingActionPoints` restored to its `actionPointBudget`.

Action Point restoration therefore happens on turn start, not when ending the previous
turn. A player's units may keep partially spent Action Points after that player's
turn has ended; they are restored when that player becomes active again.

> Action Points are introduced in M6. Up to and including M5, the implementation
> uses `remainingMovement` restored to `moveRange` instead (see
> [`M5_DESIGN_CONTRACT.md`](./M5_DESIGN_CONTRACT.md)).

### 2.1 Current player

`BattleState.currentPlayer` identifies the player whose turn is currently active.

Only that player may perform gameplay actions during the turn.

The current player is a property of battle state, not UI state.

### 2.2 Ending a turn

`END_TURN` is the only action that ends a turn.

Ending a turn:

1. switches `currentPlayer` to the other player;
2. starts that player's turn;
3. restores `remainingActionPoints` to `actionPointBudget` for every unit owned by the new current player.

Ending a turn does **not** require all Action Points to be spent. It is valid with any
number of remaining Action Points, including `0`.

### 2.3 Active unit

The active unit is the one unit allowed to act during the current turn.

- At the start of a turn there is no active unit.
- The turn's first successful unit action, such as a move, makes that unit the active unit.
- A failed action does not make a unit active.
- Once a unit is active, no other unit may act until the turn ends.
- `END_TURN` clears the active unit for the next player's turn.

The active unit is battle state (`BattleState.activeUnitId`), just like `currentPlayer`.

It is not the same as the unit selected in the UI (`selectedUnitId`). Selection is presentation
state: a player may select or inspect any unit, including the opponent's units, at any time.
Selecting a unit never makes it active, and selecting another unit does not change the active unit.

### 2.4 Action Points

Action Points (AP) are the single resource that all actions of a unit draw from.
Movement is the first action that uses them. Attacks, abilities, and other future
actions will spend the same AP rather than having separate per-action allowances.

- AP are integers.
- `END_TURN` costs no AP and is always possible, including at `0 AP`.
- `0 AP` does not end the turn automatically.
- AP are restored at the start of the owner's turn (see 2 and 2.2).

Four concepts must be kept apart:

| Concept | Kind | Meaning |
|---|---|---|
| `actionPointBudget` | unit statistic | AP the unit has at the start of each of its owner's turns |
| `remainingActionPoints` | battle state, per unit | AP the unit has left in the current turn |
| `activeUnitId` | battle state | the unit that has claimed the right to act this turn (2.3) |
| `selectedUnitId` | UI state | the unit chosen for display or inspection |

Only battle state decides which unit may act. `selectedUnitId` never grants or
implies the right to act.

## 3. Board

### 3.1 Grid

The entire game area is represented by a single rectangular grid.

Objects that were visually outside the grid in the old prototype, such as walls and orbs, are now part of the grid and use the same coordinate system as all other game objects.

The initial board planned for M1 is 21 x 11 cells.

The exact initial placement of all objects is part of the M1 demo battle state.

### 3.2 Coordinates

A position identifies a cell on the board.

The board uses zero-based coordinates:

- `x`: column, from `0` to `width - 1`
- `y`: row, from `0` to `height - 1`

Every object that occupies board space uses this coordinate system.

## 4. Board Layers

The board is conceptually composed of several independent layers.

### 4.1 Terrain

Terrain describes the properties of a cell.

The initial game only needs a basic/default terrain type.

The terrain system is intentionally extensible. Future terrain types may include swamp, hot springs, and other terrain with movement or combat effects.

Terrain is not the same concept as a wall.

### 4.2 Structures

Structures are persistent objects that form part of the battlefield.

Walls are structures.

A structure can occupy one or more cells through a footprint.

### 4.3 Units

Units are controllable game entities belonging to a player.

Units can occupy one or more cells through a footprint.

### 4.4 Objectives

Objectives are interactive game objects with a gameplay purpose.

Each player has one orb.

Orbs occupy one or more cells through a footprint.

## 5. Orbs

Each player has exactly one orb.

The orb:

- belongs to a player,
- has a position,
- has a footprint,
- has hit points,
- can be targeted by attacks,
- is protected by that player's wall.

The initial orb can use a one-cell footprint, but the domain model should not require every objective to occupy exactly one cell.

### Victory condition

Destroying a player's orb immediately ends the battle.

The opponent wins.

The number, health, or status of the remaining units does not change this victory condition.

## 6. Walls

Each player has a wall protecting their orb.

The initial design uses a wall that is two cells wide.

A wall is a structure, not a unit and not merely a terrain type.

A wall:

- occupies one or more cells,
- has a footprint,
- may have hit points and other properties in the future,
- can contain slots for units,
- can be interacted with by movement and combat rules.

### 6.1 Wall slots

Walls may expose a number of explicit slots where units can be positioned.

A slot can define:

- its position relative to the wall,
- whether it is occupied,
- which unit types are allowed to use it.

One planned example is a rule such as: a wall can contain at most four archers.

The slot model is intended to make such rules explicit rather than representing them as an arbitrary global limit.

The exact slot layout and supported unit types are future gameplay details unless required by a particular milestone.

### 6.2 Units on walls

A unit occupying a wall slot is still a unit.

The wall remains a structure.

This distinction allows future mechanics such as ranged units positioned on walls, mounted units, different wall types, destructible walls, and units with special abilities for interacting with walls.

## 7. Units

A unit belongs to a player and has gameplay statistics.

The initial domain model includes:

- id
- player/owner
- unit type
- HP
- defense
- attack
- position
- footprint

From M6, a unit also has:

- `actionPointBudget` — its AP per turn (see 2.4)
- `baseMovementCost` — its movement cost multiplier (see 8.2)
- `remainingActionPoints` — its current AP, as battle state

`moveRange` is removed from the gameplay model in M6.

### 7.1 Position

A unit's position is its anchor position.

It does not necessarily describe every cell occupied by the unit.

### 7.2 Footprint

A footprint describes the cells occupied by a unit relative to its anchor position.

A normal one-cell unit has the relative cell `(0, 0)`.

A future multi-cell unit could have a footprint such as:

```text
XX
XX
```

without requiring a different positioning model.

The currently planned units can all use a one-cell footprint.

### 7.3 Occupied cells

Occupied cells are derived from:

`anchor position + footprint`

They should not be treated as a second independent source of truth.

This keeps movement and state changes simpler and leaves room for units with different shapes and sizes.

### 7.4 Rotation

Unit rotation is intentionally not part of the initial design.

It may be introduced later if gameplay requires it.

## 8. Movement and Traversal

Movement rules determine whether a unit can move from one position to another.

The board model and the movement rules are separate concerns.

Future units may have different movement capabilities, for example:

- normal ground movement
- wall-jumping
- flying
- teleportation
- other special movement abilities

A wall therefore does not need to encode every possible movement rule itself.

The movement engine should decide whether a particular unit can interact with a particular terrain or structure.

### 8.1 Movement during a turn

Movement is a unit action. A turn's first successful move makes the moving unit the active unit (see 2.3). After that, only that unit may move.

Movement spends the unit's `remainingActionPoints`. A unit may perform multiple actions
during its turn, so it may move multiple times while it has enough AP.

Running out of AP does not end the turn.

At the start of a unit owner's new turn, its `remainingActionPoints` is restored to
`actionPointBudget`.

### 8.2 Movement cost

The AP cost of one MOVE is calculated once for its whole path:

    movementCost = ceil( sum over all steps of
                         unit.baseMovementCost × stepCost × terrainCost )

For M6:

- `stepCost` is `1` for an orthogonal step and `√2` for a diagonal step;
- `terrainCost` is `1` for all current terrain.

Fractional values exist only during the calculation. The resulting cost and all AP
values are integers.

Examples with `baseMovementCost = 1`:

- one orthogonal step costs `1 AP`;
- one diagonal step costs `ceil(√2) = 2 AP`;
- two diagonal steps in one MOVE cost `ceil(2√2) = 3 AP`.

Examples with `baseMovementCost = 3`:

- one orthogonal step costs `3 AP`;
- one diagonal step costs `ceil(3√2) = 5 AP`.

A MOVE is one action, so rounding is applied once per MOVE. Splitting a path into
several MOVEs can therefore cost more in total than one longer MOVE along the same
cells. This is intended.

`terrainCost` is a per-step factor, so terrain with a cost other than `1` can be
introduced later without changing the AP model.

## 9. Combat

Combat is governed by unit statistics and battle rules.

The initial unit model includes:

- attack
- defense
- HP

The orb is also a valid combat objective.

The exact attack ranges, targeting rules, damage calculation, and special abilities are defined by later gameplay milestones.

The domain model should not assume that all attacks target units only.

## 10. Domain Concepts

The domain should distinguish between different kinds of objects even when they share common geometric concepts.

Conceptually:

```text
BattleState
├── Board
│   ├── dimensions
│   └── terrain
├── Objectives
│   └── Orbs
├── Structures
│   └── Walls
└── Units
```

Objects that occupy board space can share the concepts `position + footprint` without being forced into one common semantic type.

For example:

- a unit is controllable by a player,
- a wall is a battlefield structure,
- an orb is a victory objective.

The domain model should remain independent of Spring, JPA, and persistence concerns.

## 11. Initial Battle

M1 provides a deterministic, hard-coded initial battle.

The initial battle should contain:

- a 21 x 11 board,
- two player orbs,
- two player walls,
- four units for player 1,
- four units for player 2,
- unit types and statistics,
- positions,
- one-cell footprints for the initial units.

The initial state is a demonstration state and is not persisted.

The initial current player for the demo battle is `LEFT`.

## 12. Future Ideas

The following ideas are intentionally recorded so that they are not lost. They are not commitments to a particular milestone.

### Terrain

- [ ] swamp
- [ ] hot springs
- [ ] movement-cost terrain
- [ ] terrain effects on combat
- [ ] terrain/status interactions

### Units

- [ ] multi-cell units
- [ ] mounted units
- [ ] flying units
- [ ] units with special movement
- [ ] wall-jumping units
- [ ] units with special abilities
- [ ] unit rotation, if eventually needed

### Walls and structures

- [ ] wall-mounted ranged units
- [ ] explicit wall-slot restrictions
- [ ] destructible walls
- [ ] different wall types
- [ ] gates or other structures
- [ ] structures with different footprints

### Objectives

- [ ] larger or multi-cell objectives
- [ ] additional objective types
- [ ] objective-specific rules

### Combat

- [ ] ranged combat
- [ ] attack range rules
- [ ] area-of-effect attacks
- [ ] special damage types
- [ ] defensive abilities

## 13. Design Principles

1. **Keep the domain independent from frameworks and persistence.**
2. **Represent board geometry explicitly.**
3. **Use position + footprint for objects occupying board cells.**
4. **Avoid duplicating derived state such as occupied cells.**
5. **Keep terrain, structures, units, and objectives conceptually separate.**
6. **Put gameplay rules in the battle domain/engine rather than in UI components.**
7. **Do not implement future ideas before they become actual requirements.**
8. **Prefer simple models that can evolve without forcing a rewrite.**
9. **Document important design decisions so that AI agents and humans share the same context.**
