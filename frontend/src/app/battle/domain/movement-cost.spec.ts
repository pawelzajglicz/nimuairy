import { describe, expect, it } from 'vitest';
import { isCheaper, isWithinBudget, stepCost } from './movement-cost';

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
