import { describe, expect, it } from 'vitest';
import type { Position } from './battle-state';
import { attackDamage, inMeleeRange, meleeRangeCells } from './combat-rules';
import { positionKey } from './geometry';
import { FOOTPRINTS } from './testing/battle-fixtures';

/** Cells (0,0), (1,0), (0,1): the notch at (1,1) is empty. */
const L_SHAPE: readonly Position[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
];

function placed(
  position: Position,
  footprint: readonly Position[] = FOOTPRINTS['1x1'],
) {
  return { position, footprint };
}

describe('inMeleeRange', () => {
  const attacker = placed({ x: 2, y: 2 });

  it.each([
    { x: 3, y: 2 },
    { x: 1, y: 2 },
    { x: 2, y: 3 },
    { x: 2, y: 1 },
  ])('is in range of an orthogonal neighbour at %o', (position) => {
    expect(inMeleeRange(attacker, placed(position))).toBe(true);
  });

  it.each([
    { x: 3, y: 3 },
    { x: 1, y: 1 },
    { x: 3, y: 1 },
    { x: 1, y: 3 },
  ])('is out of range of a diagonal-only neighbour at %o', (position) => {
    expect(inMeleeRange(attacker, placed(position))).toBe(false);
  });

  it('is out of range one cell apart', () => {
    expect(inMeleeRange(attacker, placed({ x: 4, y: 2 }))).toBe(false);
  });

  it('compares multi-cell footprints of both attacker and target', () => {
    const square = placed({ x: 2, y: 2 }, FOOTPRINTS['2x2']);

    // (3,2) of the square touches (4,2) of the column.
    expect(
      inMeleeRange(square, placed({ x: 4, y: 1 }, FOOTPRINTS['1x3'])),
    ).toBe(true);
    // (3,3) and (4,4) meet only at a corner.
    expect(
      inMeleeRange(square, placed({ x: 4, y: 4 }, FOOTPRINTS['1x3'])),
    ).toBe(false);
  });

  it('is in range when footprints touch although the anchors are not adjacent', () => {
    const column = placed({ x: 2, y: 0 }, FOOTPRINTS['1x3']);

    expect(inMeleeRange(column, placed({ x: 3, y: 2 }))).toBe(true);
  });

  it('is out of range when the anchors are adjacent but no occupied cells share an edge', () => {
    // The target's only cell is offset from its anchor, to (4,3).
    const target = placed({ x: 3, y: 2 }, [{ x: 1, y: 1 }]);

    expect(inMeleeRange(attacker, target)).toBe(false);
  });

  it('reaches into the notch of a non-rectangular footprint', () => {
    const lShape = placed({ x: 2, y: 2 }, L_SHAPE);

    expect(inMeleeRange(lShape, placed({ x: 3, y: 3 }))).toBe(true);
    // (4,3) only meets (3,2) at a corner.
    expect(inMeleeRange(lShape, placed({ x: 4, y: 3 }))).toBe(false);
  });

  it('is symmetric', () => {
    const lShape = placed({ x: 2, y: 2 }, L_SHAPE);
    const column = placed({ x: 4, y: 0 }, FOOTPRINTS['1x3']);

    expect(inMeleeRange(lShape, column)).toBe(true);
    expect(inMeleeRange(column, lShape)).toBe(true);
  });
});

describe('attackDamage', () => {
  it("is the attacker's attack minus the target's defense", () => {
    expect(attackDamage({ attack: 200 }, { defense: 50 })).toBe(150);
  });

  it('is the full attack against 0 defense', () => {
    expect(attackDamage({ attack: 200 }, { defense: 0 })).toBe(200);
  });

  it.each([200, 250])('is 0, never negative, against defense %i', (defense) => {
    expect(attackDamage({ attack: 200 }, { defense })).toBe(0);
  });
});

describe('meleeRangeCells', () => {
  const board = { width: 6, height: 5 };

  /** Order-insensitive view of the cells, which also exposes duplicates. */
  function keys(cells: readonly Position[]): string[] {
    return cells.map(positionKey).sort();
  }

  it('is the four orthogonal neighbours of a 1x1 unit', () => {
    expect(keys(meleeRangeCells(placed({ x: 2, y: 2 }), board))).toEqual([
      '1,2',
      '2,1',
      '2,3',
      '3,2',
    ]);
  });

  it('leaves out cells beyond the board edge', () => {
    expect(keys(meleeRangeCells(placed({ x: 0, y: 0 }), board))).toEqual([
      '0,1',
      '1,0',
    ]);
    expect(keys(meleeRangeCells(placed({ x: 5, y: 4 }), board))).toEqual([
      '4,4',
      '5,3',
    ]);
  });

  it('surrounds a multi-cell footprint without its own cells or the diagonals', () => {
    const square = placed({ x: 2, y: 1 }, FOOTPRINTS['2x2']);

    expect(keys(meleeRangeCells(square, board))).toEqual(
      ['1,1', '1,2', '2,0', '2,3', '3,0', '3,3', '4,1', '4,2'].sort(),
    );
  });

  it('lists the notch of a non-rectangular footprint once', () => {
    const cells = meleeRangeCells(placed({ x: 2, y: 2 }, L_SHAPE), board);

    expect(keys(cells)).toEqual(
      ['1,2', '1,3', '2,1', '2,4', '3,1', '3,3', '4,2'].sort(),
    );
    expect(cells.filter((cell) => positionKey(cell) === '3,3')).toHaveLength(1);
  });

  it.each([
    ['1x1', placed({ x: 0, y: 2 })],
    ['2x2', placed({ x: 3, y: 0 }, FOOTPRINTS['2x2'])],
    ['1x3', placed({ x: 5, y: 1 }, FOOTPRINTS['1x3'])],
    ['L', placed({ x: 1, y: 1 }, L_SHAPE)],
  ])(
    'agrees with inMeleeRange on every board cell for a %s attacker',
    (_, attacker) => {
      const reach = new Set(keys(meleeRangeCells(attacker, board)));
      const own = new Set(
        attacker.footprint.map(({ x, y }) =>
          positionKey({
            x: attacker.position.x + x,
            y: attacker.position.y + y,
          }),
        ),
      );

      for (let x = 0; x < board.width; x++) {
        for (let y = 0; y < board.height; y++) {
          const key = positionKey({ x, y });
          if (own.has(key)) {
            expect(reach.has(key), key).toBe(false);
          } else {
            expect(reach.has(key), key).toBe(
              inMeleeRange(attacker, placed({ x, y })),
            );
          }
        }
      }
    },
  );
});
