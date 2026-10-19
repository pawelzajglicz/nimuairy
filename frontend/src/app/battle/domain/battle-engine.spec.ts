import { describe, expect, it } from 'vitest';
import type { BattleState, Position, Unit } from './battle-state';
import { BattleEngine } from './battle-engine';
import type {
  AttackCommand,
  AttackError,
  AttackResult,
  AttackTarget,
} from './combat';
import type {
  MoveUnitCommand,
  MovementError,
  MovementResult,
} from './movement';
import { occupiedCells, positionKey } from './geometry';
import { pathTo } from './pathfinding';
import {
  FOOTPRINTS,
  testOrb,
  testState,
  testUnit,
  testWall,
  type TestStateOptions,
} from './testing/battle-fixtures';

const engine = new BattleEngine();

/** A MOVE_UNIT for the default `left-1x1` unit, ending at the path's last cell. */
function moveCommand(
  path: readonly Position[],
  overrides: Partial<MoveUnitCommand> = {},
): MoveUnitCommand {
  return {
    type: 'MOVE_UNIT',
    unitId: 'left-1x1',
    destination: path[path.length - 1],
    path,
    ...overrides,
  };
}

function stateWith(unit: Unit, options: TestStateOptions = {}): BattleState {
  return testState({ ...options, units: [unit, ...(options.units ?? [])] });
}

function expectMoved(
  state: BattleState,
  command: MoveUnitCommand,
): MovementResult {
  const result = engine.execute(state, command);
  if (!result.ok) {
    throw new Error(
      `expected a successful move, got ${JSON.stringify(result.error)}`,
    );
  }
  return result.value;
}

function expectRejected(
  state: BattleState,
  command: MoveUnitCommand,
  error: MovementError,
): void {
  const before = structuredClone(state);

  expect(engine.execute(state, command)).toEqual({ ok: false, error });
  expect(state).toEqual(before);
}

function unitIn(state: BattleState, id = 'left-1x1'): Unit | undefined {
  return state.units.find((unit) => unit.id === id);
}

