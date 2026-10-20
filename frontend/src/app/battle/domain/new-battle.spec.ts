import { describe, expect, it } from 'vitest';
import type { BattleState, Position } from './battle-state';
import { validateNewBattle } from './new-battle';
import {
  FOOTPRINTS,
  testOrb,
  testState,
  testUnit,
  testWall,
} from './testing/battle-fixtures';

const leftOrb = testOrb({
  id: 'left-orb',
  owner: 'LEFT',
  position: { x: 0, y: 7 },
});
const rightOrb = testOrb();

describe('validateNewBattle', () => {
  it('accepts exactly one living orb per side', () => {
    const state = testState({ orbs: [leftOrb, rightOrb] });

    expect(validateNewBattle(state)).toEqual({ ok: true, value: state });
  });

  it('accepts orbs with 1 HP left', () => {
    const state = testState({
      orbs: [
        { ...leftOrb, health: 1 },
        { ...rightOrb, health: 1 },
      ],
    });

    expect(validateNewBattle(state).ok).toBe(true);
  });

  it.each([
    ['LEFT', [rightOrb]],
    ['RIGHT', [leftOrb]],
  ] as const)('rejects a battle without a %s orb', (side, orbs) => {
    expect(validateNewBattle(testState({ orbs }))).toEqual({
      ok: false,
      error: { type: 'INVALID_ORBS', side, reason: 'MISSING' },
    });
  });

  it('rejects a battle without any orb, reporting LEFT first', () => {
    expect(validateNewBattle(testState({ orbs: [] }))).toEqual({
      ok: false,
      error: { type: 'INVALID_ORBS', side: 'LEFT', reason: 'MISSING' },
    });
  });

  it.each([
    ['LEFT', [{ ...leftOrb, health: 0 }, rightOrb]],
    ['RIGHT', [leftOrb, { ...rightOrb, health: 0 }]],
  ] as const)(
    'rejects a %s orb at 0 HP rather than starting a finished battle',
    (side, orbs) => {
      expect(validateNewBattle(testState({ orbs }))).toEqual({
        ok: false,
        error: { type: 'INVALID_ORBS', side, reason: 'DESTROYED' },
      });
    },
  );

  it('rejects two destroyed orbs, reporting LEFT first', () => {
    const state = testState({
      orbs: [
        { ...leftOrb, health: 0 },
        { ...rightOrb, health: 0 },
      ],
    });

    expect(validateNewBattle(state)).toEqual({
      ok: false,
      error: { type: 'INVALID_ORBS', side: 'LEFT', reason: 'DESTROYED' },
    });
  });

  it('rejects a second orb of one side', () => {
    const state = testState({
      orbs: [leftOrb, rightOrb, { ...rightOrb, id: 'right-orb-2' }],
    });

    expect(validateNewBattle(state)).toEqual({
      ok: false,
      error: { type: 'INVALID_ORBS', side: 'RIGHT', reason: 'DUPLICATE' },
    });
  });

  describe('board geometry', () => {
    // testState() is an 8×8 board, so x and y run from 0 to 7.
    const orbs = [leftOrb, rightOrb];
    const leftOffset = [
      { x: 0, y: 0 },
      { x: -1, y: 0 },
    ];

    function withUnit(position: Position, footprint: readonly Position[]) {
      return testState({ orbs, units: [testUnit({ position, footprint })] });
    }

    function withTerrainAt(position: Position) {
      const state = testState({ orbs });
      return {
        ...state,
        board: {
          ...state.board,
          terrain: [...state.board.terrain, { position, type: 'PLAIN' }],
        },
      } satisfies BattleState;
    }

    it.each([
      ['in the bottom-left corner', { x: 0, y: 0 }, FOOTPRINTS['1x1']],
      ['in the top-right corner', { x: 7, y: 7 }, FOOTPRINTS['1x1']],
      [
        '2×2 flush with the top and right edges',
        { x: 6, y: 6 },
        FOOTPRINTS['2x2'],
      ],
      ['with a negative offset still on the board', { x: 1, y: 2 }, leftOffset],
    ])('accepts a unit %s', (_, position, footprint) => {
      expect(validateNewBattle(withUnit(position, footprint)).ok).toBe(true);
    });

    it.each([
      [
        'an anchor at x = -1',
        { x: -1, y: 2 },
        FOOTPRINTS['1x1'],
        { x: -1, y: 2 },
      ],
      [
        'an anchor at y = -1',
        { x: 2, y: -1 },
        FOOTPRINTS['1x1'],
        { x: 2, y: -1 },
      ],
      [
        'an anchor at x = width',
        { x: 8, y: 2 },
        FOOTPRINTS['1x1'],
        { x: 8, y: 2 },
      ],
      [
        'an anchor at y = height',
        { x: 2, y: 8 },
        FOOTPRINTS['1x1'],
        { x: 2, y: 8 },
      ],
      [
        'a 2×2 footprint past the edges of an on-board anchor',
        { x: 7, y: 7 },
        FOOTPRINTS['2x2'],
        { x: 8, y: 7 },
      ],
      [
        'a negative offset past the left edge',
        { x: 0, y: 2 },
        leftOffset,
        { x: -1, y: 2 },
      ],
      [
        'an off-board anchor whose only cell is on the board',
        { x: -1, y: 2 },
        [{ x: 1, y: 0 }],
        { x: -1, y: 2 },
      ],
    ])('rejects a unit with %s', (_, position, footprint, cell) => {
      expect(validateNewBattle(withUnit(position, footprint))).toEqual({
        ok: false,
        error: { type: 'OUT_OF_BOARD', object: 'UNIT', id: 'left-1x1', cell },
      });
    });

    it('accepts a wall reaching the top edge and rejects one past it', () => {
      const wall = (y: number) =>
        testState({ orbs, walls: [testWall({ position: { x: 5, y } })] });

      expect(validateNewBattle(wall(5)).ok).toBe(true);
      expect(validateNewBattle(wall(6))).toEqual({
        ok: false,
        error: {
          type: 'OUT_OF_BOARD',
          object: 'WALL',
          id: 'right-wall',
          cell: { x: 5, y: 8 },
        },
      });
    });

    it('accepts an orb reaching the right edge and rejects one past it', () => {
      const orb = (x: number) =>
        testState({
          orbs: [
            leftOrb,
            {
              ...rightOrb,
              position: { x, y: 3 },
              footprint: FOOTPRINTS['2x1'],
            },
          ],
        });

      expect(validateNewBattle(orb(6)).ok).toBe(true);
      expect(validateNewBattle(orb(7))).toEqual({
        ok: false,
        error: {
          type: 'OUT_OF_BOARD',
          object: 'ORB',
          id: 'right-orb',
          cell: { x: 8, y: 3 },
        },
      });
    });

    it.each([
      { x: 8, y: 0 },
      { x: -1, y: 0 },
    ])('rejects a terrain cell at %o', (cell) => {
      expect(validateNewBattle(withTerrainAt(cell))).toEqual({
        ok: false,
        error: { type: 'OUT_OF_BOARD', object: 'TERRAIN', cell },
      });
    });

    it('accepts a board with a cell missing from its terrain', () => {
      const state = testState({ orbs, withoutTerrain: [{ x: 3, y: 3 }] });

      expect(validateNewBattle(state).ok).toBe(true);
    });

    it('reports an object before a terrain cell when both are off the board', () => {
      const state = withTerrainAt({ x: 8, y: 0 });
      const withWallOff = {
        ...state,
        walls: [testWall({ position: { x: 5, y: 6 } })],
      };

      expect(validateNewBattle(withWallOff)).toEqual({
        ok: false,
        error: {
          type: 'OUT_OF_BOARD',
          object: 'WALL',
          id: 'right-wall',
          cell: { x: 5, y: 8 },
        },
      });
    });

    it('reports the orbs first when a state also has a unit off the board', () => {
      const state = testState({
        orbs: [rightOrb],
        units: [testUnit({ position: { x: 8, y: 2 } })],
      });

      expect(validateNewBattle(state)).toEqual({
        ok: false,
        error: { type: 'INVALID_ORBS', side: 'LEFT', reason: 'MISSING' },
      });
    });
  });
});
