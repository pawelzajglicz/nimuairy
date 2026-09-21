import { describe, expect, it } from 'vitest';
import { footprintPositions, positionKey } from './footprint';

describe('footprintPositions', () => {
  it('returns the anchor itself for a one-cell footprint', () => {
    expect(footprintPositions({ x: 3, y: 2 }, [{ x: 0, y: 0 }])).toEqual([
      { x: 3, y: 2 },
    ]);
  });

  it('offsets every footprint cell from the anchor', () => {
    expect(
      footprintPositions({ x: 1, y: 0 }, [
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

  it('returns no positions for a missing footprint', () => {
    expect(footprintPositions({ x: 3, y: 2 }, undefined)).toEqual([]);
  });
});

describe('positionKey', () => {
  it('produces distinct keys for distinct positions', () => {
    expect(positionKey({ x: 1, y: 12 })).not.toBe(positionKey({ x: 11, y: 2 }));
  });
});
