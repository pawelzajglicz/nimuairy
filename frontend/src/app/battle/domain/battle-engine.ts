import type { ActionType, UnitActionType } from './actions';
import type { BattleState, PlayerSide, Unit } from './battle-state';
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

/** Typed as a Record so that a new PlayerSide does not compile without one. */
const OPPONENT: Record<PlayerSide, PlayerSide> = {
  LEFT: 'RIGHT',
  RIGHT: 'LEFT',
};

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
    const acting = actingUnit(state, command.unitId);
    if (!acting.ok) {
      return acting;
    }
    const unit = acting.value;

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
        // A successful move claims an unclaimed turn; for the unit that
        // already holds it this is a no-op.
        activeUnitId: unit.id,
      },
      steps,
      cost,
    });
  }

  /**
   * Hands the turn to the other player, leaves the new turn unclaimed, and
   * restores the movement of every unit of the player whose turn starts.
   * Always legal, whatever movement remains. Movement is restored at turn
   * start rather than turn end, so the units of the player whose turn ends
   * keep what they have left until their owner's next turn.
   */
  endTurn(state: BattleState): BattleState {
    const nextPlayer = OPPONENT[state.currentPlayer];
    return {
      ...state,
      currentPlayer: nextPlayer,
      activeUnitId: undefined,
      units: state.units.map((unit) =>
        unit.owner === nextPlayer && unit.remainingMovement !== unit.moveRange
          ? { ...unit, remainingMovement: unit.moveRange }
          : unit,
      ),
    };
  }

  /**
   * Minimum-cost paths from the unit's anchor to every cell within its
   * remaining movement, for highlighting and path previews. An inspection
   * query for any unit: it does not check `currentPlayer`, so it does not
   * grant permission to move; `execute` decides that.
   */
  reachability(
    state: BattleState,
    unitId: string,
  ): Result<Reachability, MovementError> {
    const found = findUnit(state, unitId);
    if (!found.ok) {
      return found;
    }
    const unit = found.value;

    return ok(
      findReachable(
        movementRules(state, unit),
        unit.position,
        unit.remainingMovement,
      ),
    );
  }

  /**
   * Action types the current player may perform in this state: END_TURN, plus
   * every unit action at least one of their units may perform.
   */
  legalActions(state: BattleState): ReadonlySet<ActionType> {
    return new Set<ActionType>([
      ...state.units.flatMap((unit) => unitActions(state, unit)),
      'END_TURN',
    ]);
  }

  /**
   * Unit action types the unit may perform in this state; empty for an
   * unknown unit, another player's unit, or a unit other than the one that
   * has claimed the turn.
   */
  legalUnitActions(
    state: BattleState,
    unitId: string,
  ): ReadonlySet<UnitActionType> {
    const unit = state.units.find(({ id }) => id === unitId);
    return new Set(unit ? unitActions(state, unit) : []);
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
    const owned = currentPlayerUnit(state, unitId);
    if (!owned.ok) {
      return owned;
    }
    const unit = owned.value;

    const reset: Unit = { ...unit, remainingMovement: unit.moveRange };
    return ok({
      ...state,
      units: state.units.map((other) => (other.id === unit.id ? reset : other)),
    });
  }
}

function unitActions(state: BattleState, unit: Unit): UnitActionType[] {
  if (!mayAct(state, unit)) {
    return [];
  }
  return canMoveAnywhere(state, unit) ? ['MOVE'] : [];
}

/**
 * The turn is the current player's and is unclaimed or claimed by this unit.
 * Both the legal-action queries and execution go through this rule, so an
 * action reported as legal is never rejected for turn-ownership reasons.
 */
function mayAct(state: BattleState, unit: Unit): boolean {
  return (
    unit.owner === state.currentPlayer &&
    (state.activeUnitId === undefined || state.activeUnitId === unit.id)
  );
}

/**
 * Asks reachability rather than checking remainingMovement > 0: a leftover
 * smaller than any step (e.g. 5 - 3√2) or a boxed-in unit leaves nowhere to
 * go, and MOVE must not be reported legal when execution would reject every
 * path.
 */
function canMoveAnywhere(state: BattleState, unit: Unit): boolean {
  const { cells } = findReachable(
    movementRules(state, unit),
    unit.position,
    unit.remainingMovement,
  );
  // The origin itself is always included at cost 0.
  return cells.size > 1;
}

function findUnit(
  state: BattleState,
  unitId: string,
): Result<Unit, MovementError> {
  const unit = state.units.find(({ id }) => id === unitId);
  return unit ? ok(unit) : err({ type: 'UNIT_NOT_FOUND', unitId });
}

function actingUnit(
  state: BattleState,
  unitId: string,
): Result<Unit, MovementError> {
  const found = findUnit(state, unitId);
  if (found.ok && !mayAct(state, found.value)) {
    return err({ type: 'UNIT_CANNOT_MOVE', unitId });
  }
  return found;
}

/**
 * Checks ownership only: the technical reset is not a gameplay action, so the
 * active-unit restriction does not apply to it.
 */
function currentPlayerUnit(
  state: BattleState,
  unitId: string,
): Result<Unit, MovementError> {
  const found = findUnit(state, unitId);
  if (found.ok && found.value.owner !== state.currentPlayer) {
    return err({ type: 'UNIT_CANNOT_MOVE', unitId });
  }
  return found;
}
