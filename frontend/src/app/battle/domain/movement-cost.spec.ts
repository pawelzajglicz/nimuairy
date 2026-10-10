import { describe, expect, it } from 'vitest';
import {
  actionPointCost,
  isCheaper,
  isWithinBudget,
  stepCost,
} from './movement-cost';

describe('stepCost', () => {
  it.each([
    { x: 3, y: 2 },
    { x: 2, y: 3 },
    { x: 1, y: 2 },
    { x: 2, y: 1 },
  ])('costs 1 for an orthogonal step to %o', (to) => {
    expect(stepCost({ x: 2, y: 2 }, to)).toBe(1);
  });

  it.each([
    { x: 3, y: 3 },
    { x: 1, y: 3 },
    { x: 1, y: 1 },
    { x: 3, y: 1 },
  ])('costs √2 for a diagonal step to %o', (to) => {
    expect(stepCost({ x: 2, y: 2 }, to)).toBe(Math.SQRT2);
  });

  it('costs the movement cost factor for an orthogonal step', () => {
    expect(stepCost({ x: 2, y: 2 }, { x: 3, y: 2 }, 1)).toBe(1);
    expect(stepCost({ x: 2, y: 2 }, { x: 3, y: 2 }, 3)).toBe(3);
  });

  it('costs the movement cost factor times √2 for a diagonal step', () => {
    expect(stepCost({ x: 2, y: 2 }, { x: 3, y: 3 }, 1)).toBe(Math.SQRT2);
    expect(stepCost({ x: 2, y: 2 }, { x: 3, y: 3 }, 3)).toBe(3 * Math.SQRT2);
  });
});

describe('actionPointCost', () => {
  it.each([
    { path: '1 orthogonal step', pathCost: 1, actionPoints: 1 },
    { path: '1 diagonal step', pathCost: Math.SQRT2, actionPoints: 2 },
    {
      path: '2 diagonal steps',
      pathCost: Math.SQRT2 + Math.SQRT2,
      actionPoints: 3,
    },
    { path: '3 orthogonal steps', pathCost: 3, actionPoints: 3 },
    {
      path: '1 diagonal step at factor 3',
      pathCost: 3 * Math.SQRT2,
      actionPoints: 5,
    },
  ])('charges $actionPoints AP for $path', ({ pathCost, actionPoints }) => {
    expect(actionPointCost(pathCost)).toBe(actionPoints);
  });

  it('rounds once for the whole path, not per step', () => {
    const diagonal = stepCost({ x: 2, y: 2 }, { x: 3, y: 3 });

    expect(actionPointCost(diagonal + diagonal)).toBe(3);
    expect(actionPointCost(diagonal) + actionPointCost(diagonal)).toBe(4);
  });

  it('does not round up a cost above an integer only by rounding error', () => {
    expect(actionPointCost(3 + 1e-12)).toBe(3);
  });

  it('rounds up a cost genuinely above an integer', () => {
    expect(actionPointCost(3.001)).toBe(4);
  });

  it('charges +0, not -0, for a zero cost', () => {
    expect(actionPointCost(0)).toBe(0);
  });
});

describe('isWithinBudget', () => {
  it('allows a cost that exactly exhausts the budget', () => {
    expect(isWithinBudget(3, 3)).toBe(true);
  });

  it('allows a cost above the budget only by rounding error', () => {
    expect(isWithinBudget(3 + 1e-12, 3)).toBe(true);
  });

  it('rejects a cost genuinely above the budget', () => {
    expect(isWithinBudget(3.001, 3)).toBe(false);
  });
});

describe('isCheaper', () => {
  it('compares genuinely different costs', () => {
    expect(isCheaper(1 + Math.SQRT2, 3)).toBe(true);
    expect(isCheaper(3, 1 + Math.SQRT2)).toBe(false);
  });

  it('treats costs that differ only by summation order as equal', () => {
    const orthogonalFirst = 1 + Math.SQRT2 + Math.SQRT2 + Math.SQRT2;
    const diagonalsFirst = Math.SQRT2 + Math.SQRT2 + Math.SQRT2 + 1;

    expect(orthogonalFirst).not.toBe(diagonalsFirst);
    expect(isCheaper(orthogonalFirst, diagonalsFirst)).toBe(false);
    expect(isCheaper(diagonalsFirst, orthogonalFirst)).toBe(false);
  });
});
