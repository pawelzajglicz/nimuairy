/**
 * How the player currently intends to act on a selected unit.
 * Frontend-only UI concept; not part of the backend BattleState.
 */
export enum InteractionMode {
  MOVE = 'MOVE',
  ATTACK = 'ATTACK',
}
