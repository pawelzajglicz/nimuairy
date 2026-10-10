import type { ActionType, UnitActionType } from './actions';
import type { BattleState, PlayerSide, Unit } from './battle-state';
import { samePosition } from './geometry';
import type {
  MoveUnitCommand,
  MovementError,
  MovementResult,
  Reachability,
} from './movement';
import { actionPointCost } from './movement-cost';
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
   * Validates the caller-selected path and charges its actual AP cost. It does
   * not search for or require a minimum-cost path; that is reachability's job.
   * The whole path is charged or rejected: there is no partial move.
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

    const { steps } = walked.value;
    const cost = actionPointCost(walked.value.cost);
    if (cost > unit.remainingActionPoints) {
      return err({
        type: 'INSUFFICIENT_ACTION_POINTS',
        required: cost,
        available: unit.remainingActionPoints,
      });
    }

    const moved: Unit = {
      ...unit,
      position: command.destination,
      remainingActionPoints: unit.remainingActionPoints - cost,
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
   * restores the AP of every unit of the player whose turn starts. Always
   * legal, whatever AP remain, including 0. AP are restored at turn start
   * rather than turn end, so the units of the player whose turn ends keep
   * what they have left until their owner's next turn.
   */
  endTurn(state: BattleState): BattleState {
    const nextPlayer = OPPONENT[state.currentPlayer];
    return {
      ...state,
      currentPlayer: nextPlayer,
      activeUnitId: undefined,
      units: state.units.map((unit) =>
        unit.owner === nextPlayer &&
        unit.remainingActionPoints !== unit.actionPointBudget
          ? { ...unit, remainingActionPoints: unit.actionPointBudget }
          : unit,
      ),
    };
  }

  /**
   * Minimum-cost paths from the unit's anchor to every cell within its
   * remaining AP, for highlighting and path previews. An inspection
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
        unit.remainingActionPoints,
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
 * Asks reachability rather than checking remainingActionPoints > 0: AP below
 * the cheapest step (e.g. 1 AP with movementCostFactor 2) or a boxed-in unit
 * leaves nowhere to go, and MOVE must not be reported legal when execution
 * would reject every path.
 */
function canMoveAnywhere(state: BattleState, unit: Unit): boolean {
  const { cells } = findReachable(
    movementRules(state, unit),
    unit.position,
    unit.remainingActionPoints,
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
