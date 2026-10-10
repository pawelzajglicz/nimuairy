import { describe, expect, it } from 'vitest';
import type { Position, Unit, Wall } from './battle-state';
import { movementRules, walkPath, type MovementRules } from './movement-rules';
import {
  FOOTPRINTS,
  testState,
  testUnit,
  type TestStateOptions,
} from './testing/battle-fixtures';

/** Rules for `unit`, placed on a test board together with `options.units`. */
function rulesFor(unit: Unit, options: TestStateOptions = {}): MovementRules {
  const others = options.units ?? [];
  return movementRules(
    testState({ ...options, units: [unit, ...others] }),
    unit,
  );
}

describe('movementRules canOccupy', () => {
  it('accepts free PLAIN cells inside the board', () => {
    const rules = rulesFor(testUnit());

    expect(rules.canOccupy({ x: 0, y: 0 })).toBe(true);
    expect(rules.canOccupy({ x: 7, y: 7 })).toBe(true);
  });

  it.each([
    { x: -1, y: 0 },
    { x: 0, y: -1 },
    { x: 8, y: 0 },
    { x: 0, y: 8 },
  ])('rejects %o outside the board', (anchor) => {
    expect(rulesFor(testUnit()).canOccupy(anchor)).toBe(false);
  });

  it('rejects ROCK', () => {
    const rules = rulesFor(testUnit(), { rocks: [{ x: 4, y: 4 }] });

    expect(rules.canOccupy({ x: 4, y: 4 })).toBe(false);
  });

  it('rejects a cell without a terrain entry', () => {
    const rules = rulesFor(testUnit(), { withoutTerrain: [{ x: 4, y: 4 }] });

    expect(rules.canOccupy({ x: 4, y: 4 })).toBe(false);
  });

  it('rejects every cell of a wall footprint, not only its anchor', () => {
    const wall: Wall = {
      id: 'wall',
      owner: 'LEFT',
      position: { x: 5, y: 0 },
      footprint: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 0, y: 2 },
        { x: 1, y: 2 },
      ],
      health: 30,
    };
    const rules = rulesFor(testUnit(), { walls: [wall] });

    expect(rules.canOccupy({ x: 5, y: 0 })).toBe(false);
    expect(rules.canOccupy({ x: 6, y: 2 })).toBe(false);
    expect(rules.canOccupy({ x: 7, y: 2 })).toBe(true);
  });

  it('rejects orb cells', () => {
    const rules = rulesFor(testUnit(), {
      orbs: [
        {
          id: 'orb',
          owner: 'RIGHT',
          position: { x: 5, y: 5 },
          footprint: FOOTPRINTS['1x1'],
          health: 50,
        },
      ],
    });

    expect(rules.canOccupy({ x: 5, y: 5 })).toBe(false);
  });

  it("rejects every cell of another unit's footprint", () => {
    const other = testUnit({
      id: 'right-2x1',
      owner: 'RIGHT',
      position: { x: 5, y: 5 },
      footprint: FOOTPRINTS['2x1'],
    });
    const rules = rulesFor(testUnit(), { units: [other] });

    expect(rules.canOccupy({ x: 5, y: 5 })).toBe(false);
    expect(rules.canOccupy({ x: 6, y: 5 })).toBe(false);
  });

  it("does not treat the moving unit's own cells as obstacles", () => {
    const rules = rulesFor(testUnit({ footprint: FOOTPRINTS['2x1'] }));

    expect(rules.canOccupy({ x: 3, y: 2 })).toBe(true);
    expect(rules.canOccupy({ x: 1, y: 2 })).toBe(true);
  });

  it('requires every cell of a 2×2 footprint to be free', () => {
    const rules = rulesFor(testUnit({ footprint: FOOTPRINTS['2x2'] }), {
      rocks: [{ x: 5, y: 5 }],
    });

    expect(rules.canOccupy({ x: 4, y: 4 })).toBe(false);
    expect(rules.canOccupy({ x: 3, y: 3 })).toBe(true);
  });

  it('requires every cell of a 2×1 footprint to be inside the board', () => {
    const rules = rulesFor(testUnit({ footprint: FOOTPRINTS['2x1'] }));

    expect(rules.canOccupy({ x: 7, y: 0 })).toBe(false);
    expect(rules.canOccupy({ x: 6, y: 0 })).toBe(true);
  });

  it('requires every cell of a 1×3 footprint to be free', () => {
    const rules = rulesFor(testUnit({ footprint: FOOTPRINTS['1x3'] }), {
      rocks: [{ x: 4, y: 6 }],
    });

    expect(rules.canOccupy({ x: 4, y: 4 })).toBe(false);
    expect(rules.canOccupy({ x: 4, y: 1 })).toBe(true);
  });

  describe('in the M3.5 one-cell-wide vertical passage', () => {
    const passage: TestStateOptions = {
      width: 13,
      height: 9,
      rocks: [3, 4, 5].flatMap((y) => [
        { x: 8, y },
        { x: 10, y },
      ]),
    };

    it.each([
      { footprint: '1x1', anchors: [{ x: 9, y: 4 }], fits: true },
      { footprint: '1x3', anchors: [{ x: 9, y: 3 }], fits: true },
      {
        footprint: '2x1',
        anchors: [
          { x: 8, y: 4 },
          { x: 9, y: 4 },
        ],
        fits: false,
      },
      {
        footprint: '2x2',
        anchors: [
          { x: 8, y: 3 },
          { x: 9, y: 3 },
        ],
        fits: false,
      },
    ] as const)(
      'a $footprint unit fits: $fits',
      ({ footprint, anchors, fits }) => {
        const unit = testUnit({
          position: { x: 0, y: 0 },
          footprint: FOOTPRINTS[footprint],
        });
        const rules = rulesFor(unit, passage);

        for (const anchor of anchors) {
          expect(rules.canOccupy(anchor)).toBe(fits);
        }
      },
    );
  });
});