describe('BattleEngine MOVE_UNIT', () => {
  it('moves the unit along the submitted path and charges its AP cost', () => {
    const command = moveCommand([
      { x: 3, y: 2 },
      { x: 4, y: 3 },
    ]);

    const result = expectMoved(testState(), command);

    expect(result.steps).toEqual([
      { from: { x: 2, y: 2 }, to: { x: 3, y: 2 }, cost: 1 },
      { from: { x: 3, y: 2 }, to: { x: 4, y: 3 }, cost: Math.SQRT2 },
    ]);
    expect(result.steps.map(({ to }) => to)).toEqual(command.path);
    expect(result.cost).toBe(3);
    expect(unitIn(result.state)).toMatchObject({
      position: { x: 4, y: 3 },
      actionPointBudget: 5,
      remainingActionPoints: 2,
    });
  });

  it('applies the new position, the AP deduction and the turn claim together in one new state', () => {
    const state = testState();
    const before = structuredClone(state);

    const { state: next } = expectMoved(
      state,
      moveCommand([
        { x: 3, y: 2 },
        { x: 4, y: 3 },
      ]),
    );

    expect({
      position: unitIn(next)?.position,
      remainingActionPoints: unitIn(next)?.remainingActionPoints,
      activeUnitId: next.activeUnitId,
    }).toEqual({
      position: { x: 4, y: 3 },
      remainingActionPoints: 2,
      activeUnitId: 'left-1x1',
    });
    expect(state).toEqual(before);
    expect(state.activeUnitId).toBeUndefined();
  });

  it('charges the summed cost of every step, rounded up once', () => {
    const result = expectMoved(
      testState(),
      moveCommand([
        { x: 3, y: 2 },
        { x: 4, y: 2 },
        { x: 5, y: 3 },
      ]),
    );

    expect(result.cost).toBe(4);
  });

  it('rounds once per MOVE, not per step: two diagonals cost 3 AP', () => {
    const result = expectMoved(
      testState(),
      moveCommand([
        { x: 3, y: 3 },
        { x: 4, y: 4 },
      ]),
    );

    expect(result.cost).toBe(3);
    expect(unitIn(result.state)?.remainingActionPoints).toBe(2);
  });

  it.each([
    { factor: 3, path: [{ x: 3, y: 2 }], cost: 3 },
    { factor: 3, path: [{ x: 3, y: 3 }], cost: 5 },
  ])(
    'weights every step by the movement cost factor: $cost AP at factor $factor',
    ({ factor, path, cost }) => {
      const unit = testUnit({ movementCostFactor: factor });

      const result = expectMoved(stateWith(unit), moveCommand(path));

      expect(result.cost).toBe(cost);
      expect(unitIn(result.state)?.remainingActionPoints).toBe(5 - cost);
    },
  );

  it('allows a move that exactly exhausts the remaining AP', () => {
    const state = testState({
      units: [testUnit({ actionPointBudget: 3, remainingActionPoints: 3 })],
    });

    const result = expectMoved(
      state,
      moveCommand([
        { x: 3, y: 2 },
        { x: 4, y: 2 },
        { x: 5, y: 2 },
      ]),
    );

    expect(unitIn(result.state)?.remainingActionPoints).toBe(0);
  });

  it('charges the AP cost of a path that exactly exhausts the remaining AP, whatever its fractional cost', () => {
    // 1 + 3√2 ≈ 5.24 rounds up to exactly the 6 AP the unit has left.
    const unit = testUnit({ actionPointBudget: 6, remainingActionPoints: 6 });

    const result = expectMoved(
      testState({ units: [unit] }),
      moveCommand([
        { x: 3, y: 3 },
        { x: 4, y: 4 },
        { x: 5, y: 5 },
        { x: 6, y: 5 },
      ]),
    );

    expect(result.cost).toBe(6);
    expect(unitIn(result.state)?.remainingActionPoints).toBe(0);
  });

  it('rejects a path whose AP cost exceeds the remaining AP, without moving along its affordable prefix', () => {
    const state = testState({
      units: [testUnit({ remainingActionPoints: 2 })],
    });

    expectRejected(
      state,
      moveCommand([
        { x: 3, y: 2 },
        { x: 4, y: 2 },
        { x: 5, y: 3 },
      ]),
      { type: 'INSUFFICIENT_ACTION_POINTS', required: 4, available: 2 },
    );
  });

  it('rejects any move at 0 AP', () => {
    const state = testState({
      units: [testUnit({ remainingActionPoints: 0 })],
    });

    expectRejected(state, moveCommand([{ x: 3, y: 2 }]), {
      type: 'INSUFFICIENT_ACTION_POINTS',
      required: 1,
      available: 0,
    });
  });

  it('accepts a valid path that is not minimal and charges its actual AP cost', () => {
    // The minimum cost to (3,2) is 1 AP; the caller chose a detour via (2,3).
    const result = expectMoved(
      testState(),
      moveCommand([
        { x: 2, y: 3 },
        { x: 3, y: 2 },
      ]),
    );

    expect(result.cost).toBe(3);
    expect(unitIn(result.state)?.remainingActionPoints).toBe(2);
  });

  it.each([
    [
      { x: 3, y: 2 },
      { x: 4, y: 3 },
    ],
    [
      { x: 3, y: 3 },
      { x: 4, y: 3 },
    ],
  ])('accepts each of several equal-cost paths: %o then %o', (...path) => {
    expect(expectMoved(testState(), moveCommand(path)).cost).toBe(3);
  });

  it('changes only the moved unit and leaves the input state untouched', () => {
    const other = testUnit({
      id: 'right-1x1',
      owner: 'RIGHT',
      position: { x: 6, y: 6 },
    });
    const state = testState({
      units: [testUnit(), other],
      walls: [
        {
          id: 'wall',
          owner: 'LEFT',
          position: { x: 0, y: 7 },
          footprint: FOOTPRINTS['2x1'],
          health: 30,
          defense: 100,
        },
      ],
      orbs: [
        {
          id: 'orb',
          owner: 'RIGHT',
          position: { x: 7, y: 0 },
          footprint: FOOTPRINTS['1x1'],
          health: 50,
          defense: 0,
        },
      ],
    });
    const before = structuredClone(state);
    const original = state.units[0];

    const result = expectMoved(state, moveCommand([{ x: 3, y: 3 }]));

    expect(state).toEqual(before);
    expect(result.state).not.toBe(state);
    expect(result.state.board).toBe(state.board);
    expect(result.state.walls).toBe(state.walls);
    expect(result.state.orbs).toBe(state.orbs);
    expect(result.state.currentPlayer).toBe(state.currentPlayer);
    expect(unitIn(result.state, 'right-1x1')).toBe(other);

    const moved = unitIn(result.state);
    expect(moved).not.toBe(original);
    expect({
      ...moved,
      position: original.position,
      remainingActionPoints: original.remainingActionPoints,
    }).toEqual(original);
  });

  describe('repeated movement', () => {
    const firstMove = moveCommand([
      { x: 3, y: 2 },
      { x: 4, y: 2 },
    ]);

    it('evaluates each move from the new position against the remaining AP', () => {
      const first = expectMoved(testState(), firstMove);
      const second = expectMoved(first.state, moveCommand([{ x: 5, y: 3 }]));

      expect(unitIn(first.state)?.remainingActionPoints).toBe(3);
      expect(unitIn(second.state)).toMatchObject({
        position: { x: 5, y: 3 },
        actionPointBudget: 5,
        remainingActionPoints: 1,
      });
    });

    it('rounds each MOVE on its own, so split MOVEs can cost more than one', () => {
      const single = expectMoved(
        testState(),
        moveCommand([
          { x: 3, y: 3 },
          { x: 4, y: 4 },
        ]),
      );
      const first = expectMoved(testState(), moveCommand([{ x: 3, y: 3 }]));
      const second = expectMoved(first.state, moveCommand([{ x: 4, y: 4 }]));

      expect(single.cost).toBe(3);
      expect(first.cost + second.cost).toBe(4);
      expect(unitIn(single.state)?.remainingActionPoints).toBe(2);
      expect(unitIn(second.state)?.remainingActionPoints).toBe(1);
    });

    it('rejects a path that starts next to the previous position', () => {
      const { state } = expectMoved(testState(), firstMove);

      expectRejected(state, moveCommand([{ x: 2, y: 3 }]), {
        type: 'INVALID_PATH',
        reason: 'NOT_ADJACENT',
      });
    });

    it('rejects a move beyond what remains', () => {
      const first = expectMoved(testState(), firstMove);
      const { state } = expectMoved(first.state, moveCommand([{ x: 5, y: 3 }]));

      expectRejected(
        state,
        moveCommand([
          { x: 6, y: 3 },
          { x: 7, y: 3 },
        ]),
        {
          type: 'INSUFFICIENT_ACTION_POINTS',
          required: 2,
          available: 1,
        },
      );
    });

    it('applies the simple-path rule to a single command only', () => {
      const first = expectMoved(testState(), moveCommand([{ x: 3, y: 2 }]));
      const back = expectMoved(first.state, moveCommand([{ x: 2, y: 2 }]));

      expect(unitIn(back.state)).toMatchObject({
        position: { x: 2, y: 2 },
        remainingActionPoints: 3,
      });
    });
  });

  describe('rejections', () => {
    it('rejects an unknown unit', () => {
      expectRejected(
        testState(),
        moveCommand([{ x: 3, y: 2 }], { unitId: 'missing' }),
        {
          type: 'UNIT_NOT_FOUND',
          unitId: 'missing',
        },
      );
    });

    it('rejects an empty path', () => {
      expectRejected(
        testState(),
        moveCommand([], { destination: { x: 3, y: 2 } }),
        {
          type: 'INVALID_PATH',
          reason: 'EMPTY',
        },
      );
    });

    it('rejects a path that does not end at the destination', () => {
      expectRejected(
        testState(),
        moveCommand([{ x: 3, y: 2 }], { destination: { x: 4, y: 2 } }),
        { type: 'INVALID_PATH', reason: 'DESTINATION_MISMATCH' },
      );
    });

    it.each([
      {
        name: 'outside the board',
        options: {},
        path: [
          { x: 1, y: 2 },
          { x: 0, y: 2 },
          { x: -1, y: 2 },
        ],
      },
      {
        name: 'on ROCK',
        options: { rocks: [{ x: 3, y: 2 }] },
        path: [{ x: 3, y: 2 }],
      },
      {
        name: 'on another unit',
        options: {
          units: [testUnit({ id: 'left-2', position: { x: 3, y: 2 } })],
        },
        path: [{ x: 3, y: 2 }],
      },
      {
        name: 'on an orb',
        options: {
          orbs: [
            {
              id: 'orb',
              owner: 'RIGHT' as const,
              position: { x: 3, y: 2 },
              footprint: FOOTPRINTS['1x1'],
              health: 50,
              defense: 0,
            },
          ],
        },
        path: [{ x: 3, y: 2 }],
      },
    ])('rejects a destination $name', ({ options, path }) => {
      const destination = path[path.length - 1];

      expectRejected(stateWith(testUnit(), options), moveCommand(path), {
        type: 'INVALID_DESTINATION',
        destination,
      });
    });

    it('rejects a destination where only a non-anchor footprint cell is blocked', () => {
      const state = stateWith(testUnit({ footprint: FOOTPRINTS['2x1'] }), {
        rocks: [{ x: 5, y: 2 }],
      });

      expectRejected(
        state,
        moveCommand([
          { x: 3, y: 2 },
          { x: 4, y: 2 },
        ]),
        { type: 'INVALID_DESTINATION', destination: { x: 4, y: 2 } },
      );
    });

    it('reports an invalid destination before problems with the path', () => {
      const state = testState({ rocks: [{ x: 5, y: 2 }] });

      expectRejected(state, moveCommand([{ x: 5, y: 2 }]), {
        type: 'INVALID_DESTINATION',
        destination: { x: 5, y: 2 },
      });
    });

    it('rejects a path through an obstacle', () => {
      const state = testState({ rocks: [{ x: 3, y: 2 }] });

      expectRejected(
        state,
        moveCommand([
          { x: 3, y: 2 },
          { x: 4, y: 2 },
        ]),
        { type: 'INVALID_PATH', reason: 'BLOCKED' },
      );
    });

    it('rejects a diagonal step through a blocked corner', () => {
      const state = testState({
        rocks: [
          { x: 3, y: 2 },
          { x: 2, y: 3 },
        ],
      });

      expectRejected(state, moveCommand([{ x: 3, y: 3 }]), {
        type: 'INVALID_PATH',
        reason: 'CORNER_BLOCKED',
      });
    });

    it.each([
      { name: 'skips a cell at the start', path: [{ x: 4, y: 2 }] },
      {
        name: 'skips a cell midway',
        path: [
          { x: 3, y: 2 },
          { x: 5, y: 2 },
        ],
      },
      {
        name: 'uses a fractional coordinate',
        path: [
          { x: 2.5, y: 2 },
          { x: 3, y: 2 },
        ],
      },
      {
        name: 'uses a non-numeric coordinate',
        path: [
          { x: Number.NaN, y: 2 },
          { x: 3, y: 2 },
        ],
      },
    ])('rejects a path that $name', ({ path }) => {
      expectRejected(testState(), moveCommand(path), {
        type: 'INVALID_PATH',
        reason: 'NOT_ADJACENT',
      });
    });

    it.each([
      {
        name: 'starts with the start position',
        path: [
          { x: 2, y: 2 },
          { x: 3, y: 2 },
        ],
      },
      {
        name: 'returns to the start position',
        path: [
          { x: 3, y: 2 },
          { x: 2, y: 2 },
        ],
      },
      {
        name: 'revisits an earlier position',
        path: [
          { x: 3, y: 2 },
          { x: 3, y: 3 },
          { x: 3, y: 2 },
        ],
      },
    ])('rejects a path that $name', ({ path }) => {
      expectRejected(testState(), moveCommand(path), {
        type: 'INVALID_PATH',
        reason: 'REVISITED',
      });
    });
  });

  describe('current player', () => {
    const left = testUnit();
    const right = testUnit({
      id: 'right-1x1',
      owner: 'RIGHT',
      position: { x: 5, y: 5 },
    });

    it("rejects moving the other player's unit", () => {
      expectRejected(
        testState({ units: [left, right] }),
        moveCommand([{ x: 6, y: 5 }], { unitId: 'right-1x1' }),
        { type: 'UNIT_CANNOT_MOVE', unitId: 'right-1x1' },
      );
    });

    it('reads the current player from the battle state', () => {
      const state = testState({ units: [left, right], currentPlayer: 'RIGHT' });

      expect(
        engine.execute(
          state,
          moveCommand([{ x: 6, y: 5 }], { unitId: 'right-1x1' }),
        ).ok,
      ).toBe(true);
      expectRejected(state, moveCommand([{ x: 3, y: 2 }]), {
        type: 'UNIT_CANNOT_MOVE',
        unitId: 'left-1x1',
      });
    });
  });

  describe('active unit', () => {
    const other = testUnit({ id: 'left-other', position: { x: 6, y: 6 } });
    const unclaimed = testState({ units: [testUnit(), other] });

    it('is claimed by a successful first move', () => {
      const { state } = expectMoved(unclaimed, moveCommand([{ x: 3, y: 2 }]));

      expect(state.activeUnitId).toBe('left-1x1');
      expect(unclaimed.activeUnitId).toBeUndefined();
    });

    it('keeps the turn while the claimed unit moves again', () => {
      const { state: claimed } = expectMoved(
        unclaimed,
        moveCommand([{ x: 3, y: 2 }]),
      );

      const { state } = expectMoved(claimed, moveCommand([{ x: 4, y: 2 }]));

      expect(state.activeUnitId).toBe('left-1x1');
      expect(unitIn(state)?.position).toEqual({ x: 4, y: 2 });
    });

    it('keeps the turn after a move that exhausts the remaining AP, blocking other units at 0 AP', () => {
      const state = testState({
        units: [
          testUnit({ actionPointBudget: 2, remainingActionPoints: 2 }),
          other,
        ],
      });

      const { state: exhausted } = expectMoved(
        state,
        moveCommand([
          { x: 3, y: 2 },
          { x: 4, y: 2 },
        ]),
      );

      expect(unitIn(exhausted)?.remainingActionPoints).toBe(0);
      expect(exhausted.currentPlayer).toBe('LEFT');
      expect(exhausted.activeUnitId).toBe('left-1x1');
      expect(engine.legalActions(exhausted)).toEqual(new Set(['END_TURN']));
      expectRejected(
        exhausted,
        moveCommand([{ x: 7, y: 6 }], { unitId: 'left-other' }),
        { type: 'UNIT_CANNOT_MOVE', unitId: 'left-other' },
      );
    });

    it('is not claimed by a move rejected for insufficient AP', () => {
      // √2 + 4 rounds up to 6 AP.
      const tooFar = moveCommand([3, 4, 5, 6, 7].map((x) => ({ x, y: 3 })));

      expectRejected(unclaimed, tooFar, {
        type: 'INSUFFICIENT_ACTION_POINTS',
        required: 6,
        available: 5,
      });
      expect(unclaimed.activeUnitId).toBeUndefined();
      expect(
        engine.execute(
          unclaimed,
          moveCommand([{ x: 7, y: 6 }], { unitId: 'left-other' }),
        ).ok,
      ).toBe(true);
    });

    it("rejects another of the current player's units once the turn is claimed", () => {
      const { state: claimed } = expectMoved(
        unclaimed,
        moveCommand([{ x: 3, y: 2 }]),
      );

      expectRejected(
        claimed,
        moveCommand([{ x: 7, y: 6 }], { unitId: 'left-other' }),
        { type: 'UNIT_CANNOT_MOVE', unitId: 'left-other' },
      );
    });

    it('checks the active unit before the path', () => {
      const claimed = testState({
        units: [testUnit(), other],
        activeUnitId: 'left-1x1',
      });

      expectRejected(claimed, moveCommand([], { unitId: 'left-other' }), {
        type: 'UNIT_CANNOT_MOVE',
        unitId: 'left-other',
      });
    });
  });
});

