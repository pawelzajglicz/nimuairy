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

  it("rejects the other player's unit", () => {
    const right = testUnit({
      id: 'right-1x1',
      owner: 'RIGHT',
      position: { x: 5, y: 5 },
    });

    expect(
      engine.reachability(
        testState({ units: [testUnit(), right] }),
        'right-1x1',
      ),
    ).toEqual({
      ok: false,
      error: { type: 'UNIT_CANNOT_MOVE', unitId: 'right-1x1' },
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
