import type {
  BattleState,
  Orb,
  PlayerSide,
  Position,
  TerrainCell,
  Unit,
  Wall,
} from '../battle-state';
import { positionKey } from '../geometry';

/** Test-only builders for battle specs; never imported by application code. */

export const FOOTPRINTS = {
  '1x1': [{ x: 0, y: 0 }],
  '2x1': [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ],
  '2x2': [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ],
  '1x3': [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: 2 },
  ],
} as const satisfies Record<string, readonly Position[]>;

/** A LEFT 1×1 unit at (2,2) with 5 movement, unless overridden. */
export function testUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'left-1x1',
    owner: 'LEFT',
    unitType: 'SWORDSMAN',
    position: { x: 2, y: 2 },
    footprint: FOOTPRINTS['1x1'],
    health: 10,
    attack: 4,
    defense: 2,
    moveRange: 5,
    remainingMovement: 5,
    ...overrides,
  };
}

export interface TestStateOptions {
  readonly width?: number;
  readonly height?: number;
  readonly rocks?: readonly Position[];
  /** Cells left out of the terrain list entirely. */
  readonly withoutTerrain?: readonly Position[];
  readonly units?: readonly Unit[];
  readonly walls?: readonly Wall[];
  readonly orbs?: readonly Orb[];
  readonly currentPlayer?: PlayerSide;
}

/**
 * A board with terrain for every cell, like the backend sends: PLAIN except
 * for the given rocks. Defaults to an 8×8 board holding one `testUnit()`.
 */
export function testState({
  width = 8,
  height = 8,
  rocks = [],
  withoutTerrain = [],
  units = [testUnit()],
  walls = [],
  orbs = [],
  currentPlayer = 'LEFT',
}: TestStateOptions = {}): BattleState {
  const rockKeys = new Set(rocks.map(positionKey));
  const missingKeys = new Set(withoutTerrain.map(positionKey));
  const terrain: TerrainCell[] = [];
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const key = positionKey({ x, y });
      if (!missingKeys.has(key)) {
        terrain.push({
          position: { x, y },
          type: rockKeys.has(key) ? 'ROCK' : 'PLAIN',
        });
      }
    }
  }
  return {
    board: { width, height, terrain },
    orbs,
    walls,
    units,
    currentPlayer,
  };
}
