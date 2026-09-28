import type { BattleState } from './battle-state';
import type {
  MoveUnitCommand,
  MovementError,
  MovementResult,
} from './movement';
import { err, type Result } from './result';

/**
 * Authoritative battle rules as pure `(state, command) -> result` transitions.
 * Framework-independent so it can later be ported to the backend.
 */
export class BattleEngine {
  execute(
    state: BattleState,
    command: MoveUnitCommand,
  ): Result<MovementResult, MovementError> {
    const unit = state.units.find(({ id }) => id === command.unitId);
    if (!unit) {
      return err({ type: 'UNIT_NOT_FOUND', unitId: command.unitId });
    }

    // Path validation and the state transition depend on M4.2 pathfinding
    // rules; until then no caller dispatches MOVE_UNIT.
    throw new Error('MOVE_UNIT execution is not implemented yet (M4.2).');
  }
}
