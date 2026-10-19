# M8 Design Contract — Victory

## 1. Purpose and scope

M8 introduces battle completion to the existing turn-based battle domain. The primary victory condition is destruction of the opponent's orb.

Battle rules remain in the frontend `BattleEngine` for this milestone. The backend continues to provide the initial battle state. This milestone does not move the engine to Java/backend and does not introduce persistence, networking, authentication, or multiplayer infrastructure.

This contract records the agreed rules, scope, implementation constraints, and acceptance criteria for M8.

## 2. Existing rules and architecture

M8 preserves the existing M5–M7 turn, Action Point, movement, and combat rules:

- Only `BattleState.currentPlayer` may perform gameplay actions.
- The first successful unit action claims the turn through `activeUnitId`; while claimed, only that unit may act until `END_TURN`.
- Movement and attack costs and legality remain owned by the domain engine.
- A rejected action must not mutate the input state or produce partial side effects.
- The `BattleStore` remains the frontend state-management boundary. It coordinates domain calls and stores their results but must not implement victory rules.
- UI components present domain state and must not independently determine whether the battle has ended or who won.

See `GAME_DESIGN.md` and `M7_DESIGN_CONTRACT.md` for the existing gameplay and combat rules.

## 3. Victory and battle result

### 3.1 Primary victory condition

- A player's orb is destroyed when its `health` reaches `0`.
- An orb remains in `BattleState` when destroyed. Do not remove it; its presence and health allow the engine to retain the terminal state and identify the outcome.
- If an attack reduces an orb owned by the opposing player to `0` HP, the attacker’s side wins.
- The battle result must be updated in the same immutable state transition as the attack's damage and AP cost. There must not be an observable intermediate state where the orb is destroyed but the battle is still in progress.
- Destroying a unit or wall does not end the battle by itself.
- The number or remaining health of other units does not affect the primary victory condition.

### 3.2 Explicit result in BattleState

Add a required, readonly `result` field to `BattleState`. It must explicitly represent whether the battle is in progress or finished, and retain the terminal outcome.

The conceptual model is:

```ts
export type BattleResult =
  | { readonly status: 'IN_PROGRESS' }
  | {
      readonly status: 'FINISHED';
      readonly outcome: BattleOutcome;
    };

export type BattleOutcome =
  | {
      readonly type: 'VICTORY';
      readonly winner: PlayerSide;
    }
  | {
      readonly type: 'DRAW';
    };
```

This is a conceptual contract; implementation may align names and placement with the repository's established type conventions, provided the semantics remain the same.

M8 currently produces only a `VICTORY` outcome. The `DRAW` variant is reserved to keep the result model extensible for possible future mechanics that could destroy both orbs in one action, such as skills or status effects. Do not implement draw detection or any such mechanics in M8.

### 3.3 Initial state invariants

- A newly initialized, in-progress battle must contain exactly one living orb for each player side (`LEFT` and `RIGHT`); both must have `health > 0`.
- An initial state with an orb at `0` HP, a missing side's orb, or both orbs destroyed is invalid as a new active battle. Reject it at the existing battle initialization/loading boundary rather than silently treating it as a new game.
- Do not add a broad state-validation framework solely for M8. Validate the invariants necessary to safely initialize a battle and report invalid initial state through the existing error-handling conventions.
- A finished state may contain one destroyed orb and retains both orb records. The normal M8 victory transition must not remove the destroyed orb.

## 4. Actions after battle completion

Once `BattleState.result.status === 'FINISHED'`, no further gameplay action may change the battle state.

- `MOVE` / movement execution must be rejected.
- `ATTACK` must be rejected.
- `END_TURN` must be rejected with an explicit domain error.
- Rejection must leave the input state unchanged.
- Legal-action queries must not advertise gameplay actions in a finished battle. In particular, `legalActions()` must not offer `END_TURN`, and unit-action and legal-target queries must return empty results.
- Inspection-only queries may continue to work if they do not mutate state or imply that an action can be performed.

Use an explicit domain error for attempts to act after completion (for example, `BATTLE_FINISHED`), following existing error/result conventions. Keep the change as small as possible: do not introduce a generic action framework just to share this error.

Because `endTurn()` currently returns a `BattleState` directly, adjust its contract as needed to represent rejection explicitly. Update its callers and tests consistently. Do not silently turn an invalid `END_TURN` into a no-op.

## 5. State transitions and immutability

The successful attack that destroys an orb must produce one new state that atomically includes:

- the attacker claiming the turn if it was not already claimed;
- deduction of exactly `attacker.attackActionPointCost` AP;
- target HP reduced by the existing damage formula and clamped to `0`;
- the orb retained in the state at `0` HP;
- `BattleResult` changed from `IN_PROGRESS` to `FINISHED`, with a `VICTORY` outcome and the correct winner.

The input state and its nested objects must not be mutated. A failed action must not change HP, AP, turn ownership, collections, or battle result.

The engine must not infer the winner from the UI perspective. The winner is the `PlayerSide` that owns the surviving orb; the UI only presents the result supplied by the domain.

## 6. UI requirements

### 6.1 Finished battle presentation

