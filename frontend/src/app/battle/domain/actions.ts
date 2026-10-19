/**
 * Gameplay action types the engine reports as legal. A unit action is
 * performed by one unit and is subject to the turn's active-unit restriction;
 * END_TURN belongs to the player, not to a unit. Selecting a unit is UI state,
 * not an action.
 */
export type UnitActionType = 'MOVE' | 'ATTACK';

export type ActionType = UnitActionType | 'END_TURN';

/** How every gameplay action is rejected once the battle has finished. */
export interface BattleFinishedError {
  readonly type: 'BATTLE_FINISHED';
}
