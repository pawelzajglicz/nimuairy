import type { Board, Position } from './battle-state';
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
  return orthogonalNeighbours(attacker).some((cell) =>
    targetCells.has(positionKey(cell)),
  );
}

/**
 * The attacker's melee reach, for display: every board cell `inMeleeRange`
 * would accept a target on. Both read the same neighbours, so the reach shown
 * and the range that is checked cannot drift apart.
 */
export function meleeRangeCells(
  attacker: Placed,
  board: Pick<Board, 'width' | 'height'>,
): Position[] {
  return orthogonalNeighbours(attacker).filter(
    ({ x, y }) => x >= 0 && y >= 0 && x < board.width && y < board.height,
  );
}

/**
 * Cells sharing an edge with one of the object's cells, each once, in
 * footprint then offset order. Its own cells are left out: a target never
 * overlaps the attacker.
 */
function orthogonalNeighbours(placed: Placed): Position[] {
  const own = occupiedCells(placed.position, placed.footprint);
  const seen = new Set(own.map(positionKey));
  const neighbours: Position[] = [];
  for (const cell of own) {
    for (const offset of ORTHOGONAL_OFFSETS) {
      const neighbour = { x: cell.x + offset.x, y: cell.y + offset.y };
      const key = positionKey(neighbour);
      if (!seen.has(key)) {
        seen.add(key);
        neighbours.push(neighbour);
      }
    }
  }
  return neighbours;
}