describe('BattleEngine reachability', () => {
  it('returns the minimum-cost reachability of a current-player unit', () => {
    const result = engine.reachability(testState(), 'left-1x1');
    if (!result.ok) {
      throw new Error('expected reachability');
    }

    expect(result.value.origin).toEqual({ x: 2, y: 2 });
    expect(result.value.cells.get('4,3')).toMatchObject({
      cost: 1 + Math.SQRT2,
      actionPointCost: 3,
    });
  });

  it('starts from the current position and is limited by the remaining AP', () => {
    const { state } = expectMoved(
      testState(),
      moveCommand([
        { x: 3, y: 2 },
        { x: 4, y: 2 },
      ]),
    );

    const result = engine.reachability(state, 'left-1x1');
    if (!result.ok) {
      throw new Error('expected reachability');
    }

    expect(result.value.origin).toEqual({ x: 4, y: 2 });
    expect(result.value.cells.get('7,2')?.actionPointCost).toBe(3);
    // 1 + √2 rounds up to 3 AP; 2 + √2 would need 4.
    expect(result.value.cells.get('6,3')?.actionPointCost).toBe(3);
    expect(result.value.cells.has('7,3')).toBe(false);
    for (const cell of result.value.cells.values()) {
      expect(cell.actionPointCost).toBeLessThanOrEqual(3);
    }
  });

  it('rejects an unknown unit', () => {
    expect(engine.reachability(testState(), 'missing')).toEqual({
      ok: false,
      error: { type: 'UNIT_NOT_FOUND', unitId: 'missing' },
    });
  });

  describe("the other player's unit", () => {
    // 1 AP covers one orthogonal step (1 AP) but not a diagonal (2 AP),
    // although the unit's actionPointBudget is 3.
    const right = testUnit({
      id: 'right-1x1',
      owner: 'RIGHT',
      position: { x: 5, y: 5 },
      actionPointBudget: 3,
      remainingActionPoints: 1,
    });
    const state = testState({ units: [testUnit(), right] });

    it('can be inspected, within its remaining AP rather than its budget', () => {
      const before = structuredClone(state);

      const result = engine.reachability(state, 'right-1x1');
      if (!result.ok) {
        throw new Error(
          `expected reachability, got ${JSON.stringify(result.error)}`,
        );
      }

      expect(result.value.origin).toEqual({ x: 5, y: 5 });
      expect([...result.value.cells.keys()].sort()).toEqual(
        ['4,5', '5,4', '5,5', '5,6', '6,5'].sort(),
      );
      expect(result.value.cells.get('6,5')?.actionPointCost).toBe(1);
      expect(state).toEqual(before);
    });

    it('is still rejected when executing a path that reachability offers', () => {
      const reachability = engine.reachability(state, 'right-1x1');
      if (!reachability.ok) {
        throw new Error('expected reachability');
      }
      const steps = pathTo(reachability.value, { x: 6, y: 5 }) ?? [];
      expect(steps).toHaveLength(1);

      expectRejected(
        state,
        moveCommand(
          steps.map(({ to }) => to),
          { unitId: 'right-1x1' },
        ),
        { type: 'UNIT_CANNOT_MOVE', unitId: 'right-1x1' },
      );
    });
  });
});

describe('reachability and execution', () => {
  it.each([
    {
      name: 'an obstacle forcing a detour',
      unit: testUnit({ position: { x: 0, y: 0 } }),
      options: { rocks: [{ x: 1, y: 0 }] },
    },
    {
      name: 'blocked corners around a 2×2 unit',
      unit: testUnit({
        position: { x: 1, y: 1 },
        footprint: FOOTPRINTS['2x2'],
      }),
      options: {
        rocks: [
          { x: 4, y: 2 },
          { x: 2, y: 5 },
          { x: 5, y: 5 },
        ],
        units: [
          testUnit({
            id: 'right-1x1',
            owner: 'RIGHT',
            position: { x: 5, y: 1 },
          }),
        ],
      },
    },
    {
      name: 'a barrier gap crossed by a vertical 1×3 unit',
      unit: testUnit({
        position: { x: 3, y: 0 },
        footprint: FOOTPRINTS['1x3'],
      }),
      options: {
        width: 7,
        height: 7,
        rocks: [0, 1, 2, 4, 5, 6].map((x) => ({ x, y: 3 })),
      },
    },
  ])(
    'executes every previewed path with the previewed steps and AP cost: $name',
    ({ unit, options }) => {
      const state = stateWith(unit, options);
      const reachability = engine.reachability(state, unit.id);
      if (!reachability.ok) {
        throw new Error('expected reachability');
      }

      const destinations = [...reachability.value.cells.values()].filter(
        ({ via }) => via !== null,
      );
      expect(destinations.length).toBeGreaterThan(0);

      for (const cell of destinations) {
        const steps = pathTo(reachability.value, cell.position) ?? [];
        const result = expectMoved(
          state,
          moveCommand(
            steps.map(({ to }) => to),
            { unitId: unit.id },
          ),
        );

        expect(result.steps).toEqual(steps);
        expect(result.cost).toBe(cell.actionPointCost);
      }
    },
  );
});

