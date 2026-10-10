# M5 Design Contract — Turns

## 1. Purpose and Scope

This document defines the concrete gameplay and technical contract for M5 — Turns.

M5 introduces the first real turn lifecycle on top of the movement system implemented in M4.

M5 adds:
- the authoritative current player in the backend/API battle state;
- the rule that exactly one unit may act during a turn;
- multiple actions by that same unit during the turn;
- legal-action evaluation;
- ending a turn;
- switching players;
- restoration of movement for the newly active player;
- a real end-turn control in the Battle Demo.

M5 does not implement combat.

GAME_DESIGN.md is the source of truth for gameplay concepts.
BATTLE_PLAN.md is the source of truth for milestone order and scope.
This document is the source of truth for M5-specific rules and acceptance criteria.

## 2. Turn Model

During a turn:
- exactly one unit may perform gameplay actions;
- that unit may perform multiple actions;
- a different unit may not perform a gameplay action during the same turn;
- END_TURN is the only action that ends the turn;
- exhausting remainingMovement does not end the turn;
- a turn may be ended while movement remains.

Example:

    LEFT turn
       |
       +-- unit A: MOVE
       |
       +-- unit A: another action
       |
       +-- unit A: future ATTACK
       |
       +-- END_TURN
       |
       v
    RIGHT turn

The active unit is different from the current player:
- currentPlayer identifies who may act;
- the active unit identifies which unit has claimed the turn for gameplay actions.

## 3. Active Unit

The turn must enforce that only one unit acts.

The recommended domain representation is:

    activeUnitId: string | undefined

activeUnitId is battle state, not Angular selection state.

Before the first gameplay action of a turn:
- activeUnitId is undefined;
- a valid action by any unit owned by currentPlayer may claim the turn.

When the first unit-targeted gameplay action succeeds:
- that unit becomes activeUnitId;
- subsequent gameplay actions in the same turn may target only that unit.

A player may visually select or inspect another unit, but that does not change activeUnitId once the turn has been claimed.

At the start of a new turn:
- activeUnitId becomes undefined.

M5 does not require a separate SELECT_UNIT battle action.

## 4. Current Player

BattleState.currentPlayer identifies the player whose turn is active.

The demo battle starts with:

    currentPlayer = LEFT

Only units owned by currentPlayer may perform gameplay actions.

The engine must read currentPlayer from battle state and must not assume LEFT internally.

## 5. Legal Actions

M5 introduces a domain-level representation for legal gameplay actions.

M5 recognizes:
- MOVE
- END_TURN

ATTACK is intentionally not implemented in M5, but the action model should be open to adding it in M6 without redesigning the turn model.
*(Superseded: M6 is Action Points; ATTACK/Combat moved to M7, see BATTLE_PLAN.md.)*

For a gameplay action targeting a unit:
1. the unit must exist;
2. the unit must belong to currentPlayer;
3. if activeUnitId is already set, the unit must equal activeUnitId;
4. the action itself must otherwise be legal.

For END_TURN:
- it is the only action that ends the turn;
- it does not depend on remaining movement;
- it is legal during the normal active-turn state.

Future actions should not be reported as legal merely because the model can represent them.

## 6. MOVE in M5

M4 already validates movement execution against state.currentPlayer.

M5 adds the active-unit restriction:
- before a turn is claimed, a legal MOVE may be performed by any unit owned by currentPlayer;
- after a unit has claimed the turn, only that unit may perform MOVE;
- existing M4 movement validation remains authoritative for path, footprint, obstacles, movement cost, and remaining movement.

M5 must not rewrite the movement algorithm.

A successful first MOVE claims the turn for that unit.
A failed MOVE does not claim the turn.

## 7. Ending a Turn

END_TURN is the only gameplay action that ends a turn.

Executing END_TURN:
1. switches currentPlayer to the other player;
2. clears activeUnitId;
3. starts the new player's turn;
4. restores remainingMovement = moveRange for every unit owned by the newly active player.

The player whose turn just ended keeps its current remainingMovement values.

Movement is therefore restored at turn start, not while ending the previous player's turn.

Example:

    LEFT:
      unit A remainingMovement = 1.5
      END_TURN

    RIGHT:
      RIGHT units restored to moveRange
      LEFT unit A remains at 1.5

    RIGHT:
      END_TURN

    LEFT:
      unit A restored to moveRange

Ending the turn is valid even when:
- the active unit has movement remaining;
- the active unit has remainingMovement = 0;
- the active player has not performed a gameplay action yet.

