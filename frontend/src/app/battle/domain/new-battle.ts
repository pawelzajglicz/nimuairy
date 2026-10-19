import type { BattleState, PlayerSide } from './battle-state';
import { err, ok, type Result } from './result';

const SIDES: readonly PlayerSide[] = ['LEFT', 'RIGHT'];

export interface NewBattleError {
  readonly type: 'INVALID_ORBS';
  readonly side: PlayerSide;
  readonly reason: 'MISSING' | 'DUPLICATE' | 'DESTROYED';
}

/**
 * Whether the state can start a new battle: each side needs exactly one
 * living orb, since destroying it is how the battle is won. Applies to
 * initialization only; a finished battle legitimately holds a destroyed orb,
 * and an initial state with one is rejected rather than treated as finished.
 */
export function validateNewBattle(
  state: BattleState,
): Result<BattleState, NewBattleError> {
  for (const side of SIDES) {
    const orbs = state.orbs.filter(({ owner }) => owner === side);
    if (orbs.length !== 1) {
      return err({
        type: 'INVALID_ORBS',
        side,
        reason: orbs.length === 0 ? 'MISSING' : 'DUPLICATE',
      });
    }
    if (orbs[0].health === 0) {
      return err({ type: 'INVALID_ORBS', side, reason: 'DESTROYED' });
    }
  }
  return ok(state);
}
