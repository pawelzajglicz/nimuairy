import type { BattleState, PlayerSide, Position } from './battle-state';
import { isOnBoard, occupiedCells } from './geometry';
import { err, ok, type Result } from './result';

const SIDES: readonly PlayerSide[] = ['LEFT', 'RIGHT'];

export type NewBattleError =
  | {
      readonly type: 'INVALID_ORBS';
      readonly side: PlayerSide;
      readonly reason: 'MISSING' | 'DUPLICATE' | 'DESTROYED';
    }
  | {
      readonly type: 'OUT_OF_BOARD';
      readonly object: 'ORB' | 'WALL' | 'UNIT';
      readonly id: string;
      readonly cell: Position;
    }
  | {
      readonly type: 'OUT_OF_BOARD';
      readonly object: 'TERRAIN';
      readonly cell: Position;
    };

/**
 * Whether the state can start a new battle: each side needs exactly one
 * living orb, since destroying it is how the battle is won, and everything
 * must lie on the board, which the engine and the board rendering take for
 * granted. Applies to initialization only; a finished battle legitimately
 * holds a destroyed orb, and an initial state with one is rejected rather
 * than treated as finished. The orbs are checked first, so a state breaking
 * both rules reports its orbs.
 */
export function validateNewBattle(
  state: BattleState,
): Result<BattleState, NewBattleError> {
  const error = invalidOrbs(state) ?? outOfBoard(state);
  return error ? err(error) : ok(state);
}

function invalidOrbs(state: BattleState): NewBattleError | undefined {
  for (const side of SIDES) {
    const orbs = state.orbs.filter(({ owner }) => owner === side);
    if (orbs.length !== 1) {
      return {
        type: 'INVALID_ORBS',
        side,
        reason: orbs.length === 0 ? 'MISSING' : 'DUPLICATE',
      };
    }
    if (orbs[0].health === 0) {
      return { type: 'INVALID_ORBS', side, reason: 'DESTROYED' };
    }
  }
  return undefined;
}

/**
 * Reports the first violation, checking orbs, walls, units, then terrain.
 * The anchor is checked as well as the occupied cells: a position identifies
 * a board cell even when the footprint does not cover it.
 */
function outOfBoard({
  board,
  orbs,
  walls,
  units,
}: BattleState): NewBattleError | undefined {
  const placed = [
    ...orbs.map((orb) => ['ORB', orb] as const),
    ...walls.map((wall) => ['WALL', wall] as const),
    ...units.map((unit) => ['UNIT', unit] as const),
  ];
  for (const [object, { id, position, footprint }] of placed) {
    const cell = [position, ...occupiedCells(position, footprint)].find(
      (candidate) => !isOnBoard(board, candidate),
    );
    if (cell) {
      return { type: 'OUT_OF_BOARD', object, id, cell };
    }
  }

  const terrainCell = board.terrain.find(
    ({ position }) => !isOnBoard(board, position),
  );
  return terrainCell
    ? { type: 'OUT_OF_BOARD', object: 'TERRAIN', cell: terrainCell.position }
    : undefined;
}
