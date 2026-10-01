import type { Position } from './battle-state';

/**
 * Cells covered by an object at `anchor`. Derived on demand rather than
 * stored, so the anchor stays the single source of truth for placement.
 */
export function occupiedCells(
  anchor: Position,
  footprint: readonly Position[],
): Position[] {
  return footprint.map((offset) => ({
    x: anchor.x + offset.x,
    y: anchor.y + offset.y,
  }));
}

/** Value key for Map/Set lookups; object positions compare by reference. */
export function positionKey(position: Position): string {
  return `${position.x},${position.y}`;
}

export function samePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y;
}