## 8. State Transition and Immutability

Turn transitions follow the same immutable domain style as M4.

A successful END_TURN returns a new BattleState.
The previous state remains unchanged.

A successful turn transition may change:
- currentPlayer;
- activeUnitId;
- remainingMovement of units belonging to the newly active player.

It must not mutate unrelated battle data.

A failed action leaves the battle state unchanged.

## 9. Backend and API Contract

M5 adds currentPlayer to:
- Java BattleState;
- BattleStateResponse;
- OpenAPI;
- the regenerated Angular API client.

The initial demo response contains currentPlayer = LEFT.

The frontend mapper reads currentPlayer from the generated response and no longer provides a hard-coded LEFT fallback.

activeUnitId is prototype-domain turn state introduced by the frontend battle engine. It is not required to become a backend/API field in M5 because gameplay transitions still execute on the frontend. It can be aligned with the backend battle state later when the authoritative engine is moved to Java.

## 10. Domain and UI Boundaries

Turn rules belong in the framework-independent battle domain.

Angular is responsible for:
- presenting the current player;
- presenting the active unit when useful;
- exposing legal actions through controls;
- dispatching actions to the battle engine;
- presenting the resulting state.

Angular must not independently decide:
- whose turn it is;
- which unit is allowed to act;
- when movement is restored;
- whether a turn may end.

The SignalStore remains the feature/application state boundary and must not become a second turn engine.

## 11. End-Turn UI

The Battle Demo receives a real player-facing END TURN control.

This replaces the M4 technical movement reset control.

The end-turn control is a gameplay control, not a development aid.

The UI may disable or hide controls that are known to be unavailable from the current legal-action result, but the domain engine remains authoritative.

The UI should communicate whose turn is active and, where useful, which unit has claimed the turn.

## 12. Testing Contract

### Current player
- the initial demo state starts with LEFT;
- mapping reads currentPlayer from the API response;
- RIGHT is accepted when supplied by the backend/API.

### Active unit
- before the first gameplay action, no active unit exists;
- a successful first unit action claims that unit;
- a failed action does not claim a unit;
- a different unit cannot perform a gameplay action after the turn is claimed;
- the active unit is cleared by END_TURN.

### Multiple actions
- the same unit may perform multiple actions in one turn;
- a unit may perform MOVE more than once while movement remains;
- remainingMovement = 0 does not end the turn.

### End turn
- LEFT switches to RIGHT;
- RIGHT switches to LEFT;
- END_TURN is the only turn-ending action;
- ending the turn is allowed with movement remaining;
- ending the turn is allowed with movement exhausted;
- ending the turn is allowed before the active unit has performed an action.

### Movement restoration
- all newly active player's units are restored to moveRange;
- the player whose turn ended is not restored;
- a partially spent unit is restored only when its owner becomes active again.

### Immutability
- the previous BattleState remains unchanged after successful END_TURN;
- failed actions do not mutate the state;
- unrelated units and battle objects remain unchanged.

### Integration
Playwright should verify:
- current-player display;
- using one unit for multiple actions;
- preventing a second unit from acting in the same turn;
- ending the turn;
- switching the current player;
- restoring movement for the newly active player;
- removing the M4 development reset control.

## 13. Scope Exclusions

M5 does not implement:
- combat or ATTACK;
- attack range;
- damage;
- victory/defeat;
- backend-authoritative battle execution;
- persistence;
- multiplayer networking;
- authentication changes;
- a separate SELECT_UNIT gameplay action;
- a database;
- event sourcing.

## 14. Acceptance Criteria

M5 is complete when:
1. currentPlayer is supplied by the backend/API and mapped into domain state.
2. The demo starts with LEFT as the current player.
3. Exactly one unit may perform gameplay actions during a turn.
4. The first successful unit action claims that unit for the turn.
5. The claimed unit may perform multiple actions during the same turn.
6. A different unit cannot perform gameplay actions until the turn ends.
7. END_TURN is the only action that ends the turn.
8. END_TURN switches the current player.
9. END_TURN clears the active unit.
10. Movement is restored for every unit of the newly active player.
11. Movement of the player whose turn ended is not restored until that player becomes active again.
12. remainingMovement = 0 does not end a turn automatically.
13. M4 movement rules remain intact and are not reimplemented in the UI.
14. The technical movement reset control is removed/replaced by the real end-turn control.
15. The legal-action model is extensible for future actions such as ATTACK without implementing combat in M5.
16. Domain transitions are immutable and covered by deterministic tests.
