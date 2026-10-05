import { describe, expect, it } from 'vitest';
import type { BattleState, Position, Unit } from './battle-state';
import { BattleEngine } from './battle-engine';
import { COST_EPSILON } from './movement-cost';
import type {
  MoveUnitCommand,
  MovementError,
  MovementResult,
} from './movement';
import { pathTo } from './pathfinding';
import {
  FOOTPRINTS,
  testState,
  testUnit,
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
  it('moves the unit along the submitted path and charges its cost', () => {
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
    expect(result.cost).toBe(1 + Math.SQRT2);
    expect(unitIn(result.state)).toMatchObject({
      position: { x: 4, y: 3 },
      moveRange: 5,
      remainingMovement: 5 - (1 + Math.SQRT2),
    });
  });

  it('sums the cost of every step', () => {
    const result = expectMoved(
      testState(),
      moveCommand([
        { x: 3, y: 2 },
        { x: 4, y: 2 },
        { x: 5, y: 3 },
      ]),
    );

    expect(result.cost).toBe(2 + Math.SQRT2);
  });

  it('allows a move that exactly exhausts the remaining movement', () => {
    const state = testState({
      units: [testUnit({ moveRange: 3, remainingMovement: 3 })],
    });

    const result = expectMoved(
      state,
      moveCommand([
        { x: 3, y: 2 },
        { x: 4, y: 2 },
        { x: 5, y: 2 },
      ]),
    );

    expect(unitIn(result.state)?.remainingMovement).toBe(0);
  });

  it('allows a move whose cost exceeds the remaining movement only by rounding error', () => {
    // Summed in a different order, the same true cost 1 + 3√2 comes out one
    // rounding step larger than the remaining movement.
    const unit = testUnit({
      moveRange: 6,
      remainingMovement: 1 + Math.SQRT2 + Math.SQRT2 + Math.SQRT2,
    });

    const result = expectMoved(
      testState({ units: [unit] }),
      moveCommand([
        { x: 3, y: 3 },
        { x: 4, y: 4 },
        { x: 5, y: 5 },
        { x: 6, y: 5 },
      ]),
    );

    expect(result.cost).toBeGreaterThan(unit.remainingMovement);
    expect(unitIn(result.state)?.remainingMovement).toBe(0);
  });

  it('rejects a path that costs more than the remaining movement', () => {
    const state = testState({ units: [testUnit({ remainingMovement: 2 })] });

    expectRejected(
      state,
      moveCommand([
        { x: 3, y: 2 },
        { x: 4, y: 2 },
        { x: 5, y: 3 },
      ]),
      { type: 'INSUFFICIENT_MOVEMENT', required: 2 + Math.SQRT2, available: 2 },
    );
  });

  it('rejects any move once movement is used up', () => {
    const state = testState({ units: [testUnit({ remainingMovement: 0 })] });

    expectRejected(state, moveCommand([{ x: 3, y: 2 }]), {
      type: 'INSUFFICIENT_MOVEMENT',
      required: 1,
      available: 0,
    });
  });

  it('accepts a valid path that is not minimal and charges its actual cost', () => {
    // The minimum cost to (3,2) is 1; the caller chose a detour via (2,3).
    const result = expectMoved(
      testState(),
      moveCommand([
        { x: 2, y: 3 },
        { x: 3, y: 2 },
      ]),
    );

    expect(result.cost).toBe(1 + Math.SQRT2);
    expect(unitIn(result.state)?.remainingMovement).toBe(5 - (1 + Math.SQRT2));
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
    expect(expectMoved(testState(), moveCommand(path)).cost).toBe(
      1 + Math.SQRT2,
    );
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
        },
      ],
      orbs: [
        {
          id: 'orb',
          owner: 'RIGHT',
          position: { x: 7, y: 0 },
          footprint: FOOTPRINTS['1x1'],
          health: 50,
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
      remainingMovement: original.remainingMovement,
    }).toEqual(original);
  });

  describe('repeated movement', () => {
    const firstMove = moveCommand([
      { x: 3, y: 2 },
      { x: 4, y: 2 },
    ]);

    it('evaluates each move from the new position against the remaining movement', () => {
      const first = expectMoved(testState(), firstMove);
      const second = expectMoved(first.state, moveCommand([{ x: 5, y: 3 }]));

      expect(unitIn(first.state)?.remainingMovement).toBe(3);
      expect(unitIn(second.state)).toMatchObject({
        position: { x: 5, y: 3 },
        moveRange: 5,
        remainingMovement: 3 - Math.SQRT2,
      });
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
          type: 'INSUFFICIENT_MOVEMENT',
          required: 2,
          available: 3 - Math.SQRT2,
        },
      );
    });

    it('applies the simple-path rule to a single command only', () => {
      const first = expectMoved(testState(), moveCommand([{ x: 3, y: 2 }]));
      const back = expectMoved(first.state, moveCommand([{ x: 2, y: 2 }]));

      expect(unitIn(back.state)).toMatchObject({
        position: { x: 2, y: 2 },
        remainingMovement: 3,
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

    it('keeps the turn after a move that exhausts the remaining movement', () => {
      const state = testState({
        units: [testUnit({ moveRange: 2, remainingMovement: 2 }), other],
      });

      const { state: exhausted } = expectMoved(
        state,
        moveCommand([
          { x: 3, y: 2 },
          { x: 4, y: 2 },
        ]),
      );

      expect(unitIn(exhausted)?.remainingMovement).toBe(0);
      expect(exhausted.currentPlayer).toBe('LEFT');
      expect(exhausted.activeUnitId).toBe('left-1x1');
      expect(engine.legalActions(exhausted)).toEqual(new Set(['END_TURN']));
      expectRejected(
        exhausted,
        moveCommand([{ x: 7, y: 6 }], { unitId: 'left-other' }),
        { type: 'UNIT_CANNOT_MOVE', unitId: 'left-other' },
      );
    });

    it('is not claimed by a failed move', () => {
      const tooFar = moveCommand([3, 4, 5, 6, 7].map((x) => ({ x, y: 3 })));

      expectRejected(unclaimed, tooFar, {
        type: 'INSUFFICIENT_MOVEMENT',
        required: Math.SQRT2 + 4,
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
    expect(result.value.cells.get('4,3')?.cost).toBe(1 + Math.SQRT2);
  });

  it('starts from the current position and is limited by the remaining movement', () => {
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
    expect(result.value.cells.get('7,2')?.cost).toBe(3);
    for (const cell of result.value.cells.values()) {
      expect(cell.cost).toBeLessThanOrEqual(3 + COST_EPSILON);
    }
  });

  it('rejects an unknown unit', () => {
    expect(engine.reachability(testState(), 'missing')).toEqual({
      ok: false,
      error: { type: 'UNIT_NOT_FOUND', unitId: 'missing' },
    });
  });

  describe("the other player's unit", () => {
    // 1.59 covers one orthogonal (1) or diagonal (√2) step, but not two
    // orthogonal steps (2), although the unit's moveRange is 3.
    const right = testUnit({
      id: 'right-1x1',
      owner: 'RIGHT',
      position: { x: 5, y: 5 },
      moveRange: 3,
      remainingMovement: 1.59,
    });
    const state = testState({ units: [testUnit(), right] });

    it('can be inspected, within its remaining movement rather than its moveRange', () => {
      const before = structuredClone(state);

      const result = engine.reachability(state, 'right-1x1');
      if (!result.ok) {
        throw new Error(
          `expected reachability, got ${JSON.stringify(result.error)}`,
        );
      }

      expect(result.value.origin).toEqual({ x: 5, y: 5 });
      expect([...result.value.cells.keys()].sort()).toEqual(
        ['4,4', '4,5', '4,6', '5,4', '5,5', '5,6', '6,4', '6,5', '6,6'].sort(),
      );
      expect(result.value.cells.get('6,6')?.cost).toBe(Math.SQRT2);
      expect(state).toEqual(before);
    });

    it('is still rejected when executing a path that reachability offers', () => {
      const reachability = engine.reachability(state, 'right-1x1');
      if (!reachability.ok) {
        throw new Error('expected reachability');
      }
      const steps = pathTo(reachability.value, { x: 6, y: 6 }) ?? [];
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
    'executes every previewed path with the previewed steps and cost: $name',
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
        expect(result.cost).toBe(cell.cost);
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

    it('leaves out a unit without movement but still offers MOVE through another', () => {
      const state = testState({
        units: [testUnit({ remainingMovement: 0 }), leftOther],
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

    it('offers no MOVE once the active unit has no movement left, even if another unit could move', () => {
      const state = testState({
        units: [testUnit({ remainingMovement: 0 }), leftOther, right],
        activeUnitId: 'left-1x1',
      });

      expect(engine.legalUnitActions(state, 'left-1x1')).toEqual(new Set());
      expect(engine.legalActions(state)).toEqual(new Set(['END_TURN']));
    });
  });

  describe('MOVE needs somewhere to go', () => {
    it('is not offered for a leftover smaller than any step', () => {
      const state = testState({
        units: [testUnit({ remainingMovement: 5 - 3 * Math.SQRT2 })],
      });

      expect(engine.legalUnitActions(state, 'left-1x1')).toEqual(new Set());
    });

    it('is offered for a leftover that still affords one step', () => {
      const state = testState({ units: [testUnit({ remainingMovement: 1 })] });

      expect(engine.legalUnitActions(state, 'left-1x1')).toEqual(
        new Set(['MOVE']),
      );
    });

    it('is not offered to a boxed-in unit with full movement', () => {
      const neighbours = [-1, 0, 1]
        .flatMap((dx) => [-1, 0, 1].map((dy) => ({ x: 2 + dx, y: 2 + dy })))
        .filter(({ x, y }) => x !== 2 || y !== 2);
      const state = testState({ rocks: neighbours });

      expect(engine.legalUnitActions(state, 'left-1x1')).toEqual(new Set());
    });
  });

  describe('END_TURN', () => {
    it('is offered while the active unit has movement left', () => {
      const state = turnState({
        units: [testUnit({ remainingMovement: 2.5 }), leftOther],
        activeUnitId: 'left-1x1',
      });

      expect(engine.legalActions(state)).toEqual(new Set(['MOVE', 'END_TURN']));
    });

    it('is offered once the active unit has no movement left', () => {
      const state = testState({
        units: [testUnit({ remainingMovement: 0 })],
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
      units: [testUnit({ remainingMovement: 2.5 }), leftOther, right],
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
    remainingMovement: 2,
  });
  const right = testUnit({
    id: 'right-1x1',
    owner: 'RIGHT',
    position: { x: 5, y: 5 },
    remainingMovement: 1.5,
  });
  const rightExhausted = testUnit({
    id: 'right-exhausted',
    owner: 'RIGHT',
    position: { x: 7, y: 0 },
    remainingMovement: 0,
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

  function movementOf(state: BattleState): Record<string, number> {
    return Object.fromEntries(
      state.units.map(({ id, remainingMovement }) => [id, remainingMovement]),
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

  it('ends a turn while the active unit has movement left, which it keeps', () => {
    const { state: claimed } = expectMoved(
      turnState(),
      moveCommand([{ x: 3, y: 2 }]),
    );

    const next = engine.endTurn(claimed);

    expect(unitIn(next)?.remainingMovement).toBe(4);
  });

  it('ends a turn once the active unit has no movement left, which it keeps', () => {
    const claimed = turnState({
      units: [testUnit({ remainingMovement: 0 }), right],
      activeUnitId: 'left-1x1',
    });

    const next = engine.endTurn(claimed);

    expect(next.currentPlayer).toBe('RIGHT');
    expect(unitIn(next)?.remainingMovement).toBe(0);
  });

  describe('turn-start movement restoration', () => {
    it('restores every RIGHT unit when the turn passes to RIGHT', () => {
      expect(movementOf(engine.endTurn(turnState()))).toEqual({
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
          testUnit({ remainingMovement: 0 }),
          leftSpent,
          right,
          rightExhausted,
        ],
        currentPlayer: 'RIGHT',
        activeUnitId: 'right-1x1',
      });

      expect(movementOf(engine.endTurn(state))).toEqual({
        'left-1x1': 5,
        'left-spent': 5,
        'right-1x1': 1.5,
        'right-exhausted': 0,
      });
    });

    it('restores units other than the one that held the turn, and only when their owner starts a turn', () => {
      const { state: leftClaimed } = expectMoved(
        turnState(),
        moveCommand([{ x: 3, y: 2 }]),
      );
      const rightTurn = engine.endTurn(leftClaimed);
      expect(unitIn(rightTurn)?.remainingMovement).toBe(4);

      const { state: rightClaimed } = expectMoved(
        rightTurn,
        moveCommand([{ x: 6, y: 5 }], { unitId: 'right-1x1' }),
      );
      const leftTurn = engine.endTurn(rightClaimed);

      expect(leftTurn.currentPlayer).toBe('LEFT');
      expect(leftTurn.activeUnitId).toBeUndefined();
      expect(movementOf(leftTurn)).toEqual({
        'left-1x1': 5,
        'left-spent': 5,
        'right-1x1': 4,
        'right-exhausted': 5,
        'right-fresh': 5,
      });
    });

    it('changes nothing but the restored movement', () => {
      const next = engine.endTurn(turnState());

      expect(unitIn(next, 'right-1x1')).toEqual({
        ...right,
        remainingMovement: right.moveRange,
      });
      expect(unitIn(next, 'right-exhausted')).toEqual({
        ...rightExhausted,
        remainingMovement: rightExhausted.moveRange,
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

  it('creates new objects only for the units whose movement is restored', () => {
    const state = turnState();

    const next = engine.endTurn(state);

    expect(next.units).not.toBe(state.units);
    expect(unitIn(next, 'right-1x1')).not.toBe(right);
    expect(unitIn(next, 'right-exhausted')).not.toBe(rightExhausted);
    expect(unitIn(next, 'right-fresh')).toBe(rightFresh);
    expect(unitIn(next, 'left-1x1')).toBe(left);
    expect(unitIn(next, 'left-spent')).toBe(leftSpent);
    expect(right.remainingMovement).toBe(1.5);
    expect(rightExhausted.remainingMovement).toBe(0);
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
