import { describe, expect, it } from 'vitest';
import type { Position, Unit } from './battle-state';
import { occupiedCells, positionKey } from './geometry';
import type { Reachability } from './movement';
import { COST_EPSILON } from './movement-cost';
import { movementRules } from './movement-rules';
import { findReachable, pathTo } from './pathfinding';
import {
  FOOTPRINTS,
  testState,
  testUnit,
  type TestStateOptions,
} from './testing/battle-fixtures';

function reachable(
  unit: Unit,
  options: TestStateOptions = {},
  budget = unit.remainingMovement,
): Reachability {
  const others = options.units ?? [];
  const state = testState({ ...options, units: [unit, ...others] });
  return findReachable(movementRules(state, unit), unit.position, budget);
}

function positions(reachability: Reachability): Position[] {
  return [...reachability.cells.values()].map(({ position }) => position);
}

function costTo(reachability: Reachability, position: Position) {
  return reachability.cells.get(positionKey(position))?.cost;
}

describe('findReachable', () => {
  it('includes the origin at zero cost with no incoming step', () => {
    const reachability = reachable(testUnit());

    expect(reachability.cells.get('2,2')).toEqual({
      position: { x: 2, y: 2 },
      cost: 0,
      via: null,
    });
    expect(pathTo(reachability, { x: 2, y: 2 })).toEqual([]);
  });

  it.each([
    { budget: 0.5, size: 1 },
    { budget: 1, size: 5 },
    { budget: 1.5, size: 9 },
    { budget: 2, size: 13 },
  ])(
    'reaches $size cells with budget $budget on an open board',
    ({ budget, size }) => {
      const unit = testUnit({ position: { x: 3, y: 3 } });

      expect(reachable(unit, {}, budget).cells.size).toBe(size);
    },
  );

  it('includes a cell whose cost exactly exhausts the budget', () => {
    const unit = testUnit({ position: { x: 3, y: 3 } });

    expect(costTo(reachable(unit, {}, 2), { x: 5, y: 3 })).toBe(2);
  });

  it('chooses the minimum-cost path', () => {
    expect(costTo(reachable(testUnit()), { x: 4, y: 3 })).toBe(1 + Math.SQRT2);
  });

  it('only records occupiable cells within the budget', () => {
    const unit = testUnit();
    const options: TestStateOptions = {
      rocks: [
        { x: 3, y: 2 },
        { x: 3, y: 3 },
        { x: 1, y: 4 },
      ],
      units: [
        testUnit({ id: 'right-1x1', owner: 'RIGHT', position: { x: 2, y: 4 } }),
      ],
    };
    const rules = movementRules(
      testState({ ...options, units: [unit, ...(options.units ?? [])] }),
      unit,
    );

    const reachability = reachable(unit, options, 3);

    for (const cell of reachability.cells.values()) {
      expect(cell.cost).toBeLessThanOrEqual(3 + COST_EPSILON);
      expect(rules.canOccupy(cell.position)).toBe(true);
    }
  });

  it('excludes cells occupied by other units', () => {
    const other = testUnit({
      id: 'right-1x1',
      owner: 'RIGHT',
      position: { x: 3, y: 2 },
    });

    expect(reachable(testUnit(), { units: [other] }).cells.has('3,2')).toBe(
      false,
    );
  });

  it('lets an obstacle force a path longer than the straight distance', () => {
    // A single ROCK at (1,0) also blocks both diagonals around it, so the
    // target two cells away costs 4 instead of 2 (or 2√2 with corner cutting).
    const unit = testUnit({ position: { x: 0, y: 0 } });
    const options = { rocks: [{ x: 1, y: 0 }] };
    const target = { x: 2, y: 0 };

    expect(pathTo(reachable(unit, options, 3), target)).toBeUndefined();

    const reachability = reachable(unit, options, 4);
    expect(costTo(reachability, target)).toBe(4);
    expect(pathTo(reachability, target)?.map(({ to }) => to)).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 0 },
    ]);
  });

  it('does not reach an enclosed cell', () => {
    const ring = [
      { x: 4, y: 4 },
      { x: 5, y: 4 },
      { x: 6, y: 4 },
      { x: 4, y: 5 },
      { x: 6, y: 5 },
      { x: 4, y: 6 },
      { x: 5, y: 6 },
      { x: 6, y: 6 },
    ];

    const reachability = reachable(testUnit(), { rocks: ring }, 20);

    expect(pathTo(reachability, { x: 5, y: 5 })).toBeUndefined();
  });

  it('stays inside the board', () => {
    const reachability = reachable(
      testUnit({ position: { x: 0, y: 0 } }),
      {},
      3,
    );

    for (const { x, y } of positions(reachability)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(8);
      expect(y).toBeLessThan(8);
    }
  });

  it('keeps a multi-cell footprint entirely on the board', () => {
    const unit = testUnit({
      position: { x: 0, y: 0 },
      footprint: FOOTPRINTS['2x2'],
    });

    const anchors = positions(reachable(unit, { width: 5, height: 5 }, 20));

    expect(anchors).toContainEqual({ x: 3, y: 3 });
    expect(anchors.every(({ x, y }) => x <= 3 && y <= 3)).toBe(true);
  });

  describe('through a barrier with a one-cell gap', () => {
    // Row y=3 is ROCK except for the gap at x=3.
    const barrier: TestStateOptions = {
      width: 7,
      height: 7,
      rocks: [0, 1, 2, 4, 5, 6].map((x) => ({ x, y: 3 })),
    };

    it('lets a 1×1 unit pass', () => {
      const unit = testUnit({ position: { x: 3, y: 1 } });

      expect(costTo(reachable(unit, barrier), { x: 3, y: 5 })).toBe(4);
    });

    it('lets a vertical 1×3 unit pass', () => {
      const unit = testUnit({
        position: { x: 3, y: 0 },
        footprint: FOOTPRINTS['1x3'],
      });

      expect(costTo(reachable(unit, barrier), { x: 3, y: 4 })).toBe(4);
    });

    it.each([
      { footprint: '2x1', position: { x: 2, y: 1 } },
      { footprint: '2x2', position: { x: 2, y: 0 } },
    ] as const)(
      'keeps a $footprint unit below the barrier',
      ({ footprint, position }) => {
        const unit = testUnit({ position, footprint: FOOTPRINTS[footprint] });

        const anchors = positions(reachable(unit, barrier, 20));

        const cells = anchors.flatMap((anchor) =>
          occupiedCells(anchor, unit.footprint),
        );
        expect(cells.every(({ y }) => y < 3)).toBe(true);
      },
    );

    it('lets a 2×2 unit pass a two-cell gap', () => {
      const unit = testUnit({
        position: { x: 3, y: 0 },
        footprint: FOOTPRINTS['2x2'],
      });
      const wideGap = {
        ...barrier,
        rocks: [0, 1, 2, 5, 6].map((x) => ({ x, y: 3 })),
      };

      expect(costTo(reachable(unit, wideGap), { x: 3, y: 4 })).toBe(4);
    });
  });

  describe('among equal-cost paths', () => {
    it('reconstructs the canonical path as steps from the origin', () => {
      // (2,2) → (4,3) costs 1 + √2 both orthogonal-first and diagonal-first;
      // the fixed neighbour order makes the orthogonal-first path canonical.
      expect(pathTo(reachable(testUnit()), { x: 4, y: 3 })).toEqual([
        { from: { x: 2, y: 2 }, to: { x: 3, y: 2 }, cost: 1 },
        { from: { x: 3, y: 2 }, to: { x: 4, y: 3 }, cost: Math.SQRT2 },
      ]);
    });

    it('produces identical results on every run', () => {
      const options = {
        rocks: [
          { x: 3, y: 3 },
          { x: 4, y: 1 },
        ],
      };

      const first = reachable(testUnit(), options);
      const second = reachable(testUnit(), options);

      expect([...second.cells.entries()]).toEqual([...first.cells.entries()]);
    });
  });
});

describe('pathTo', () => {
  it('returns undefined for a cell outside the reachable set', () => {
    expect(
      pathTo(reachable(testUnit(), {}, 1), { x: 5, y: 5 }),
    ).toBeUndefined();
  });
});
