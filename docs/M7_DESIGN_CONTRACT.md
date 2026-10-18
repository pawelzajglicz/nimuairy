# M7 Design Contract — Combat / Attacks

## 1. Purpose and scope

M7 introduces the first combat action to the existing turn-based battle domain. The battle rules continue to run in the frontend `BattleEngine`; the backend continues to provide the initial battle state. This milestone does not move the engine to the backend or introduce persistence/networked actions.

This contract records the agreed gameplay rules and implementation constraints.

## 2. Existing turn and Action Point rules

M7 preserves the M5/M6 turn model:

- Only `BattleState.currentPlayer` may perform gameplay actions.
- At the start of a turn there is no active unit. The first successful unit action claims the turn by setting `activeUnitId`.
- Once claimed, only that active unit may perform actions until `END_TURN`.
- A failed action does not claim the turn and must not change battle state.
- `END_TURN` remains the only way to end a turn. Having 0 AP does not end it.
- All actions use `remainingActionPoints`; AP are restored to `actionPointBudget` for the incoming player's units when their turn starts.
- Selection in the UI does not grant the right to act.

## 3. M7 attack rules

### 3.1 Action and cost

- Introduce an `ATTACK` unit action in the existing domain/action model.
- A successful attack costs exactly **2 AP**.
- An attack is legal only if the acting unit may act under the existing turn rules, has at least 2 AP, and has a valid target in attack range.
- An attack that deals 0 damage is still legal and consumes 2 AP.
- A rejected attack consumes no AP and has no other side effects.

### 3.2 Valid targets

M7 supports attacks against:
- enemy units;
- the enemy orb;
- the enemy wall.

Friendly units, the attacker's own orb/wall, and other non-target objects are not valid targets. Walls are destructible combat structures in M7 because they protect the orbs and must be destroyed to allow units to reach them.

### 3.3 Range and footprint

- M7 implements melee attacks only; ranged attacks and area-of-effect attacks remain out of scope.
- The attacker and target are in range when at least one cell occupied by the attacker shares an edge with at least one cell occupied by the target.
- Diagonal-only contact does not count as in range.
- Range checks use the full footprints of both objects, not only their anchor positions.
- The target must be present in the current battle state and must be an eligible enemy target.
- Walls block movement according to the existing movement rules while present. Once a wall is destroyed and removed from the battle state, its cells must no longer block movement.

### 3.4 Damage and hit points

Damage is calculated using the same formula for units, walls, and orbs:

`damage = max(0, attacker.attack - target.defense)`

- A damage result of 0 is valid; it does not make an otherwise valid attack illegal.
- HP must never fall below 0.
- A successful attack applies damage and deducts AP atomically in one new state.
- Failed execution leaves the input state unchanged.
- All attackable target types (`Unit`, `Wall`, and `Orb`) expose a `defense` statistic and use the same damage formula; the engine does not special-case the target type when calculating damage.
- Walls have their own `defense` statistic. The initial demo wall values are **1000 HP** and **100 defense**.
- Orbs have their own `defense` statistic, set to **0** in the initial demo battle. This makes orb damage equal to the attacker's `attack` value without a special-case formula.
- These are provisional MVP values. Balance tuning for walls, units, and orbs is intentionally deferred until after the MVP; do not introduce a separate balancing task within M7.

### 3.5 Destruction and victory boundary

- A unit whose HP reaches 0 is removed from the battle state's unit collection.
- A wall whose HP reaches 0 is removed from the battle state's wall/structure collection. Its footprint no longer blocks movement.
- An orb remains in the battle state when its HP reaches 0, so M8 can detect that it has been destroyed and determine the winner. Do not remove the orb.
- M7 does not implement battle completion, winner determination, or victory UI; these belong to M8.
- In the UI, an orb with 0 HP is rendered in a destroyed appearance: rotated by 45 degrees and desaturated/greyed out. This is presentation only; its HP remains the domain source of truth for destruction.

## 4. Validation, errors, and legal actions

Attack validation belongs in the battle domain/engine, not in Angular components or the store. The legality query and execution path must use the same rules.

The engine must reject an attack when any required condition fails, including:
- attacker does not exist;
- attacker cannot act because it is not owned by the current player or another unit has already claimed the turn;
- target does not exist;
- target is not an eligible enemy unit, wall, or orb;
- target is not in orthogonal melee range;
- attacker has fewer than 2 AP.

Use explicit attack-domain errors rather than reusing movement-specific errors. Align exact error discriminants and payloads with existing error/result conventions during implementation. Candidate distinctions are `UNIT_NOT_FOUND`, `UNIT_CANNOT_ATTACK`, `TARGET_NOT_FOUND`, `INVALID_TARGET`, `TARGET_OUT_OF_RANGE`, and `INSUFFICIENT_ACTION_POINTS { required, available }`. Avoid duplicate variants if existing shared errors clearly express the same condition.

`ATTACK` should appear in legal actions only when the unit may act and at least one valid target is attackable with its remaining AP. The domain should expose legal attack targets through a query that UI can consume; the UI must not reimplement targeting, range, damage, or AP legality.

## 5. State transition and immutability

A successful attack must produce one new battle state that atomically includes:
- the attacker claiming the turn if it was not already claimed;
- deduction of exactly 2 AP from the attacker;
- target HP reduced by the calculated damage, clamped to 0;
- target destruction handling when HP reaches 0, according to the target-specific rules in §3.5.

The input state and its nested objects must not be mutated. On failure, the engine returns a domain error and the caller retains the unchanged input state. No partial damage, AP deduction, active-unit claim, or structure removal is allowed on failure.

