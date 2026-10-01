import type { Position } from './domain/battle-state';
import { positionKey } from './domain/geometry';
import type { MovementStep, Reachability } from './domain/movement';
import { pathTo } from './domain/pathfinding';

/**
 * The path shown for a hovered destination, which is also the path a click on
 * that destination submits. Read from the engine's reachability; the steps and
 * cost are never computed here.
 */
export interface MovementPreview {
  readonly destination: Position;
  readonly steps: readonly MovementStep[];
  readonly cost: number;
}

/**
 * The canonical minimum-cost path to `destination`, or undefined when it is
 * not a destination: unreachable, or the unit's own anchor.
 */
export function toMovementPreview(
  reachability: Reachability,
  destination: Position,
): MovementPreview | undefined {
  const cell = reachability.cells.get(positionKey(destination));
  const steps = pathTo(reachability, destination);
  if (!cell?.via || !steps) {
    return undefined;
  }
  return { destination: cell.position, steps, cost: cell.cost };
}