- Present a concise result message in Polish: `Bitwa zakończona — zwycięzca: LEFT` or `Bitwa zakończona — zwycięzca: RIGHT`, using the actual domain winner.
- Do not present `Victory` / `Defeat` based on a presumed local-player perspective. The current prototype does not have a player identity model that would make this distinction reliable.
- Keep the final board and its domain state visible. The destroyed orb should continue to use the destroyed appearance established in M7, and its HP label should show `0/maxHealth`.
- Prevent interaction from implying that gameplay actions remain available after completion. The domain is still the authority and rejects any attempted action after completion.
- Keep winner determination and terminal-state rules out of Angular components.

### 6.2 Restarting the demo battle

Add a restart control so the user can start a fresh demo battle without reloading the entire browser page.

- Restart must restore a fresh initial battle state through the existing initial-state loading/initialization path.
- Do not attempt to reverse individual actions or manually reconstruct a reset state in the UI.
- Reset all transient battle interaction state that belongs to the current battle, including selected unit, interaction mode, hover/path preview, and last-action feedback, so no stale selection or outcome remains after restart.
- Reuse the existing demo-state source and request lifecycle. Do not add a new backend endpoint, persistence, or a second independent copy of the initial battle fixture solely for restart.
- Handle loading or initialization failure through the existing store/page error conventions; do not show a successful restart before a fresh state is available.

## 7. Tests and acceptance criteria

### 7.1 Domain tests

Add or update unit tests to cover at least:

- A legal attack that reduces the opponent's orb to exactly (0) HP finishes the battle and records the attacker’s side as winner.
- The orb remains in the state at (0) HP.
- A legal attack that damages an orb but leaves it above (0) HP does not finish the battle.
- Destroying a unit or wall does not finish the battle.
- The result, target HP, AP deduction, and active-unit claim are applied atomically.
- Rejected attacks leave the input state unchanged and do not change the result.
- Movement, attack, and `END_TURN` are rejected after completion without state changes.
- Legal-action and legal-target queries expose no gameplay actions/targets after completion.
- Initialization rejects an invalid initial battle with a missing or already-destroyed orb.
- The result type can represent a draw, but M8 does not produce a draw through gameplay.

### 7.2 Store and UI tests

- The store publishes the terminal result returned by the domain.
- The result message shows the correct winner for both `LEFT` and `RIGHT`.
- The final board and destroyed-orb presentation remain visible after completion.
- Restart obtains/reinitializes a fresh demo state without a page reload.
- Restart clears stale selection, interaction mode, previews, and last-action feedback.
- A failed restart does not falsely present a fresh active battle.

### 7.3 End-to-end verification

Add or update an E2E scenario that starts from the demo battle, performs actions leading to destruction of an orb, verifies the result message and winner, and restarts the battle without a full-page reload.

Run the relevant frontend unit tests, E2E tests, lint, and build. Report actual results; do not claim checks that were not run.

## 8. API and backend impact

- Do not add a backend action endpoint or move battle rules to Java as part of M8.
- Do not add persistence, database changes, authentication, or multiplayer infrastructure.
- `BattleResult` is part of the current frontend domain state. Keep it out of the API DTO unless analysis demonstrates that the current API contract must change for the agreed scope.
- Restart should reuse the existing initial demo-state source; no new backend endpoint is expected.

## 9. Out of scope

- Implementing draw detection or mechanics that can destroy both orbs in one action.
- Skills, status effects, area-of-effect attacks, or any new combat mechanics.
- Victory/defeat relative to an authenticated or local player identity.
- Moving the authoritative engine to Java/backend.
- Persistence, multiplayer, matchmaking, authentication, or new battle APIs.
- Broad domain refactoring unrelated to battle completion.
- Balance changes or changes to existing movement/combat rules.

## 10. Implementation steps

Implement M8 in small, reviewable steps:

1. **M8.1 — Domain result and victory resolution:** add the explicit result model, resolve victory atomically on orb destruction, reject gameplay actions after completion, and test the domain.
2. **M8.2 — Store integration:** propagate the domain result and adapt store callers to explicit action errors.
3. **M8.3 — Finished-state UI and restart:** show the winner, keep the final board visible, and add restart through the existing initialization path.
4. **M8.4 — Verification and documentation:** add/update unit, store, component, and E2E tests; run relevant checks; update documentation if implementation reveals an agreed contract clarification is necessary.

## 11. Acceptance checklist

- [ ] `BattleState` explicitly records in-progress vs finished and the terminal outcome.
- [ ] Destroying the opponent's orb atomically finishes the battle and records the correct winner.
- [ ] The destroyed orb remains in the state at (0) HP.
- [ ] An invalid initial battle cannot start with a missing or destroyed orb.
- [ ] No gameplay action can change a finished battle; `END_TURN` fails explicitly.
- [ ] Legal-action queries do not advertise gameplay actions after completion.
- [ ] UI shows `Bitwa zakończona — zwycięzca: {LEFT|RIGHT}` without assuming local-player identity.
- [ ] Restart loads a fresh demo battle without reloading the page and clears transient interaction state.
- [ ] Draw remains a representable future outcome but is not implemented in M8.
- [ ] Relevant tests and frontend checks pass, with results recorded.