describe('BattleEngine legal actions', () => {
  const left = testUnit();
  const leftOther = testUnit({ id: 'left-other', position: { x: 6, y: 6 } });
  const right = testUnit({
    id: 'right-1x1',
    owner: 'RIGHT',
    position: { x: 5, y: 5 },
  });

  function turnState(options: TestStateOptions = {}): BattleState {
    return testState({ units: [left, leftOther, right], ...options });
  }

  describe('at the start of a turn', () => {
    it('has no active unit and offers MOVE and END_TURN', () => {
      const state = turnState();

      expect(state.activeUnitId).toBeUndefined();
      expect(engine.legalActions(state)).toEqual(new Set(['MOVE', 'END_TURN']));
    });

    it('offers MOVE to every unit of the current player that can move', () => {
      const state = turnState();

      expect(engine.legalUnitActions(state, 'left-1x1')).toEqual(
        new Set(['MOVE']),
      );
      expect(engine.legalUnitActions(state, 'left-other')).toEqual(
        new Set(['MOVE']),
      );
    });

    it("never offers MOVE to the other player's unit", () => {
      expect(engine.legalUnitActions(turnState(), 'right-1x1')).toEqual(
        new Set(),
      );
    });

    it('reads the current player from the battle state', () => {
      const state = turnState({ currentPlayer: 'RIGHT' });

      expect(engine.legalUnitActions(state, 'right-1x1')).toEqual(
        new Set(['MOVE']),
      );
      expect(engine.legalUnitActions(state, 'left-1x1')).toEqual(new Set());
    });

    it('leaves out a unit at 0 AP but still offers MOVE through another', () => {
      const state = testState({
        units: [testUnit({ remainingActionPoints: 0 }), leftOther],
      });

      expect(engine.legalUnitActions(state, 'left-1x1')).toEqual(new Set());
      expect(engine.legalActions(state)).toEqual(new Set(['MOVE', 'END_TURN']));
    });
  });

  describe('once a unit has claimed the turn', () => {
    it('offers MOVE only to the active unit', () => {
      const state = turnState({ activeUnitId: 'left-1x1' });

      expect(engine.legalUnitActions(state, 'left-1x1')).toEqual(
        new Set(['MOVE']),
      );
      expect(engine.legalUnitActions(state, 'left-other')).toEqual(new Set());
      expect(engine.legalUnitActions(state, 'right-1x1')).toEqual(new Set());
    });

    it('offers no MOVE once the active unit is at 0 AP, even if another unit could move', () => {
      const state = testState({
        units: [testUnit({ remainingActionPoints: 0 }), leftOther, right],
        activeUnitId: 'left-1x1',
      });

      expect(engine.legalUnitActions(state, 'left-1x1')).toEqual(new Set());
      expect(engine.legalActions(state)).toEqual(new Set(['END_TURN']));
    });
  });

  describe('MOVE needs somewhere to go', () => {
    it('is not offered when the remaining AP do not afford the cheapest step', () => {
      const state = testState({
        units: [testUnit({ movementCostFactor: 2, remainingActionPoints: 1 })],
      });

      expect(engine.legalUnitActions(state, 'left-1x1')).toEqual(new Set());
    });

    it('is offered while the remaining AP still afford one step', () => {
      const state = testState({
        units: [testUnit({ remainingActionPoints: 1 })],
      });

      expect(engine.legalUnitActions(state, 'left-1x1')).toEqual(
        new Set(['MOVE']),
      );
    });

    it('is not offered to a boxed-in unit with full AP', () => {
      const neighbours = [-1, 0, 1]
        .flatMap((dx) => [-1, 0, 1].map((dy) => ({ x: 2 + dx, y: 2 + dy })))
        .filter(({ x, y }) => x !== 2 || y !== 2);
      const state = testState({ rocks: neighbours });

      expect(engine.legalUnitActions(state, 'left-1x1')).toEqual(new Set());
    });
  });

  describe('END_TURN', () => {
    it('is offered while the active unit has AP left', () => {
      const state = turnState({
        units: [testUnit({ remainingActionPoints: 2 }), leftOther],
        activeUnitId: 'left-1x1',
      });

      expect(engine.legalActions(state)).toEqual(new Set(['MOVE', 'END_TURN']));
    });

    it('is offered at 0 AP', () => {
      const state = testState({
        units: [testUnit({ remainingActionPoints: 0 })],
        activeUnitId: 'left-1x1',
      });

      expect(engine.legalActions(state)).toEqual(new Set(['END_TURN']));
    });
  });

  it('agrees with execution about which unit may move after the turn is claimed', () => {
    const { state: claimed } = expectMoved(
      turnState(),
      moveCommand([{ x: 3, y: 2 }]),
    );
    const oneStepEast = (unit: Unit): MoveUnitCommand => {
      const destination = { x: unit.position.x + 1, y: unit.position.y };
      return {
        type: 'MOVE_UNIT',
        unitId: unit.id,
        destination,
        path: [destination],
      };
    };

    const legal = claimed.units.filter(({ id }) =>
      engine.legalUnitActions(claimed, id).has('MOVE'),
    );
    const executable = claimed.units.filter(
      (unit) => engine.execute(claimed, oneStepEast(unit)).ok,
    );

    expect(legal.map(({ id }) => id)).toEqual(['left-1x1']);
    expect(executable).toEqual(legal);
  });

  it('reports no actions for an unknown unit', () => {
    expect(engine.legalUnitActions(turnState(), 'missing')).toEqual(new Set());
  });

  it('leaves the battle state untouched', () => {
    const state = turnState({
      units: [testUnit({ remainingActionPoints: 2 }), leftOther, right],
      activeUnitId: 'left-1x1',
    });
    const before = structuredClone(state);

    engine.legalActions(state);
    for (const { id } of state.units) {
      engine.legalUnitActions(state, id);
    }

    expect(state).toEqual(before);
  });
});

describe('BattleEngine endTurn', () => {
  const left = testUnit();
  const leftSpent = testUnit({
    id: 'left-spent',
    position: { x: 0, y: 7 },
    remainingActionPoints: 2,
  });
  const right = testUnit({
    id: 'right-1x1',
    owner: 'RIGHT',
    position: { x: 5, y: 5 },
    remainingActionPoints: 1,
  });
  const rightExhausted = testUnit({
    id: 'right-exhausted',
    owner: 'RIGHT',
    position: { x: 7, y: 0 },
    remainingActionPoints: 0,
  });
  const rightFresh = testUnit({
    id: 'right-fresh',
    owner: 'RIGHT',
    position: { x: 7, y: 7 },
  });

  function turnState(options: TestStateOptions = {}): BattleState {
    return testState({
      units: [left, leftSpent, right, rightExhausted, rightFresh],
      ...options,
    });
  }

  function actionPointsOf(state: BattleState): Record<string, number> {
    return Object.fromEntries(
      state.units.map(({ id, remainingActionPoints }) => [
        id,
        remainingActionPoints,
      ]),
    );
  }

  it('passes the turn from LEFT to RIGHT', () => {
    expect(engine.endTurn(turnState()).currentPlayer).toBe('RIGHT');
  });

  it('passes the turn from RIGHT to LEFT', () => {
    const state = turnState({ currentPlayer: 'RIGHT' });

    expect(engine.endTurn(state).currentPlayer).toBe('LEFT');
  });

  it('ends a turn before any unit has acted', () => {
    const next = engine.endTurn(turnState());

    expect(next.currentPlayer).toBe('RIGHT');
    expect(next.activeUnitId).toBeUndefined();
  });

  it('clears the active unit', () => {
    const { state: claimed } = expectMoved(
      turnState(),
      moveCommand([{ x: 3, y: 2 }]),
    );

    const next = engine.endTurn(claimed);

    expect(next.currentPlayer).toBe('RIGHT');
    expect(next.activeUnitId).toBeUndefined();
  });

  it('ends a turn while the active unit has AP left, which it keeps', () => {
    const { state: claimed } = expectMoved(
      turnState(),
      moveCommand([{ x: 3, y: 2 }]),
    );

    const next = engine.endTurn(claimed);

    expect(unitIn(next)?.remainingActionPoints).toBe(4);
  });

  it('ends a turn at 0 AP, which the unit keeps', () => {
    const claimed = turnState({
      units: [testUnit({ remainingActionPoints: 0 }), right],
      activeUnitId: 'left-1x1',
    });

    const next = engine.endTurn(claimed);

    expect(next.currentPlayer).toBe('RIGHT');
    expect(unitIn(next)?.remainingActionPoints).toBe(0);
  });

  describe('turn-start AP restoration', () => {
    it('restores every RIGHT unit when the turn passes to RIGHT', () => {
      expect(actionPointsOf(engine.endTurn(turnState()))).toEqual({
        'left-1x1': 5,
        'left-spent': 2,
        'right-1x1': 5,
        'right-exhausted': 5,
        'right-fresh': 5,
      });
    });

    it('restores every LEFT unit when the turn passes to LEFT', () => {
      const state = turnState({
        units: [
          testUnit({ remainingActionPoints: 0 }),
          leftSpent,
          right,
          rightExhausted,
        ],
        currentPlayer: 'RIGHT',
        activeUnitId: 'right-1x1',
      });

      expect(actionPointsOf(engine.endTurn(state))).toEqual({
        'left-1x1': 5,
        'left-spent': 5,
        'right-1x1': 1,
        'right-exhausted': 0,
      });
    });

    it('restores units other than the one that held the turn, and only when their owner starts a turn', () => {
      const { state: leftClaimed } = expectMoved(
        turnState(),
        moveCommand([{ x: 3, y: 2 }]),
      );
      const rightTurn = engine.endTurn(leftClaimed);
      expect(unitIn(rightTurn)?.remainingActionPoints).toBe(4);

      const { state: rightClaimed } = expectMoved(
        rightTurn,
        moveCommand([{ x: 6, y: 5 }], { unitId: 'right-1x1' }),
      );
      const leftTurn = engine.endTurn(rightClaimed);

      expect(leftTurn.currentPlayer).toBe('LEFT');
      expect(leftTurn.activeUnitId).toBeUndefined();
      expect(actionPointsOf(leftTurn)).toEqual({
        'left-1x1': 5,
        'left-spent': 5,
        'right-1x1': 4,
        'right-exhausted': 5,
        'right-fresh': 5,
      });
    });

    it('changes nothing but the restored AP', () => {
      const next = engine.endTurn(turnState());

      expect(unitIn(next, 'right-1x1')).toEqual({
        ...right,
        remainingActionPoints: right.actionPointBudget,
      });
      expect(unitIn(next, 'right-exhausted')).toEqual({
        ...rightExhausted,
        remainingActionPoints: rightExhausted.actionPointBudget,
      });
    });
  });

  it('returns a new state and leaves the previous one untouched', () => {
    const state = turnState({ activeUnitId: 'left-1x1' });
    const before = structuredClone(state);

    const next = engine.endTurn(state);

    expect(next).not.toBe(state);
    expect(state).toEqual(before);
    expect(state.currentPlayer).toBe('LEFT');
    expect(state.activeUnitId).toBe('left-1x1');
    expect(next.board).toBe(state.board);
    expect(next.walls).toBe(state.walls);
    expect(next.orbs).toBe(state.orbs);
  });

  it('creates new objects only for the units whose AP are restored', () => {
    const state = turnState();

    const next = engine.endTurn(state);

    expect(next.units).not.toBe(state.units);
    expect(unitIn(next, 'right-1x1')).not.toBe(right);
    expect(unitIn(next, 'right-exhausted')).not.toBe(rightExhausted);
    expect(unitIn(next, 'right-fresh')).toBe(rightFresh);
    expect(unitIn(next, 'left-1x1')).toBe(left);
    expect(unitIn(next, 'left-spent')).toBe(leftSpent);
    expect(right.remainingActionPoints).toBe(1);
    expect(rightExhausted.remainingActionPoints).toBe(0);
  });

  it("lets the next player's units act and stops the previous player's", () => {
    const { state: claimed } = expectMoved(
      turnState(),
      moveCommand([{ x: 3, y: 2 }]),
    );

    const next = engine.endTurn(claimed);

    expect(engine.legalUnitActions(next, 'right-1x1')).toEqual(
      new Set(['MOVE']),
    );
    expect(engine.legalUnitActions(next, 'left-1x1')).toEqual(new Set());
    expectRejected(next, moveCommand([{ x: 4, y: 2 }]), {
      type: 'UNIT_CANNOT_MOVE',
      unitId: 'left-1x1',
    });
  });
});