describe('movementRules step', () => {
  it('returns the evaluated step with its cost', () => {
    const rules = rulesFor(testUnit());

    expect(rules.step({ x: 2, y: 2 }, { x: 3, y: 2 })).toEqual({
      ok: true,
      value: { from: { x: 2, y: 2 }, to: { x: 3, y: 2 }, cost: 1 },
    });
    expect(rules.step({ x: 2, y: 2 }, { x: 3, y: 3 })).toEqual({
      ok: true,
      value: { from: { x: 2, y: 2 }, to: { x: 3, y: 3 }, cost: Math.SQRT2 },
    });
  });

  it("weights the step's cost by the unit's movement cost factor", () => {
    const rules = rulesFor(testUnit({ movementCostFactor: 3 }));

    expect(rules.step({ x: 2, y: 2 }, { x: 3, y: 2 })).toEqual({
      ok: true,
      value: { from: { x: 2, y: 2 }, to: { x: 3, y: 2 }, cost: 3 },
    });
    expect(rules.step({ x: 2, y: 2 }, { x: 3, y: 3 })).toEqual({
      ok: true,
      value: {
        from: { x: 2, y: 2 },
        to: { x: 3, y: 3 },
        cost: 3 * Math.SQRT2,
      },
    });
  });

  it.each([
    { x: 4, y: 2 },
    { x: 2, y: 2 },
    { x: 2.5, y: 2 },
    { x: Number.NaN, y: 2 },
  ])('rejects %o, which is not one of the eight neighbours', (to) => {
    expect(rulesFor(testUnit()).step({ x: 2, y: 2 }, to)).toEqual({
      ok: false,
      error: 'NOT_ADJACENT',
    });
  });

  it('rejects a step onto a position the unit cannot occupy', () => {
    const rules = rulesFor(testUnit(), { rocks: [{ x: 3, y: 2 }] });

    expect(rules.step({ x: 2, y: 2 }, { x: 3, y: 2 })).toEqual({
      ok: false,
      error: 'BLOCKED',
    });
  });

  describe('diagonal corner blocking', () => {
    const cornerBlocked = { ok: false, error: 'CORNER_BLOCKED' };

    it('allows a diagonal step when both corners are clear', () => {
      expect(rulesFor(testUnit()).step({ x: 2, y: 2 }, { x: 3, y: 3 }).ok).toBe(
        true,
      );
    });

    it('rejects a diagonal step between two blocked corners although the destination is free', () => {
      const rules = rulesFor(testUnit(), {
        rocks: [
          { x: 3, y: 2 },
          { x: 2, y: 3 },
        ],
      });

      expect(rules.step({ x: 2, y: 2 }, { x: 3, y: 3 })).toEqual(cornerBlocked);
    });

    it.each([
      { x: 3, y: 2 },
      { x: 2, y: 3 },
    ])(
      'rejects a diagonal step when only the corner %o is blocked',
      (corner) => {
        const rules = rulesFor(testUnit(), { rocks: [corner] });

        expect(rules.step({ x: 2, y: 2 }, { x: 3, y: 3 })).toEqual(
          cornerBlocked,
        );
      },
    );

    it('applies to every diagonal direction', () => {
      const rules = rulesFor(testUnit({ position: { x: 5, y: 5 } }), {
        rocks: [{ x: 4, y: 5 }],
      });

      expect(rules.step({ x: 5, y: 5 }, { x: 4, y: 4 })).toEqual(cornerBlocked);
    });

    it('treats another unit in the corner as blocking', () => {
      const other = testUnit({
        id: 'right-1x1',
        owner: 'RIGHT',
        position: { x: 3, y: 2 },
      });
      const rules = rulesFor(testUnit(), { units: [other] });

      expect(rules.step({ x: 2, y: 2 }, { x: 3, y: 3 })).toEqual(cornerBlocked);
    });

    // For each footprint moving ↗ from (2,2) to (3,3), the blockers lie outside
    // both the start and the destination footprint but inside the swept area.
    it.each([
      { footprint: '2x1', blocker: { x: 4, y: 2 } },
      { footprint: '2x1', blocker: { x: 2, y: 3 } },
      { footprint: '2x2', blocker: { x: 4, y: 2 } },
      { footprint: '2x2', blocker: { x: 2, y: 4 } },
      { footprint: '1x3', blocker: { x: 3, y: 2 } },
      { footprint: '1x3', blocker: { x: 2, y: 5 } },
    ] as const)(
      'rejects a $footprint diagonal step clipping $blocker',
      ({ footprint, blocker }) => {
        const unit = testUnit({ footprint: FOOTPRINTS[footprint] });
        const from: Position = { x: 2, y: 2 };
        const to: Position = { x: 3, y: 3 };

        expect(rulesFor(unit).step(from, to).ok).toBe(true);
        expect(rulesFor(unit, { rocks: [blocker] }).step(from, to)).toEqual(
          cornerBlocked,
        );
      },
    );

    it('rejects the M3.5 corner pair configuration', () => {
      const rules = rulesFor(testUnit({ position: { x: 9, y: 1 } }), {
        width: 12,
        height: 4,
        rocks: [
          { x: 9, y: 0 },
          { x: 10, y: 1 },
        ],
      });

      expect(rules.step({ x: 9, y: 1 }, { x: 10, y: 0 })).toEqual(
        cornerBlocked,
      );
    });
  });
});

