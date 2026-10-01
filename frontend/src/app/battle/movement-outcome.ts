import type { PlayerSide } from './domain/battle-state';
import type { MovementError, MovementStep } from './domain/movement';

/**
 * The most recent move or reset attempt of any unit, shown as one technical
 * line for manual testing. One replace-only slot, not a battle log: there is
 * no history and no per-unit record.
 */
export type LastMovementOutcome =
  | {
      readonly kind: 'MOVED';
      readonly unitId: string;
      readonly owner: PlayerSide;
      readonly steps: readonly MovementStep[];
      readonly cost: number;
    }
  | { readonly kind: 'MOVEMENT_RESET'; readonly unitId: string }
  | {
      readonly kind: 'REJECTED';
      readonly action: 'MOVE' | 'RESET';
      readonly error: MovementError;
    };
