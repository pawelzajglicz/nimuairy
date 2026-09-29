import { describe, expect, it } from 'vitest';
import type { BattleState, Unit } from './battle-state';
import type {
  MoveUnitCommand,
  MovementError,
  MovementResult,
  MovementStep,
} from './movement';
import { ok } from './result';

const unit: Unit = {
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
};

const state: BattleState = {
  board: { width: 21, height: 11, terrain: [] },
  orbs: [],
  walls: [],
  units: [unit],
  currentPlayer: 'LEFT',
};

describe('MoveUnitCommand', () => {
  it('carries the entered cells, excluding the start and ending at the destination', () => {
    const command: MoveUnitCommand = {
      type: 'MOVE_UNIT',
      unitId: unit.id,
      destination: { x: 4, y: 4 },
      path: [
        { x: 3, y: 3 },
        { x: 4, y: 4 },
      ],
    };

    expect(command.path).not.toContainEqual(unit.position);
    expect(command.path.at(-1)).toEqual(command.destination);
  });
});

describe('MovementResult', () => {
  it('carries the resulting state, executed steps and total cost as a successful result', () => {
    const steps: MovementStep[] = [
      { from: { x: 2, y: 3 }, to: { x: 3, y: 3 }, cost: 1 },
      { from: { x: 3, y: 3 }, to: { x: 4, y: 4 }, cost: Math.SQRT2 },
    ];

    const result = ok<MovementResult>({ state, steps, cost: 1 + Math.SQRT2 });

    expect(result).toEqual({
      ok: true,
      value: { state, steps, cost: 1 + Math.SQRT2 },
    });
  });
});

describe('MovementError', () => {
  it('is narrowed by its type to the matching details', () => {
    const error: MovementError = {
      type: 'INSUFFICIENT_MOVEMENT',
      required: 1 + Math.SQRT2,
      available: 2,
    };

    if (error.type !== 'INSUFFICIENT_MOVEMENT') {
      throw new Error('expected INSUFFICIENT_MOVEMENT');
    }
    expect(error.required).toBeGreaterThan(error.available);
  });
});
