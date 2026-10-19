import { describe, expect, it } from 'vitest';
import { validateNewBattle } from './new-battle';
import { testOrb, testState } from './testing/battle-fixtures';

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
});
