import { describe, expect, it } from 'vitest';
import type { BattleState } from './battle-state';
import { BattleEngine } from './battle-engine';

const state: BattleState = {
  board: { width: 21, height: 11, terrain: [] },
  orbs: [],
  walls: [],
  units: [
    {
      id: 'left-1x1',
      owner: 'LEFT',
      unitType: 'SWORDSMAN',
      position: { x: 2, y: 3 },
      footprint: [{ x: 0, y: 0 }],
      health: 10,
      attack: 4,
      defense: 2,
      moveRange: 5,
      remainingMovement: 5,
    },
  ],
};

describe('BattleEngine MOVE_UNIT', () => {
  it('rejects an unknown unit without changing the state', () => {
    const before = structuredClone(state);

    const result = new BattleEngine().execute(state, {
      type: 'MOVE_UNIT',
      unitId: 'missing',
      destination: { x: 3, y: 3 },
      path: [{ x: 3, y: 3 }],
    });

    expect(result).toEqual({
      ok: false,
      error: { type: 'UNIT_NOT_FOUND', unitId: 'missing' },
    });
    expect(state).toEqual(before);
  });
});
