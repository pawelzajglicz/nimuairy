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
        maxHealth: 80,
        defense: 0,
      },
      {
        id: 'orb-right',
        owner: 'RIGHT',
        position: { x: 20, y: 5 },
        footprint: [{ x: 0, y: 0 }],
        health: 80,
        maxHealth: 80,
        defense: 0,
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
        maxHealth: 60,
        defense: 100,
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
        maxHealth: 12,
        attack: 4,
        defense: 2,
        actionPointBudget: 5,
        movementCostFactor: 2,
        attackActionPointCost: 3,
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
    expect(unit.attackActionPointCost).toBe(3);
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

  it('starts the battle in progress', () => {
    expect(toBattleState(response()).result).toEqual({
      status: 'IN_PROGRESS',
    });
  });

  it.each([
    ['LEFT', 'orb-left'],
    ['RIGHT', 'orb-right'],
  ])('rejects a response without a %s orb', (side, id) => {
    const incomplete = response();
    incomplete.orbs = incomplete.orbs!.filter((orb) => orb.id !== id);

    expect(() => toBattleState(incomplete)).toThrow(
      `not a valid new battle: ${side} orb MISSING`,
    );
  });

  it.each([
    ['LEFT', 0],
    ['RIGHT', 1],
  ])(
    'rejects a %s orb at 0 HP instead of starting a finished battle',
    (side, index) => {
      const destroyed = response();
      destroyed.orbs![index].health = 0;

      expect(() => toBattleState(destroyed)).toThrow(
        `not a valid new battle: ${side} orb DESTROYED`,
      );
    },
  );

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

  it.each([
    'actionPointBudget',
    'movementCostFactor',
    'attackActionPointCost',
  ] as const)('rejects a unit without %s', (field) => {
    const incomplete = response();
    delete incomplete.units![0][field];

    expect(() => toBattleState(incomplete)).toThrow(`unit.${field}`);
  });

  it('maps the maximum HP of units, walls and orbs apart from their current HP', () => {
    const state = toBattleState(response());

    expect(state.units[0]).toMatchObject({ health: 10, maxHealth: 12 });
    expect(state.walls[0]).toMatchObject({ health: 30, maxHealth: 60 });
    expect(state.orbs[0]).toMatchObject({ health: 50, maxHealth: 80 });
  });

  it.each([
    ['units', 'unit'],
    ['walls', 'wall'],
    ['orbs', 'orb'],
  ] as const)(
    'rejects %s without maxHealth instead of defaulting it',
    (collection, label) => {
      const incomplete = response();
      delete incomplete[collection]![0].maxHealth;

      expect(() => toBattleState(incomplete)).toThrow(`${label}.maxHealth`);
    },
  );

  it.each([
    ['units', 'unit', 0],
    ['walls', 'wall', -1],
    ['orbs', 'orb', 1.5],
  ] as const)(
    'rejects %s with an invalid maxHealth (%s = %s)',
    (collection, label, value) => {
      const invalid = response();
      invalid[collection]![0].maxHealth = value;

      expect(() => toBattleState(invalid)).toThrow(
        `invalid ${label}.maxHealth`,
      );
    },
  );

  // An orb at 0 HP is rejected as a destroyed orb, as tested above.
  it.each([
    ['units', 'unit'],
    ['walls', 'wall'],
  ] as const)(
    'accepts %s from 0 HP up to their maximum',
    (collection, label) => {
      for (const health of [0, 12]) {
        const atBound = response();
        atBound[collection]![0].health = health;
        atBound[collection]![0].maxHealth = 12;

        expect(
          toBattleState(atBound)[collection][0],
          `${label} at ${health}`,
        ).toMatchObject({ health, maxHealth: 12 });
      }
    },
  );

  it.each([
    ['units', 'unit', 13],
    ['walls', 'wall', -1],
    ['orbs', 'orb', 1.5],
  ] as const)(
    'rejects %s with health outside 0..maxHealth (%s.health = %s)',
    (collection, label, health) => {
      const invalid = response();
      invalid[collection]![0].health = health;
      invalid[collection]![0].maxHealth = 12;

      expect(() => toBattleState(invalid)).toThrow(`invalid ${label}.health`);
    },
  );

  it('maps the defense of walls and orbs', () => {
    const state = toBattleState(response());

    expect(state.walls[0].defense).toBe(100);
    expect(state.orbs[0].defense).toBe(0);
  });

  it.each(['walls', 'orbs'] as const)(
    'rejects %s without defense instead of defaulting it',
    (collection) => {
      const incomplete = response();
      delete incomplete[collection]![0].defense;

      expect(() => toBattleState(incomplete)).toThrow(
        `${collection.slice(0, -1)}.defense`,
      );
    },
  );

  it.each([
    ['actionPointBudget', 0],
    ['actionPointBudget', -1],
    ['actionPointBudget', 2.5],
    ['movementCostFactor', 0],
    ['movementCostFactor', -1],
    ['movementCostFactor', 1.5],
    ['attackActionPointCost', 0],
    ['attackActionPointCost', -1],
    ['attackActionPointCost', 1.5],
  ] as const)('rejects a unit with %s = %s', (field, value) => {
    const invalid = response();
    invalid.units![0][field] = value;

    expect(() => toBattleState(invalid)).toThrow(`invalid unit.${field}`);
  });

  it.each(['width', 'height'] as const)(
    'rejects a board without %s',
    (field) => {
      const incomplete = response();
      delete incomplete.board![field];

      expect(() => toBattleState(incomplete)).toThrow(`board.${field}`);
    },
  );

  it.each([
    ['width', 0],
    ['width', -1],
    ['width', 1.5],
    ['height', 0],
    ['height', -1],
    ['height', 1.5],
  ] as const)('rejects a board with %s = %s', (field, value) => {
    const invalid = response();
    invalid.board![field] = value;

    expect(() => toBattleState(invalid)).toThrow(`invalid board.${field}`);
  });

  it.each([
    [
      'a unit anchor',
      (r: BattleStateResponse) => {
        r.units![0].position!.x = 1.5;
      },
      'x',
    ],
    [
      'a footprint offset',
      (r: BattleStateResponse) => {
        r.walls![0].footprint![1].y = 0.5;
      },
      'y',
    ],
    [
      'a terrain cell',
      (r: BattleStateResponse) => {
        r.board!.terrain![1].position!.x = 2.5;
      },
      'x',
    ],
  ])('rejects a fractional coordinate in %s', (_, makeFractional, axis) => {
    const invalid = response();
    makeFractional(invalid);

    expect(() => toBattleState(invalid)).toThrow(`invalid position.${axis}`);
  });

  it('rejects a unit whose footprint leaves the board', () => {
    const invalid = response();
    invalid.units![0].position = { x: 20, y: 2 };

    expect(() => toBattleState(invalid)).toThrow(
      'not a valid new battle: UNIT left-2x2 at (21,2) is outside the 21x11 board',
    );
  });

  it('rejects a terrain cell off the board', () => {
    const invalid = response();
    invalid.board!.terrain![0].position = { x: 0, y: 11 };

    expect(() => toBattleState(invalid)).toThrow(
      'not a valid new battle: TERRAIN at (0,11) is outside the 21x11 board',
    );
  });
});
