import type { Position } from './battle-state';
import { occupiedCells, positionKey } from './geometry';

interface Placed {
  readonly position: Position;
  readonly footprint: readonly Position[];
}

const ORTHOGONAL_OFFSETS: readonly Position[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** The same formula for every target type; 0 damage is a valid outcome. */
export function attackDamage(
  attacker: { readonly attack: number },
  target: { readonly defense: number },
): number {
  return Math.max(0, attacker.attack - target.defense);
}

/**
 * Melee range: some occupied cell of the attacker shares an edge with some
 * occupied cell of the target. Compares whole footprints, never just anchors,
 * so it holds for multi-cell and non-rectangular shapes; diagonal-only contact
 * is out of range.
 */
export function inMeleeRange(attacker: Placed, target: Placed): boolean {
  const targetCells = new Set(
    occupiedCells(target.position, target.footprint).map(positionKey),
  );
  return occupiedCells(attacker.position, attacker.footprint).some((cell) =>
    ORTHOGONAL_OFFSETS.some((offset) =>
      targetCells.has(
        positionKey({ x: cell.x + offset.x, y: cell.y + offset.y }),
      ),
    ),
  );
}