The result should expose enough domain information for the UI/store to present the attack outcome without duplicating combat calculations. Prefer existing result conventions; do not introduce a generic combat framework solely for M7.

## 6. UI requirements

- Add an attack interaction mode consistent with existing movement/selection patterns.
- The UI presents only targets supplied by the domain's legal-target query.
- A successful attack updates the rendered HP/AP from the resulting battle state and visibly highlights the attacked target.
- Display the result using domain outcome data; the UI must not calculate damage or decide legality.
- Support selecting a wall as an attack target and reflect its destruction in the board rendering.
- Render an orb with 0 HP rotated 45 degrees and greyed out. Do not infer destruction solely from UI state.
- Do not add victory/winner UI in M7; that belongs to M8.
- Keep the SignalStore as the state-management boundary. It orchestrates calls to the domain and stores results but contains no battle rules.

## 7. API and backend impact

The current architecture and M6 contract keep battle actions and transient turn state in the frontend domain. M7 does not add backend action endpoints, persistence, database changes, or `remainingActionPoints`/`activeUnitId` to the API.

Add `defense` to the wall and orb models and DTOs: the initial demo walls use 1000 HP / 100 defense, and the initial demo orbs use defense 0. Keep DTO and generated frontend client changes in the same implementation step and regenerate generated API code rather than editing it manually.

## 8. Out of scope

- Ranged attacks, line-of-sight rules, area attacks, damage types, critical hits, status effects, and special abilities.
- Full victory/loss resolution and victory UI (M8).
- Moving the authoritative engine to Java/backend, networking, persistence, or a database.
- Broad combat abstractions or unrelated refactoring.
- Changes to existing movement and turn rules beyond what is strictly required for destroyed walls to stop blocking movement.
- Balancing wall or unit statistics; current values are provisional until after MVP.

## 9. Proposed implementation steps

### M7.1 — Finalize rules and contract (completed)

The current model was inspected before implementation. The required changes are now explicit:

- Add `defense` to the backend `Wall` and `Orb` records, their `WallDto`/`OrbDto`, the frontend domain models, and mapper.
- Initialize demo walls with **1000 HP / 100 defense** (the current demo has 1500 HP and no defense field).
- Initialize demo orbs with **0 defense** (the current model has no orb defense field).
- Update the committed OpenAPI snapshot and regenerate the Orval client; do not edit generated files by hand.
- Extend backend service/controller tests, mapper/fixtures and domain tests to assert the new statistics and destruction rules.
- Keep units, walls, orbs as separate domain types; do not introduce a generic target hierarchy unless implementation demonstrates a concrete need.
- Remove a unit or wall from its collection when HP reaches 0. Keep an orb in state at 0 HP for M8 to resolve victory.
- The current entity layer only emits clicks for units. M7.4 must also enable targeting walls and orbs in ATTACK mode, without making those objects selectable as units in MOVE mode.

No database or persistence change is needed. Damage calculation remains one formula for every target type.

**Exit criteria met:** target statistics, target destruction behavior, state model implications and API/code-generation touchpoints are unambiguous.

### M7.2 — Combat domain and engine
Add attack command/action, validation, range/footprint checks, damage calculation, AP consumption, destruction behavior, domain errors and result. Add focused unit tests.

**Exit criteria:** deterministic tests cover successful attacks, 0 damage, insufficient AP, invalid targets, out-of-range targets, footprint adjacency, destruction, atomicity and immutability.

### M7.3 — Legal actions and target query
Integrate ATTACK into legal actions and expose valid attack targets using the same rules as execution.

**Exit criteria:** every target offered by the domain can be attacked successfully from the same state, and illegal targets are never offered.

### M7.4 — UI integration
Add attack mode and target interaction, wire the store, display AP/HP/outcome, highlight the target, and render destroyed units/walls and the destroyed orb correctly.

**Exit criteria:** UI consumes domain decisions and does not duplicate combat rules.

### M7.5 — Verification and close-out
Run relevant frontend unit/component tests, backend tests if DTOs change, build/lint and Playwright regression tests. Update `BATTLE_PLAN.md` with completed steps and final scope.

**Exit criteria:** all acceptance criteria pass, movement/turn regressions are absent, and documentation matches the implementation.

## 10. Acceptance criteria

1. A successful attack costs exactly 2 AP.
2. An attack requires at least 2 AP; insufficient AP leaves state unchanged.
3. Only the current player and the active unit (if claimed) may attack.
4. A successful first action claims the turn; a failed attack does not.
5. Targets are enemy units, the enemy wall, or the enemy orb only.
6. Range requires orthogonal edge contact between occupied footprint cells; diagonal-only contact is insufficient.
7. Damage uses `max(0, attacker.attack - target.defense)` and can be 0; zero-damage attacks remain legal.
8. HP is clamped at 0 and never becomes negative.
9. A unit is removed at 0 HP; a wall is removed at 0 HP; an orb remains present at 0 HP for M8 to resolve victory.
10. Initial demo walls have 1000 HP and 100 defense; initial demo orbs have defense 0. These values are provisional until after MVP.
11. A successful attack updates AP and target state atomically in an immutable transition.
12. Attack legality and execution share the same domain rules; UI does not calculate legality or damage.
13. ATTACK is offered only when at least one valid target can be attacked with available AP.
14. Destroyed walls no longer block movement.
15. An orb with 0 HP is rendered rotated by 45 degrees and greyed out, while remaining in domain state.
16. M7 does not implement full victory resolution or victory UI.
17. Existing movement and turn behavior continues to pass regression tests.
