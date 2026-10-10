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
        actionPointBudget: 5,
        movementCostFactor: 2,
      },
    ],
    currentPlayer: 'LEFT',
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

  it('maps the unit statistics and starts every unit with its full AP', () => {
    const [unit] = toBattleState(response()).units;

    expect(unit.actionPointBudget).toBe(5);
    expect(unit.movementCostFactor).toBe(2);
    expect(unit.remainingActionPoints).toBe(5);
  });

  it('maps LEFT as the current player from the response', () => {
    expect(toBattleState(response()).currentPlayer).toBe('LEFT');
  });

  it('maps RIGHT as the current player from the response', () => {
    const rightToAct = { ...response(), currentPlayer: 'RIGHT' as const };

    expect(toBattleState(rightToAct).currentPlayer).toBe('RIGHT');
  });

  it('starts the turn without an active unit', () => {
    const state = toBattleState(response());

    expect(state).toHaveProperty('activeUnitId');
    expect(state.activeUnitId).toBeUndefined();
  });

  it('rejects a response without a current player instead of defaulting it', () => {
    const incomplete = response();
    delete incomplete.currentPlayer;

    expect(() => toBattleState(incomplete)).toThrow('currentPlayer');
  });

  it('rejects a response with a missing required field', () => {
    const incomplete = response();
    delete incomplete.units![0].position;

    expect(() => toBattleState(incomplete)).toThrow('unit.position');
  });

  it.each(['actionPointBudget', 'movementCostFactor'] as const)(
    'rejects a unit without %s',
    (field) => {
      const incomplete = response();
      delete incomplete.units![0][field];

      expect(() => toBattleState(incomplete)).toThrow(`unit.${field}`);
    },
  );

  it.each([
    ['actionPointBudget', 0],
    ['actionPointBudget', -1],
    ['actionPointBudget', 2.5],
    ['movementCostFactor', 0],
    ['movementCostFactor', -1],
    ['movementCostFactor', 1.5],
  ] as const)('rejects a unit with %s = %s', (field, value) => {
    const invalid = response();
    invalid.units![0][field] = value;

    expect(() => toBattleState(invalid)).toThrow(`invalid unit.${field}`);
  });
});
