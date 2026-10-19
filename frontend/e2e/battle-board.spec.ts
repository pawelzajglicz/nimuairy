import { test, expect } from '@playwright/test';
import type { BattleStateResponse } from '../src/app/api/generated/model';

// A small, made-up battle state — deliberately not mirroring the backend's
// real demo data, so this test stays valid even if that data changes.
// The wall's 3-cell footprint is the important part: it checks that the
// board renders footprints as offsets from a position, not one entity per cell.
const battleState: BattleStateResponse = {
  board: {
    width: 5,
    height: 3,
    terrain: Array.from({ length: 5 }, (_, x) =>
      Array.from({ length: 3 }, (_, y) => ({
        position: { x, y },
        type: 'PLAIN' as const,
      })),
    ).flat(),
  },
  units: [
    {
      id: 'unit-1',
      owner: 'LEFT',
      unitType: 'SWORDSMAN',
      position: { x: 0, y: 0 },
      footprint: [{ x: 0, y: 0 }],
      health: 100,
      maxHealth: 100,
      attack: 10,
      defense: 5,
      actionPointBudget: 3,
      movementCostFactor: 1,
      attackActionPointCost: 2,
    },
  ],
  orbs: [
    {
      id: 'orb-1',
      owner: 'RIGHT',
      position: { x: 4, y: 1 },
      footprint: [{ x: 0, y: 0 }],
      health: 75,
      maxHealth: 75,
      defense: 0,
    },
    {
      id: 'orb-2',
      owner: 'LEFT',
      position: { x: 0, y: 2 },
      footprint: [{ x: 0, y: 0 }],
      health: 75,
      maxHealth: 75,
      defense: 0,
    },
  ],
  walls: [
    {
      id: 'wall-1',
      owner: 'LEFT',
      position: { x: 2, y: 0 },
      footprint: [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: 2 },
      ],
      health: 1500,
      maxHealth: 1500,
      defense: 100,
    },
  ],
  currentPlayer: 'LEFT',
};

test('battle board renders terrain cells and entity footprints from the API state', async ({
  page,
}) => {
  await page.route('**/api/v1/battles/demo', (route) =>
    route.fulfill({ json: battleState }),
  );

  await page.goto('/battle/demo');

  const grid = page.locator('.board-grid');
  await expect(grid).toBeVisible();
  await expect(grid.locator('.cell')).toHaveCount(5 * 3);

  // 1 unit cell + 2 orb cells + 3 wall cells (footprint expansion)
  await expect(page.locator('.entity-cell')).toHaveCount(6);
  await expect(page.locator('.entity-cell[data-kind="wall"]')).toHaveCount(3);
});

// A demo-sized board, where cells are narrow: the 2x11 wall's 1000/1000 HP
// label is wider than its cell and must not stretch the entity layer's grid.
test('entity cells stay aligned with terrain cells when an HP label is wider than its cell', async ({
  page,
}) => {
  const width = 21;
  const height = 11;
  const wallFootprint = [0, 1].flatMap((x) =>
    Array.from({ length: height }, (_, y) => ({ x, y })),
  );
  const demoSized: BattleStateResponse = {
    board: {
      width,
      height,
      terrain: Array.from({ length: width }, (_, x) =>
        Array.from({ length: height }, (_, y) => ({
          position: { x, y },
          type: 'PLAIN' as const,
        })),
      ).flat(),
    },
    units: [],
    // A new battle needs one living orb per side.
    orbs: (['LEFT', 'RIGHT'] as const).map((owner, index) => ({
      id: `orb-${owner}`,
      owner,
      position: { x: index * (width - 1), y: 5 },
      footprint: [{ x: 0, y: 0 }],
      health: 75,
      maxHealth: 75,
      defense: 0,
    })),
    walls: [
      {
        id: 'wall-left',
        owner: 'LEFT',
        position: { x: 1, y: 0 },
        footprint: wallFootprint,
        health: 1000,
        maxHealth: 1000,
        defense: 100,
      },
    ],
    currentPlayer: 'LEFT',
  };
  await page.route('**/api/v1/battles/demo', (route) =>
    route.fulfill({ json: demoSized }),
  );
  await page.goto('/battle/demo');
  await expect(page.locator('.health-label-value')).toHaveText([
    '1000/1000',
    '75/75',
    '75/75',
  ]);

  // Terrain is listed x-major (index = x * height + y); the wall's cells
  // render in footprint order, so its first cell is (1,0) and its last (2,10).
  const wallCells = page.locator('.entity-cell[data-kind="wall"]');
  for (const [wallIndex, x, y] of [
    [0, 1, 0],
    [2 * height - 1, 2, height - 1],
  ]) {
    const wallBox = await wallCells.nth(wallIndex).boundingBox();
    const terrainBox = await page
      .locator('app-cell')
      .nth(x * height + y)
      .boundingBox();
    // Within a pixel, for sub-pixel rounding; a stretched track is off by far more.
    expect(Math.abs(wallBox!.x - terrainBox!.x)).toBeLessThan(1);
    expect(Math.abs(wallBox!.width - terrainBox!.width)).toBeLessThan(1);
  }
});
