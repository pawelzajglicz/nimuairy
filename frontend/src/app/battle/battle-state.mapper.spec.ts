import { describe, expect, it } from 'vitest';
import type { BattleStateResponse } from '../api/generated/model';
import { toBattleState } from './battle-state.mapper';

function response(): BattleStateResponse {
  return {
    board: {
      width: 21,
      height: 11,
      terrain: [
        { position: { x: 0, y: 0 }, type: 'PLAIN' },
        { position: { x: 5, y: 4 }, type: 'ROCK' },
      ],
    },
    orbs: [
      {
        id: 'orb-left',
        owner: 'LEFT',
        position: { x: 0, y: 5 },
        footprint: [{ x: 0, y: 0 }],
        health: 50,
      },
    ],
    walls: [
      {
        id: 'wall-left',
        owner: 'LEFT',
        position: { x: 1, y: 5 },
        footprint: [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
        ],
        health: 30,
      },
    ],
    units: [
      {
        id: 'left-2x2',
        owner: 'LEFT',
        unitType: 'SWORDSMAN',
        position: { x: 3, y: 2 },
        footprint: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
          { x: 1, y: 1 },
        ],
        health: 10,
        attack: 4,
        defense: 2,
        moveRange: 5,
      },
    ],
  };
}

describe('toBattleState', () => {
  it('maps the board, objectives, structures and units', () => {
    const state = toBattleState(response());

    expect(state.board).toEqual({
      width: 21,
      height: 11,
      terrain: [
        { position: { x: 0, y: 0 }, type: 'PLAIN' },
        { position: { x: 5, y: 4 }, type: 'ROCK' },
      ],
    });
    expect(state.orbs).toEqual(response().orbs);
    expect(state.walls).toEqual(response().walls);
    expect(state.units[0]).toMatchObject(response().units![0]);
  });

  it('starts every unit with its full movement allowance', () => {
    const [unit] = toBattleState(response()).units;

    expect(unit.moveRange).toBe(5);
    expect(unit.remainingMovement).toBe(unit.moveRange);
  });

  it('rejects a response with a missing required field', () => {
    const incomplete = response();
    delete incomplete.units![0].position;

    expect(() => toBattleState(incomplete)).toThrow('unit.position');
  });
});
