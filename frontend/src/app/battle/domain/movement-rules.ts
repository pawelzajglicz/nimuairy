import type { BattleState, Position, TerrainType, Unit } from './battle-state';
import { occupiedCells, positionKey } from './geometry';
import type {
  InvalidPathReason,
  MovementStep,
  StepViolation,
} from './movement';
import { stepCost } from './movement-cost';
import { err, ok, type Result } from './result';

/**
 * Terrain a standard ground unit may stand on. Typed as a Record so that a new
 * TerrainType does not compile until its traversability is decided.
 */
const STANDARD_TRAVERSABLE: Record<TerrainType, boolean> = {
  PLAIN: true,
  ROCK: false,
};

/**
 * Movement questions for one unit in one battle state. Pathfinding and path
 * validation both go through these rules, so every path reachability offers
 * is also accepted by execution.
 */
export interface MovementRules {
  /** Whether the unit's complete footprint fits at `anchor`. */
  canOccupy(anchor: Position): boolean;
  /** The step from `from` to `to`, or why the unit cannot take it. */
  step(from: Position, to: Position): Result<MovementStep, StepViolation>;
}

/**
 * Builds the obstacle lookup once, so the many questions asked during a search
 * are cheap.
 */
export function movementRules(state: BattleState, unit: Unit): MovementRules {
  const { width, height } = state.board;
  const terrain = new Map(
    state.board.terrain.map((cell) => [positionKey(cell.position), cell.type]),
  );
  // Only the moving unit changes position, so it is never an obstacle to
  // itself; everything else stays where it is for the whole move.
  const blocked = new Set(
    [
      ...state.walls,
      ...state.orbs,
      ...state.units.filter(({ id }) => id !== unit.id),
    ]
      .flatMap(({ position, footprint }) => occupiedCells(position, footprint))
      .map(positionKey),
  );

  const isFree = (cell: Position): boolean => {
    if (cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= height) {
      return false;
    }
    const key = positionKey(cell);
    const type = terrain.get(key);
    // A cell without terrain is treated as blocked rather than assumed PLAIN.
    return (
      type !== undefined && STANDARD_TRAVERSABLE[type] && !blocked.has(key)
    );
  };

  const canOccupy = (anchor: Position): boolean =>
    occupiedCells(anchor, unit.footprint).every(isFree);

  return {
    canOccupy,
    step(from, to) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      if (!isUnitOffset(dx) || !isUnitOffset(dy) || (dx === 0 && dy === 0)) {
        return err('NOT_ADJACENT');
      }
      if (!canOccupy(to)) {
        return err('BLOCKED');
      }
      // A diagonal move sweeps the footprint across both orthogonal
      // neighbours, so both must be clear: no cutting corners, whatever the
      // footprint's size.
      if (
        dx !== 0 &&
        dy !== 0 &&
        !(
          canOccupy({ x: from.x + dx, y: from.y }) &&
          canOccupy({ x: from.x, y: from.y + dy })
        )
      ) {
        return err('CORNER_BLOCKED');
      }
      return ok({ from, to, cost: stepCost(from, to) });
    },
  };
}

/**
 * Validates a caller-selected path from `origin` and totals its cost. Any
 * legal simple path is accepted; it does not have to be a minimum-cost path.
 */
export function walkPath(
  rules: MovementRules,
  origin: Position,
  path: readonly Position[],
): Result<
  { readonly steps: readonly MovementStep[]; readonly cost: number },
  InvalidPathReason
> {
  const visited = new Set([positionKey(origin)]);
  const steps: MovementStep[] = [];
  let cost = 0;
  let from = origin;

  for (const to of path) {
    const key = positionKey(to);
    if (visited.has(key)) {
      return err('REVISITED');
    }
    visited.add(key);

    const step = rules.step(from, to);
    if (!step.ok) {
      return step;
    }
    steps.push(step.value);
    cost += step.value.cost;
    from = to;
  }

  return ok({ steps, cost });
}

/** Exact comparison also rejects fractional and NaN offsets. */
function isUnitOffset(delta: number): boolean {
  return delta === -1 || delta === 0 || delta === 1;
}
