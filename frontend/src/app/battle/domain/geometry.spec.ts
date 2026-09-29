import { describe, expect, it } from 'vitest';
import { occupiedCells, positionKey, samePosition } from './geometry';

describe('occupiedCells', () => {
  it('returns the anchor itself for a one-cell footprint', () => {
    expect(occupiedCells({ x: 3, y: 2 }, [{ x: 0, y: 0 }])).toEqual([
      { x: 3, y: 2 },
    ]);
  });

  it('offsets every footprint cell from the anchor', () => {
    expect(
      occupiedCells({ x: 1, y: 0 }, [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ]),
    ).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);
  });
});

describe('positionKey', () => {
  it('produces equal keys for equal positions', () => {
    expect(positionKey({ x: 4, y: 7 })).toBe(positionKey({ x: 4, y: 7 }));
  });

  it('produces distinct keys for distinct positions', () => {
    expect(positionKey({ x: 1, y: 12 })).not.toBe(positionKey({ x: 11, y: 2 }));
  });
});

describe('samePosition', () => {
  it('compares positions by coordinates', () => {
    expect(samePosition({ x: 2, y: 3 }, { x: 2, y: 3 })).toBe(true);
    expect(samePosition({ x: 2, y: 3 }, { x: 3, y: 2 })).toBe(false);
  });
});