describe('BattleEngine ATTACK', () => {
  const ENEMY: AttackTarget = { kind: 'UNIT', id: 'right-1x1' };
  const ENEMY_WALL: AttackTarget = { kind: 'WALL', id: 'right-wall' };
  const ENEMY_ORB: AttackTarget = { kind: 'ORB', id: 'right-orb' };

  /** An ATTACK by the default `left-1x1` unit, which has attack 4 and 5 AP. */
  function attackCommand(
    target: AttackTarget,
    overrides: Partial<AttackCommand> = {},
  ): AttackCommand {
    return { type: 'ATTACK', unitId: 'left-1x1', target, ...overrides };
  }

  /** A RIGHT unit orthogonally next to the default attacker, with defense 2. */
  function enemy(overrides: Partial<Unit> = {}): Unit {
    return testUnit({
      id: 'right-1x1',
      owner: 'RIGHT',
      position: { x: 3, y: 2 },
      ...overrides,
    });
  }

  /** The default wall and orb at (5,2) are next to an attacker at (4,2). */
  const besideStructures = testUnit({ position: { x: 4, y: 2 } });

  function expectAttacked(
    state: BattleState,
    command: AttackCommand,
  ): AttackResult {
    const result = engine.attack(state, command);
    if (!result.ok) {
      throw new Error(
        `expected a successful attack, got ${JSON.stringify(result.error)}`,
      );
    }
    return result.value;
  }

  function expectAttackRejected(
    state: BattleState,
    command: AttackCommand,
    error: AttackError,
  ): void {
    const before = structuredClone(state);

    expect(engine.attack(state, command)).toEqual({ ok: false, error });
    expect(state).toEqual(before);
  }

  describe('against each target type', () => {
    it("damages an enemy unit by the attack minus the unit's defense and charges 2 AP", () => {
      const state = testState({ units: [testUnit(), enemy()] });

      const result = expectAttacked(state, attackCommand(ENEMY));

      expect(result).toMatchObject({
        target: ENEMY,
        damage: 2,
        remainingHealth: 8,
        cost: 2,
      });
      expect(unitIn(result.state, 'right-1x1')?.health).toBe(8);
      expect(unitIn(result.state)?.remainingActionPoints).toBe(3);
    });

    it("damages an enemy wall using the wall's own defense", () => {
      const state = testState({
        units: [besideStructures],
        walls: [testWall({ defense: 1 })],
      });

      const result = expectAttacked(state, attackCommand(ENEMY_WALL));

      expect(result).toMatchObject({
        target: ENEMY_WALL,
        damage: 3,
        remainingHealth: 27,
        cost: 2,
      });
      expect(result.state.walls[0].health).toBe(27);
      expect(unitIn(result.state)?.remainingActionPoints).toBe(3);
    });

    it("damages the enemy orb using the orb's own defense", () => {
      const state = testState({
        units: [besideStructures],
        orbs: [testOrb({ defense: 0 })],
      });

      const result = expectAttacked(state, attackCommand(ENEMY_ORB));

      expect(result).toMatchObject({
        target: ENEMY_ORB,
        damage: 4,
        remainingHealth: 16,
        cost: 2,
      });
      expect(result.state.orbs[0].health).toBe(16);
      expect(unitIn(result.state)?.remainingActionPoints).toBe(3);
    });

    it.each([
      [0, 4],
      [1, 3],
      [3, 1],
    ])(
      'deals the attack minus a target defense of %i: %i damage',
      (defense, damage) => {
        const state = testState({ units: [testUnit(), enemy({ defense })] });

        expect(expectAttacked(state, attackCommand(ENEMY)).damage).toBe(damage);
      },
    );

    it('accepts an attack that deals 0 damage and still charges 2 AP', () => {
      const state = testState({ units: [testUnit(), enemy({ defense: 4 })] });

      const result = expectAttacked(state, attackCommand(ENEMY));

      expect(result).toMatchObject({ damage: 0, remainingHealth: 10, cost: 2 });
      expect(unitIn(result.state)?.remainingActionPoints).toBe(3);
      expect(result.state.activeUnitId).toBe('left-1x1');
    });

    it('accepts an attack with exactly 2 AP left and leaves 0', () => {
      const state = testState({
        units: [testUnit({ remainingActionPoints: 2 }), enemy()],
      });

      const result = expectAttacked(state, attackCommand(ENEMY));

      expect(unitIn(result.state)?.remainingActionPoints).toBe(0);
    });
  });

  describe('destruction', () => {
    it('removes a unit whose HP the damage exactly uses up', () => {
      const state = testState({ units: [testUnit(), enemy({ health: 2 })] });

      const result = expectAttacked(state, attackCommand(ENEMY));

      expect(result).toMatchObject({ damage: 2, remainingHealth: 0 });
      expect(unitIn(result.state, 'right-1x1')).toBeUndefined();
      expect(unitIn(result.state)?.remainingActionPoints).toBe(3);
    });

    it('clamps overkill damage at 0 HP', () => {
      const state = testState({ units: [testUnit(), enemy({ health: 1 })] });

      const result = expectAttacked(state, attackCommand(ENEMY));

      expect(result).toMatchObject({ damage: 2, remainingHealth: 0 });
      expect(unitIn(result.state, 'right-1x1')).toBeUndefined();
    });

    it('removes a wall at 0 HP', () => {
      const state = testState({
        units: [besideStructures],
        walls: [testWall({ health: 3, defense: 1 })],
      });

      const result = expectAttacked(state, attackCommand(ENEMY_WALL));

      expect(result.remainingHealth).toBe(0);
      expect(result.state.walls).toEqual([]);
    });

    it('keeps an orb in the state at 0 HP, never below', () => {
      const orb = testOrb({ health: 1, defense: 0 });
      const state = testState({ units: [besideStructures], orbs: [orb] });

      const result = expectAttacked(state, attackCommand(ENEMY_ORB));

      expect(result).toMatchObject({ damage: 4, remainingHealth: 0 });
      expect(result.state.orbs).toEqual([{ ...orb, health: 0 }]);
    });

    it('frees the cells of a destroyed wall for movement', () => {
      const state = testState({
        units: [besideStructures],
        walls: [testWall({ health: 3, defense: 1 })],
      });
      const intoWall = moveCommand([{ x: 5, y: 3 }]);
      expectRejected(state, intoWall, {
        type: 'INVALID_DESTINATION',
        destination: { x: 5, y: 3 },
      });

      const { state: afterAttack } = expectAttacked(
        state,
        attackCommand(ENEMY_WALL),
      );

      expect(unitIn(expectMoved(afterAttack, intoWall).state)).toMatchObject({
        position: { x: 5, y: 3 },
        remainingActionPoints: 1,
      });
    });
  });

  describe('rejections', () => {
    const friend = testUnit({ id: 'left-other', position: { x: 2, y: 3 } });

    it('rejects an unknown attacker', () => {
      expectAttackRejected(
        testState({ units: [testUnit(), enemy()] }),
        attackCommand(ENEMY, { unitId: 'ghost' }),
        { type: 'UNIT_NOT_FOUND', unitId: 'ghost' },
      );
    });

    it("rejects an attack by the other player's unit", () => {
      expectAttackRejected(
        testState({ units: [testUnit(), enemy()] }),
        attackCommand(
          { kind: 'UNIT', id: 'left-1x1' },
          { unitId: 'right-1x1' },
        ),
        { type: 'UNIT_CANNOT_ATTACK', unitId: 'right-1x1' },
      );
    });

    it('rejects an attack by a unit other than the one that claimed the turn', () => {
      expectAttackRejected(
        testState({
          units: [testUnit(), friend, enemy()],
          activeUnitId: 'left-other',
        }),
        attackCommand(ENEMY),
        { type: 'UNIT_CANNOT_ATTACK', unitId: 'left-1x1' },
      );
    });

    it('checks the turn before the target', () => {
      expectAttackRejected(
        testState({ units: [testUnit(), friend], activeUnitId: 'left-other' }),
        attackCommand({ kind: 'UNIT', id: 'ghost' }),
        { type: 'UNIT_CANNOT_ATTACK', unitId: 'left-1x1' },
      );
    });

    it.each<AttackTarget>([
      { kind: 'UNIT', id: 'ghost' },
      { kind: 'WALL', id: 'ghost' },
      { kind: 'ORB', id: 'ghost' },
      // The id exists, but in another collection.
      { kind: 'WALL', id: 'right-orb' },
      { kind: 'UNIT', id: 'right-wall' },
    ])('rejects a missing target %o', (target) => {
      expectAttackRejected(
        testState({
          units: [besideStructures],
          walls: [testWall()],
          orbs: [testOrb()],
        }),
        attackCommand(target),
        { type: 'TARGET_NOT_FOUND', target },
      );
    });

    it('rejects a friendly unit as the target', () => {
      const target: AttackTarget = { kind: 'UNIT', id: 'left-other' };

      expectAttackRejected(
        testState({ units: [testUnit(), friend] }),
        attackCommand(target),
        { type: 'INVALID_TARGET', target },
      );
    });

    it('rejects the attacker itself as the target', () => {
      const target: AttackTarget = { kind: 'UNIT', id: 'left-1x1' };

      expectAttackRejected(testState(), attackCommand(target), {
        type: 'INVALID_TARGET',
        target,
      });
    });

    it("rejects the attacker's own wall and orb", () => {
      const state = testState({
        units: [besideStructures],
        walls: [testWall({ id: 'left-wall', owner: 'LEFT' })],
        orbs: [
          testOrb({ id: 'left-orb', owner: 'LEFT', position: { x: 4, y: 3 } }),
        ],
      });
      const ownWall: AttackTarget = { kind: 'WALL', id: 'left-wall' };
      const ownOrb: AttackTarget = { kind: 'ORB', id: 'left-orb' };

      expectAttackRejected(state, attackCommand(ownWall), {
        type: 'INVALID_TARGET',
        target: ownWall,
      });
      expectAttackRejected(state, attackCommand(ownOrb), {
        type: 'INVALID_TARGET',
        target: ownOrb,
      });
    });

    it.each([
      { x: 4, y: 2 },
      { x: 3, y: 3 },
    ])('rejects an enemy at %o, out of melee range', (position) => {
      expectAttackRejected(
        testState({ units: [testUnit(), enemy({ position })] }),
        attackCommand(ENEMY),
        { type: 'TARGET_OUT_OF_RANGE', target: ENEMY },
      );
    });

    it('rejects a structure out of melee range', () => {
      expectAttackRejected(
        testState({ walls: [testWall()] }),
        attackCommand(ENEMY_WALL),
        { type: 'TARGET_OUT_OF_RANGE', target: ENEMY_WALL },
      );
    });

    it.each([1, 0])('rejects an attack with %i AP left', (available) => {
      expectAttackRejected(
        testState({
          units: [testUnit({ remainingActionPoints: available }), enemy()],
        }),
        attackCommand(ENEMY),
        { type: 'INSUFFICIENT_ACTION_POINTS', required: 2, available },
      );
    });
  });

  describe('active unit', () => {
    const other = testUnit({ id: 'left-other', position: { x: 6, y: 6 } });
    const moveOther = moveCommand([{ x: 6, y: 5 }], { unitId: 'left-other' });

    it('is claimed by a successful first attack', () => {
      const state = testState({ units: [testUnit(), other, enemy()] });

      const { state: next } = expectAttacked(state, attackCommand(ENEMY));

      expect(next.activeUnitId).toBe('left-1x1');
      expectRejected(next, moveOther, {
        type: 'UNIT_CANNOT_MOVE',
        unitId: 'left-other',
      });
    });

    it('stays with the claimed unit while it attacks and moves again', () => {
      const state = testState({
        units: [testUnit(), other, enemy({ health: 100 })],
        activeUnitId: 'left-1x1',
      });

      const first = expectAttacked(state, attackCommand(ENEMY));
      const second = expectAttacked(first.state, attackCommand(ENEMY));
      const moved = expectMoved(second.state, moveCommand([{ x: 2, y: 3 }]));

      expect(second.state.activeUnitId).toBe('left-1x1');
      expect(unitIn(moved.state)?.remainingActionPoints).toBe(0);
      expect(unitIn(moved.state, 'right-1x1')?.health).toBe(96);
    });

    it('is not claimed by a rejected attack', () => {
      const state = testState({
        units: [testUnit({ remainingActionPoints: 1 }), other, enemy()],
      });

      expect(engine.attack(state, attackCommand(ENEMY)).ok).toBe(false);
      expect(state.activeUnitId).toBeUndefined();
      expect(expectMoved(state, moveOther).state.activeUnitId).toBe(
        'left-other',
      );
    });
  });

  describe('immutability', () => {
    it('applies the AP charge, the damage and the turn claim together in one new state', () => {
      const attacker = testUnit();
      const target = enemy();
      const bystander = testUnit({
        id: 'left-other',
        position: { x: 6, y: 6 },
      });
      const state = testState({
        units: [attacker, bystander, target],
        walls: [testWall({ position: { x: 0, y: 5 } })],
        orbs: [testOrb({ position: { x: 7, y: 0 } })],
      });
      const before = structuredClone(state);

      const { state: next } = expectAttacked(state, attackCommand(ENEMY));

      expect(state).toEqual(before);
      expect(next).not.toBe(state);
      expect(next).toEqual({
        ...state,
        units: [
          { ...attacker, remainingActionPoints: 3 },
          bystander,
          { ...target, health: 8 },
        ],
        activeUnitId: 'left-1x1',
      });
      expect(next.board).toBe(state.board);
      expect(next.walls).toBe(state.walls);
      expect(next.orbs).toBe(state.orbs);
      expect(unitIn(next, 'left-other')).toBe(bystander);
    });

    it('leaves the input untouched when destroying targets', () => {
      const state = testState({
        units: [besideStructures, enemy({ health: 1 })],
        walls: [testWall({ health: 1 })],
      });
      const before = structuredClone(state);

      const { state: afterWall } = expectAttacked(
        state,
        attackCommand(ENEMY_WALL),
      );
      const { state: afterUnit } = expectAttacked(
        afterWall,
        attackCommand(ENEMY),
      );

      expect(afterUnit.walls).toEqual([]);
      expect(unitIn(afterUnit, 'right-1x1')).toBeUndefined();
      expect(state).toEqual(before);
    });

    it('changes only the attacker among the units when attacking a structure', () => {
      const bystander = testUnit({
        id: 'left-other',
        position: { x: 0, y: 0 },
      });
      const enemyUnit = enemy({ position: { x: 7, y: 7 } });
      const state = testState({
        units: [besideStructures, bystander, enemyUnit],
        walls: [testWall()],
        orbs: [testOrb({ position: { x: 7, y: 0 } })],
      });

      const { state: next } = expectAttacked(state, attackCommand(ENEMY_WALL));

      expect(next.walls).not.toBe(state.walls);
      expect(next.orbs).toBe(state.orbs);
      expect(unitIn(next)).not.toBe(besideStructures);
      expect(unitIn(next, 'left-other')).toBe(bystander);
      expect(unitIn(next, 'right-1x1')).toBe(enemyUnit);
    });
  });

  describe('legal attack targets', () => {
    const friend = testUnit({ id: 'left-other', position: { x: 2, y: 3 } });

    it('offers an adjacent enemy unit, wall and orb, each with its kind', () => {
      const state = testState({
        units: [besideStructures, enemy()],
        walls: [testWall()],
        orbs: [testOrb({ position: { x: 4, y: 1 } })],
      });

      expect(engine.legalAttackTargets(state, 'left-1x1')).toEqual([
        ENEMY,
        ENEMY_WALL,
        ENEMY_ORB,
      ]);
    });

    it('offers a target the attack would deal 0 damage to', () => {
      const state = testState({ units: [testUnit(), enemy({ defense: 10 })] });

      expect(engine.legalAttackTargets(state, 'left-1x1')).toEqual([ENEMY]);
    });

    it("never offers friendly units, the attacker itself, or the attacker's own wall and orb", () => {
      const state = testState({
        units: [testUnit(), friend],
        walls: [
          testWall({
            id: 'left-wall',
            owner: 'LEFT',
            position: { x: 3, y: 1 },
          }),
        ],
        orbs: [
          testOrb({ id: 'left-orb', owner: 'LEFT', position: { x: 1, y: 2 } }),
        ],
      });

      expect(engine.legalAttackTargets(state, 'left-1x1')).toEqual([]);
    });

    it('never offers a target out of range or touching only diagonally', () => {
      const state = testState({
        units: [
          testUnit(),
          enemy({ position: { x: 4, y: 2 } }),
          enemy({ id: 'right-diagonal', position: { x: 3, y: 3 } }),
        ],
      });

      expect(engine.legalAttackTargets(state, 'left-1x1')).toEqual([]);
    });

    it('compares the whole footprints of a multi-cell attacker and its targets', () => {
      const state = testState({
        units: [
          testUnit({ footprint: FOOTPRINTS['2x2'] }),
          // Meets the attacker's (2,3) only at a corner.
          enemy({ position: { x: 1, y: 4 } }),
        ],
        // (4,3) touches the attacker's non-anchor cell (3,3).
        walls: [testWall({ position: { x: 4, y: 3 } })],
        orbs: [testOrb({ position: { x: 1, y: 1 } })],
      });

      expect(engine.legalAttackTargets(state, 'left-1x1')).toEqual([
        ENEMY_WALL,
      ]);
    });

    it.each([
      [2, [ENEMY]],
      [1, []],
      [0, []],
    ])('with %i AP left offers %o', (remainingActionPoints, targets) => {
      const state = testState({
        units: [testUnit({ remainingActionPoints }), enemy()],
      });

      expect(engine.legalAttackTargets(state, 'left-1x1')).toEqual(targets);
    });

    it("offers nothing to the other player's unit", () => {
      const state = testState({ units: [testUnit(), enemy()] });

      expect(engine.legalAttackTargets(state, 'right-1x1')).toEqual([]);
    });

    it('reads the current player from the battle state', () => {
      const state = testState({
        units: [testUnit(), enemy()],
        currentPlayer: 'RIGHT',
      });

      expect(engine.legalAttackTargets(state, 'right-1x1')).toEqual([
        { kind: 'UNIT', id: 'left-1x1' },
      ]);
      expect(engine.legalAttackTargets(state, 'left-1x1')).toEqual([]);
    });

    it('offers nothing while another unit holds the turn, and keeps the targets of the unit that holds it', () => {
      const units = [testUnit(), friend, enemy()];

      expect(
        engine.legalAttackTargets(
          testState({ units, activeUnitId: 'left-other' }),
          'left-1x1',
        ),
      ).toEqual([]);
      expect(
        engine.legalAttackTargets(
          testState({ units, activeUnitId: 'left-1x1' }),
          'left-1x1',
        ),
      ).toEqual([ENEMY]);
    });

    it('offers nothing to an unknown unit', () => {
      const state = testState({ units: [testUnit(), enemy()] });

      expect(engine.legalAttackTargets(state, 'ghost')).toEqual([]);
    });

    it('tells apart targets whose ids collide across collections', () => {
      const unitAndDistantWall = testState({
        units: [testUnit(), enemy({ id: 'shared' })],
        walls: [testWall({ id: 'shared', position: { x: 7, y: 0 } })],
      });
      const adjacentWallAndOrb = testState({
        units: [besideStructures],
        walls: [testWall({ id: 'shared' })],
        orbs: [testOrb({ id: 'shared', position: { x: 4, y: 1 } })],
      });

      expect(engine.legalAttackTargets(unitAndDistantWall, 'left-1x1')).toEqual(
        [{ kind: 'UNIT', id: 'shared' }],
      );
      expect(engine.legalAttackTargets(adjacentWallAndOrb, 'left-1x1')).toEqual(
        [
          { kind: 'WALL', id: 'shared' },
          { kind: 'ORB', id: 'shared' },
        ],
      );
    });

    it('leaves the battle state untouched', () => {
      const state = testState({
        units: [besideStructures, friend, enemy()],
        walls: [testWall()],
        orbs: [testOrb({ position: { x: 4, y: 1 } })],
      });
      const before = structuredClone(state);

      for (const { id } of state.units) {
        engine.legalAttackTargets(state, id);
        engine.legalUnitActions(state, id);
      }
      engine.legalActions(state);

      expect(state).toEqual(before);
    });
  });

  describe('legal actions', () => {
    const friend = testUnit({ id: 'left-other', position: { x: 6, y: 6 } });

    it('offers ATTACK next to MOVE when an enemy is in range', () => {
      const state = testState({ units: [testUnit(), enemy()] });

      expect(engine.legalUnitActions(state, 'left-1x1')).toEqual(
        new Set(['MOVE', 'ATTACK']),
      );
    });

    it('offers ATTACK alone to a unit boxed in by enemies', () => {
      // From the corner, both orthogonal steps are taken and the diagonal
      // would cut between the two enemies.
      const state = testState({
        units: [
          testUnit({ position: { x: 0, y: 0 } }),
          enemy({ id: 'right-east', position: { x: 1, y: 0 } }),
          enemy({ id: 'right-north', position: { x: 0, y: 1 } }),
        ],
      });

      expect(engine.legalUnitActions(state, 'left-1x1')).toEqual(
        new Set(['ATTACK']),
      );
    });

    it('offers no ATTACK without a target in range', () => {
      const state = testState({
        units: [testUnit(), enemy({ position: { x: 4, y: 2 } })],
      });

      expect(engine.legalUnitActions(state, 'left-1x1')).toEqual(
        new Set(['MOVE']),
      );
    });

    it('offers no ATTACK with 1 AP left, though MOVE still fits', () => {
      const state = testState({
        units: [testUnit({ remainingActionPoints: 1 }), enemy()],
      });

      expect(engine.legalUnitActions(state, 'left-1x1')).toEqual(
        new Set(['MOVE']),
      );
    });

    it('offers no ATTACK to a unit that may not act, even next to an enemy', () => {
      const units = [testUnit(), friend, enemy()];

      expect(
        engine.legalUnitActions(testState({ units }), 'right-1x1'),
      ).toEqual(new Set());
      expect(
        engine.legalUnitActions(
          testState({ units, activeUnitId: 'left-other' }),
          'left-1x1',
        ),
      ).toEqual(new Set());
    });

    it('includes ATTACK in the legal actions when an eligible unit can attack', () => {
      const state = testState({ units: [testUnit(), enemy()] });

      expect(engine.legalActions(state)).toEqual(
        new Set(['MOVE', 'ATTACK', 'END_TURN']),
      );
    });

    it('leaves ATTACK out when only a unit that does not hold the turn is next to an enemy', () => {
      const units = [testUnit(), friend, enemy({ position: { x: 7, y: 6 } })];

      expect(engine.legalActions(testState({ units }))).toEqual(
        new Set(['MOVE', 'ATTACK', 'END_TURN']),
      );
      expect(
        engine.legalActions(testState({ units, activeUnitId: 'left-1x1' })),
      ).toEqual(new Set(['MOVE', 'END_TURN']));
    });

    it('offers only END_TURN once the active unit is at 0 AP next to an enemy', () => {
      const state = testState({
        units: [testUnit({ remainingActionPoints: 0 }), enemy()],
        activeUnitId: 'left-1x1',
      });

      expect(engine.legalActions(state)).toEqual(new Set(['END_TURN']));
    });
  });

  describe('per-unit attack cost', () => {
    /** An attacker whose attack costs 4 AP, with `ap` AP left. */
    function costlyAttacker(ap: number): Unit {
      return testUnit({
        attackActionPointCost: 4,
        actionPointBudget: 6,
        remainingActionPoints: ap,
      });
    }

    it("charges exactly the attacker's own cost and reports it", () => {
      const state = testState({ units: [costlyAttacker(6), enemy()] });

      const result = expectAttacked(state, attackCommand(ENEMY));

      expect(result.cost).toBe(4);
      expect(unitIn(result.state)?.remainingActionPoints).toBe(2);
    });

    it('accepts an attack that uses up exactly the attack cost', () => {
      const state = testState({ units: [costlyAttacker(4), enemy()] });

      const result = expectAttacked(state, attackCommand(ENEMY));

      expect(unitIn(result.state)?.remainingActionPoints).toBe(0);
    });

    it("rejects an attack below the attacker's cost, with that cost as required", () => {
      const state = testState({ units: [costlyAttacker(3), enemy()] });

      expectAttackRejected(state, attackCommand(ENEMY), {
        type: 'INSUFFICIENT_ACTION_POINTS',
        required: 4,
        available: 3,
      });
    });

    it('charges the full cost for an attack that deals 0 damage', () => {
      const state = testState({
        units: [testUnit({ attackActionPointCost: 3 }), enemy({ defense: 10 })],
      });

      const result = expectAttacked(state, attackCommand(ENEMY));

      expect(result).toMatchObject({ damage: 0, cost: 3 });
      expect(unitIn(result.state)?.remainingActionPoints).toBe(2);
    });

    it('offers targets and ATTACK only once the attacker can afford its own cost', () => {
      const short = testState({ units: [costlyAttacker(3), enemy()] });
      const enough = testState({ units: [costlyAttacker(4), enemy()] });

      expect(engine.legalAttackTargets(short, 'left-1x1')).toEqual([]);
      expect(engine.legalUnitActions(short, 'left-1x1')).toEqual(
        new Set(['MOVE']),
      );
      expect(engine.legalAttackTargets(enough, 'left-1x1')).toEqual([ENEMY]);
      expect(engine.legalUnitActions(enough, 'left-1x1')).toEqual(
        new Set(['MOVE', 'ATTACK']),
      );
    });

    it('reads the cost from each unit: with the same AP, only the cheaper attacker may attack', () => {
      const state = testState({
        units: [
          costlyAttacker(2),
          testUnit({
            id: 'left-cheap',
            position: { x: 3, y: 1 },
            remainingActionPoints: 2,
          }),
          // Next to both attackers.
          enemy({ position: { x: 3, y: 2 } }),
        ],
      });

      expect(engine.legalAttackTargets(state, 'left-1x1')).toEqual([]);
      expect(engine.legalAttackTargets(state, 'left-cheap')).toEqual([ENEMY]);
      expect(
        expectAttacked(state, attackCommand(ENEMY, { unitId: 'left-cheap' }))
          .cost,
      ).toBe(2);
    });
  });

  describe('attack range', () => {
    function keys(cells: readonly Position[]): string[] {
      return cells.map(positionKey).sort();
    }

    it("is the unit's melee reach on the board", () => {
      const state = testState({ units: [testUnit()] });

      expect(keys(engine.attackRange(state, 'left-1x1'))).toEqual([
        '1,2',
        '2,1',
        '2,3',
        '3,2',
      ]);
    });

    it('is empty for an unknown unit', () => {
      expect(engine.attackRange(testState(), 'ghost')).toEqual([]);
    });

    it('can be inspected for a unit of the other player and for a unit without AP', () => {
      const state = testState({
        units: [testUnit({ remainingActionPoints: 0 }), enemy()],
      });

      expect(keys(engine.attackRange(state, 'left-1x1'))).toEqual([
        '1,2',
        '2,1',
        '2,3',
        '3,2',
      ]);
      // (2,2) is occupied by the LEFT unit, and still within reach.
      expect(keys(engine.attackRange(state, 'right-1x1'))).toEqual([
        '2,2',
        '3,1',
        '3,3',
        '4,2',
      ]);
    });

    it('includes rock cells and cells occupied by other objects', () => {
      const state = testState({
        rocks: [{ x: 2, y: 1 }],
        units: [testUnit(), enemy()],
        orbs: [testOrb({ position: { x: 1, y: 2 } })],
      });

      expect(keys(engine.attackRange(state, 'left-1x1'))).toEqual([
        '1,2',
        '2,1',
        '2,3',
        '3,2',
      ]);
    });

    it('covers a cell of every legal attack target', () => {
      const state = testState({
        units: [besideStructures, enemy()],
        walls: [testWall()],
        orbs: [testOrb({ position: { x: 4, y: 1 } })],
      });
      const reach = new Set(keys(engine.attackRange(state, 'left-1x1')));
      const targets = engine.legalAttackTargets(state, 'left-1x1');
      const footprintOf = ({ kind, id }: AttackTarget) => {
        const placedEntity =
          kind === 'UNIT'
            ? state.units.find((unit) => unit.id === id)
            : kind === 'WALL'
              ? state.walls.find((wall) => wall.id === id)
              : state.orbs.find((orb) => orb.id === id);
        return occupiedCells(placedEntity!.position, placedEntity!.footprint);
      };

      expect(targets).toHaveLength(3);
      for (const target of targets) {
        expect(
          footprintOf(target).some((cell) => reach.has(positionKey(cell))),
          `${target.kind} ${target.id}`,
        ).toBe(true);
      }
    });

    it('leaves the battle state untouched', () => {
      const state = testState({ units: [testUnit(), enemy()] });
      const before = structuredClone(state);

      engine.attackRange(state, 'left-1x1');

      expect(state).toEqual(before);
    });
  });

  describe('legal targets and execution', () => {
    /**
     * A 2×2 attacker at (2,2) with, around it: an enemy unit, wall and orb in
     * range; an enemy touching only diagonally; a friend; its own wall; a
     * distant enemy; and a distant enemy wall sharing the enemy unit's id.
     */
    function battlefield(
      options: Pick<TestStateOptions, 'activeUnitId' | 'currentPlayer'> & {
        readonly attackerActionPoints?: number;
        readonly attackerAttackCost?: number;
      } = {},
    ): BattleState {
      return testState({
        units: [
          testUnit({
            footprint: FOOTPRINTS['2x2'],
            remainingActionPoints: options.attackerActionPoints ?? 5,
            attackActionPointCost: options.attackerAttackCost ?? 2,
          }),
          enemy({ position: { x: 4, y: 2 } }),
          enemy({ id: 'right-diagonal', position: { x: 4, y: 4 } }),
          enemy({ id: 'right-far', position: { x: 7, y: 7 } }),
          testUnit({ id: 'left-other', position: { x: 1, y: 2 } }),
        ],
        walls: [
          testWall({ position: { x: 2, y: 4 } }),
          testWall({
            id: 'left-wall',
            owner: 'LEFT',
            position: { x: 1, y: 3 },
            footprint: FOOTPRINTS['1x1'],
          }),
          testWall({
            id: 'right-1x1',
            position: { x: 6, y: 0 },
            footprint: FOOTPRINTS['1x1'],
          }),
        ],
        orbs: [testOrb({ position: { x: 3, y: 1 } })],
        activeUnitId: options.activeUnitId,
        currentPlayer: options.currentPlayer,
      });
    }

    function everyTarget(state: BattleState): AttackTarget[] {
      return [
        ...state.units.map(({ id }): AttackTarget => ({ kind: 'UNIT', id })),
        ...state.walls.map(({ id }): AttackTarget => ({ kind: 'WALL', id })),
        ...state.orbs.map(({ id }): AttackTarget => ({ kind: 'ORB', id })),
      ];
    }

    const inRange = [ENEMY, ENEMY_WALL, ENEMY_ORB];

    it.each<
      [string, BattleState, Readonly<Record<string, readonly AttackTarget[]>>]
    >([
      ['an unclaimed turn', battlefield(), { 'left-1x1': inRange }],
      [
        'a turn claimed by the attacker',
        battlefield({ activeUnitId: 'left-1x1' }),
        { 'left-1x1': inRange },
      ],
      [
        'a turn claimed by another unit',
        battlefield({ activeUnitId: 'left-other' }),
        {},
      ],
      [
        'an attacker with exactly 2 AP',
        battlefield({ attackerActionPoints: 2 }),
        { 'left-1x1': inRange },
      ],
      ['an attacker with 1 AP', battlefield({ attackerActionPoints: 1 }), {}],
      [
        'an attacker whose attack costs 3 AP, with 2 AP',
        battlefield({ attackerActionPoints: 2, attackerAttackCost: 3 }),
        {},
      ],
      [
        'an attacker whose attack costs 3 AP, with 3 AP',
        battlefield({ attackerActionPoints: 3, attackerAttackCost: 3 }),
        { 'left-1x1': inRange },
      ],
      [
        "RIGHT's turn",
        battlefield({ currentPlayer: 'RIGHT' }),
        { 'right-1x1': [{ kind: 'UNIT', id: 'left-1x1' }] },
      ],
    ])(
      'in %s, offers exactly the targets that execution accepts',
      (_, state, expected) => {
        for (const { id: unitId } of state.units) {
          const offered = engine.legalAttackTargets(state, unitId);
          const executable = everyTarget(state).filter(
            (target) =>
              engine.attack(state, attackCommand(target, { unitId })).ok,
          );

          expect(offered, unitId).toEqual(expected[unitId] ?? []);
          expect(executable, unitId).toEqual(offered);
          expect(
            engine.legalUnitActions(state, unitId).has('ATTACK'),
            unitId,
          ).toBe(offered.length > 0);
        }
      },
    );
  });
});