describe('walkPath', () => {
  const origin: Position = { x: 2, y: 2 };

  it('chains steps from the origin and sums their costs', () => {
    const result = walkPath(rulesFor(testUnit()), origin, [
      { x: 3, y: 2 },
      { x: 4, y: 3 },
    ]);

    expect(result).toEqual({
      ok: true,
      value: {
        steps: [
          { from: { x: 2, y: 2 }, to: { x: 3, y: 2 }, cost: 1 },
          { from: { x: 3, y: 2 }, to: { x: 4, y: 3 }, cost: Math.SQRT2 },
        ],
        cost: 1 + Math.SQRT2,
      },
    });
  });

  it('sums the factor-weighted step costs without rounding', () => {
    const result = walkPath(
      rulesFor(testUnit({ movementCostFactor: 3 })),
      origin,
      [
        { x: 3, y: 2 },
        { x: 4, y: 3 },
      ],
    );

    expect(result.ok && result.value.cost).toBe(3 + 3 * Math.SQRT2);
  });

  it('accepts an empty path at no cost', () => {
    expect(walkPath(rulesFor(testUnit()), origin, [])).toEqual({
      ok: true,
      value: { steps: [], cost: 0 },
    });
  });

  it.each([
    {
      name: 'starts with the start position',
      path: [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ],
    },
    {
      name: 'returns to the start position',
      path: [
        { x: 3, y: 2 },
        { x: 2, y: 2 },
      ],
    },
    {
      name: 'revisits an earlier position',
      path: [
        { x: 3, y: 2 },
        { x: 3, y: 3 },
        { x: 3, y: 2 },
      ],
    },
  ])('rejects a path that $name', ({ path }) => {
    expect(walkPath(rulesFor(testUnit()), origin, path)).toEqual({
      ok: false,
      error: 'REVISITED',
    });
  });

  it('reports the first illegal step', () => {
    const rules = rulesFor(testUnit(), { rocks: [{ x: 4, y: 2 }] });

    expect(
      walkPath(rules, origin, [
        { x: 3, y: 2 },
        { x: 5, y: 2 },
      ]),
    ).toEqual({ ok: false, error: 'NOT_ADJACENT' });
    expect(
      walkPath(rules, origin, [
        { x: 3, y: 2 },
        { x: 4, y: 2 },
      ]),
    ).toEqual({ ok: false, error: 'BLOCKED' });
  });
});
