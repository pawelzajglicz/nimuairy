import type { BattleState, Unit } from './battle-state';
import { samePosition } from './geometry';
import type {
  MoveUnitCommand,
  MovementError,
  MovementResult,
  Reachability,
} from './movement';
import { isWithinBudget } from './movement-cost';
import { movementRules, walkPath } from './movement-rules';
import { findReachable } from './pathfinding';
import { err, ok, type Result } from './result';

/**
 * Authoritative battle rules as pure functions of the battle state: commands
 * return a new state, queries only read it. Framework-independent so it can
 * later be ported to the backend.
 */
export class BattleEngine {
  /**
   * Validates the caller-selected path and charges its actual cost. It does
   * not search for or require a minimum-cost path; that is reachability's job.
   */
  execute(
    state: BattleState,
    command: MoveUnitCommand,
  ): Result<MovementResult, MovementError> {
    const movable = movableUnit(state, command.unitId);
    if (!movable.ok) {
      return movable;
    }
    const unit = movable.value;

    const lastCell = command.path.at(-1);
    if (!lastCell) {
      return err({ type: 'INVALID_PATH', reason: 'EMPTY' });
    }
    if (!samePosition(lastCell, command.destination)) {
      return err({ type: 'INVALID_PATH', reason: 'DESTINATION_MISMATCH' });
    }

    const rules = movementRules(state, unit);
    if (!rules.canOccupy(command.destination)) {
      return err({
        type: 'INVALID_DESTINATION',
        destination: command.destination,
      });
    }

    const walked = walkPath(rules, unit.position, command.path);
    if (!walked.ok) {
      return err({ type: 'INVALID_PATH', reason: walked.error });
    }

    const { steps, cost } = walked.value;
    if (!isWithinBudget(cost, unit.remainingMovement)) {
      return err({
        type: 'INSUFFICIENT_MOVEMENT',
        required: cost,
        available: unit.remainingMovement,
      });
    }

    const moved: Unit = {
      ...unit,
      position: command.destination,
      // The budget check tolerates rounding error, so the difference can be
      // marginally negative.
      remainingMovement: Math.max(0, unit.remainingMovement - cost),
    };
    return ok({
      state: {
        ...state,
        units: state.units.map((other) =>
          other.id === unit.id ? moved : other,
        ),
      },
      steps,
      cost,
    });
  }

  /**
   * Minimum-cost paths from the unit's anchor to every cell within its
   * remaining movement, for highlighting and path previews.
   */
  reachability(
    state: BattleState,
    unitId: string,
  ): Result<Reachability, MovementError> {
    const movable = movableUnit(state, unitId);
    if (!movable.ok) {
      return movable;
    }
    const unit = movable.value;

    return ok(
      findReachable(
        movementRules(state, unit),
        unit.position,
        unit.remainingMovement,
      ),
    );
  }

  /**
   * Restores the unit's remainingMovement to its moveRange. A temporary
   * technical transition that exists only for development and manual testing
   * of movement, not a gameplay action; it goes away or is replaced once M5
   * defines how movement is restored.
   */
  resetMovement(
    state: BattleState,
    unitId: string,
  ): Result<BattleState, MovementError> {
    const movable = movableUnit(state, unitId);
    if (!movable.ok) {
      return movable;
    }
    const unit = movable.value;

    const reset: Unit = { ...unit, remainingMovement: unit.moveRange };
    return ok({
      ...state,
      units: state.units.map((other) => (other.id === unit.id ? reset : other)),
    });
  }
}

function movableUnit(
  state: BattleState,
  unitId: string,
): Result<Unit, MovementError> {
  const unit = state.units.find(({ id }) => id === unitId);
  if (!unit) {
    return err({ type: 'UNIT_NOT_FOUND', unitId });
  }
  if (unit.owner !== state.currentPlayer) {
    return err({ type: 'UNIT_CANNOT_MOVE', unitId });
  }
  return ok(unit);
}
