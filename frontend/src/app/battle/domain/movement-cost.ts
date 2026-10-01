import type { Position } from './battle-state';

/**
 * Tolerance for every movement-cost comparison. Sums of 1 and √2 round
 * differently depending on summation order (by ~1e-15); genuinely different
 * path costs differ by far more than this.
 */
export const COST_EPSILON = 1e-9;

/**
 * Cost of one legal step between adjacent anchors. This is the single place
 * that decides why a step costs what it does; terrain-dependent costs belong
 * here. Costs must stay positive for pathfinding to remain correct.
 */
export function stepCost(from: Position, to: Position): number {
  const diagonal = from.x !== to.x && from.y !== to.y;
  return diagonal ? Math.SQRT2 : 1;
}

export function isCheaper(cost: number, than: number): boolean {
  return cost < than - COST_EPSILON;
}

export function isWithinBudget(cost: number, budget: number): boolean {
  return cost <= budget + COST_EPSILON;
}
