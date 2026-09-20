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
      attack: 10,
      defense: 5,
      moveRange: 3,
    },
  ],
  orbs: [
    {
      id: 'orb-1',
      owner: 'RIGHT',
      position: { x: 4, y: 1 },
      footprint: [{ x: 0, y: 0 }],
      health: 75,
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
    },
  ],
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

  // 1 unit cell + 1 orb cell + 3 wall cells (footprint expansion)
  await expect(page.locator('.entity-cell')).toHaveCount(5);
  await expect(page.locator('.entity-cell[data-kind="wall"]')).toHaveCount(3);
});
