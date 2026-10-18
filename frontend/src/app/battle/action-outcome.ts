import type { PlayerSide } from './domain/battle-state';
import type { AttackError, AttackTarget } from './domain/combat';
import type { MovementError, MovementStep } from './domain/movement';

/**
 * The most recent move or attack attempt of any unit, shown as one technical
 * line for manual testing. One replace-only slot, not a battle log: there is
 * no history and no per-unit record. Every number is copied from the engine
 * result, never computed here.
 */
export type LastActionOutcome =
  | {
      readonly kind: 'MOVED';
      readonly unitId: string;
      readonly owner: PlayerSide;
      readonly steps: readonly MovementStep[];
      readonly cost: number;
    }
  | {
      readonly kind: 'ATTACKED';
      readonly unitId: string;
      readonly owner: PlayerSide;
      readonly target: AttackTarget;
      readonly damage: number;
      /** 0 means destroyed; a destroyed unit or wall is gone from the state. */
      readonly remainingHealth: number;
      readonly cost: number;
    }
  | {
      readonly kind: 'REJECTED';
      readonly action: 'MOVE';
      readonly error: MovementError;
    }
  | {
      readonly kind: 'REJECTED';
      readonly action: 'ATTACK';
      readonly error: AttackError;
    };
