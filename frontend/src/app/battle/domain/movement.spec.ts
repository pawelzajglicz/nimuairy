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
  actionPointBudget: 5,
  movementCostFactor: 1,
  remainingActionPoints: 5,
};

const state: BattleState = {
  board: { width: 21, height: 11, terrain: [] },
  orbs: [],
  walls: [],
  units: [unit],
  currentPlayer: 'LEFT',
  activeUnitId: undefined,
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
  it('carries the resulting state, fractional executed steps and integer AP charged as a successful result', () => {
    const steps: MovementStep[] = [
      { from: { x: 2, y: 3 }, to: { x: 3, y: 3 }, cost: 1 },
      { from: { x: 3, y: 3 }, to: { x: 4, y: 4 }, cost: Math.SQRT2 },
    ];

    const result = ok<MovementResult>({ state, steps, cost: 3 });

    expect(result).toEqual({
      ok: true,
      value: { state, steps, cost: 3 },
    });
  });
});

describe('MovementError', () => {
  it('is narrowed by its type to the matching details', () => {
    const error: MovementError = {
      type: 'INSUFFICIENT_ACTION_POINTS',
      required: 3,
      available: 2,
    };

    if (error.type !== 'INSUFFICIENT_ACTION_POINTS') {
      throw new Error('expected INSUFFICIENT_ACTION_POINTS');
    }
    expect(error.required).toBeGreaterThan(error.available);
  });
});
