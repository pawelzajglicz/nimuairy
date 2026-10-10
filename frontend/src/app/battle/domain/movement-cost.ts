import type { Position } from './battle-state';

/**
 * Tolerance for every movement-cost comparison. Sums of factor-weighted 1 and
 * √2 steps round differently depending on summation order (by ~1e-13 at most
 * on this board); genuinely different path costs differ by far more than this.
 */
export const COST_EPSILON = 1e-9;

/**
 * Cost of one legal step between adjacent anchors. This is the single place
 * that decides why a step costs what it does; terrain-dependent costs belong
 * here. Costs must stay positive for pathfinding to remain correct, which is
 * why `movementCostFactor` is a positive integer.
 */
export function stepCost(
  from: Position,
  to: Position,
  movementCostFactor = 1,
): number {
  const diagonal = from.x !== to.x && from.y !== to.y;
  return movementCostFactor * (diagonal ? Math.SQRT2 : 1);
}

/**
 * Integer AP charged for one MOVE, given the fractional cost of its whole
 * path. Rounding happens once per MOVE, never per step or prefix: two
 * diagonals in one MOVE cost ceil(2√2) = 3, not 2 + 2.
 */
export function actionPointCost(pathCost: number): number {
  const actionPoints = Math.ceil(pathCost - COST_EPSILON);
  // A zero cost gives Math.ceil(-COST_EPSILON) === -0; return +0 instead.
  return actionPoints === 0 ? 0 : actionPoints;
}

export function isCheaper(cost: number, than: number): boolean {
  return cost < than - COST_EPSILON;
}

export function isWithinBudget(cost: number, budget: number): boolean {
  return cost <= budget + COST_EPSILON;
}
