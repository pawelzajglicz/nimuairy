import { test, expect, type Locator, type Page } from '@playwright/test';
import type { BattleStateResponse } from '../src/app/api/generated/model';

// 5x3 board: units at (0,0) and (1,2), a 3-cell wall column at x=2, orb at (4,1).
// (1,1) is an empty cell. Terrain is listed x-major, so index = x * 3 + y.
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
    {
      id: 'unit-2',
      owner: 'RIGHT',
      unitType: 'SWORDSMAN',
      position: { x: 1, y: 2 },
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

const EMPTY_CELL_INDEX = 1 * 3 + 1;

// These tests must go through real pointer hit-testing (locator.click / page.mouse),
// not HTMLElement.click(): the bug they guard against was an overlay swallowing
// clicks, which element.click() cannot detect.
async function openBoard(page: Page) {
  await page.route('**/api/v1/battles/demo', (route) =>
    route.fulfill({ json: battleState }),
  );
  await page.goto('/battle/demo');
  await expect(page.locator('.board-grid')).toBeVisible();
}

async function clickCenterOf(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Element has no bounding box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('unit selection with real pointer clicks', () => {
  test('clicking a unit selects it and shows the selection ring', async ({
    page,
  }) => {
    await openBoard(page);
    const unit = page.locator('button.entity-cell[data-kind="unit"]').first();

    await unit.click();

    await expect(unit).toHaveClass(/selected/);
    await expect(unit).not.toHaveAttribute('aria-pressed');
    await expect(
      page.locator('button.entity-cell[data-kind="unit"]').nth(1),
    ).toHaveClass(/dimmed/);
  });

  test('the selected unit pulses, and stops pulsing under reduced motion while keeping the halo', async ({
    page,
  }) => {
    await openBoard(page);
    const unit = page.locator('button.entity-cell[data-kind="unit"]').first();
    const animationName = () =>
      unit.evaluate((el) => getComputedStyle(el).animationName);
    const hasHalo = () =>
      unit.evaluate((el) => getComputedStyle(el).boxShadow !== 'none');

    await unit.click();
    await expect(unit).toHaveClass(/selected/);
    // Angular prefixes @keyframes names under emulated encapsulation.
    expect(await animationName()).toMatch(/selection-pulse$/);
    expect(await hasHalo()).toBe(true);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await animationName()).toBe('none');
    expect(await hasHalo()).toBe(true);
    await expect(
      page.locator('button.entity-cell[data-kind="unit"]').nth(1),
    ).toHaveClass(/dimmed/);
  });

  test('clicking an empty cell clears the selection', async ({ page }) => {
    await openBoard(page);
    const unit = page.locator('button.entity-cell[data-kind="unit"]').first();
    await unit.click();
    await expect(unit).toHaveClass(/selected/);

    await page
      .locator('app-cell')
      .nth(EMPTY_CELL_INDEX)
      .locator('button')
      .click();

    await expect(page.locator('.entity-cell.selected')).toHaveCount(0);
    await expect(page.locator('.entity-cell.dimmed')).toHaveCount(0);
  });

  test('clicking a wall clears the selection', async ({ page }) => {
    await openBoard(page);
    const unit = page.locator('button.entity-cell[data-kind="unit"]').first();
    await unit.click();
    await expect(unit).toHaveClass(/selected/);

    await clickCenterOf(
      page,
      page.locator('.entity-cell[data-kind="wall"]').first(),
    );

    await expect(page.locator('.entity-cell.selected')).toHaveCount(0);
  });

  test('clicking an orb clears the selection', async ({ page }) => {
    await openBoard(page);
    const unit = page.locator('button.entity-cell[data-kind="unit"]').first();
    await unit.click();
    await expect(unit).toHaveClass(/selected/);

    await clickCenterOf(page, page.locator('.entity-cell[data-kind="orb"]'));

    await expect(page.locator('.entity-cell.selected')).toHaveCount(0);
  });
});

test.describe('interaction mode controls', () => {
  const modeButton = (page: Page, mode: 'MOVE' | 'ATTACK') =>
    page.locator(`.mode-button[data-mode="${mode}"]`);

  test('MOVE is active by default and the buttons toggle the pressed state', async ({
    page,
  }) => {
    await openBoard(page);

    await expect(modeButton(page, 'MOVE')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(modeButton(page, 'ATTACK')).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await modeButton(page, 'ATTACK').click();
    await expect(modeButton(page, 'ATTACK')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(modeButton(page, 'MOVE')).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await modeButton(page, 'MOVE').click();
    await expect(modeButton(page, 'MOVE')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('switching mode keeps the selected unit and swaps its ring style', async ({
    page,
  }) => {
    await openBoard(page);
    const unit = page.locator('button.entity-cell[data-kind="unit"]').first();
    const other = page.locator('button.entity-cell[data-kind="unit"]').nth(1);
    const animationName = () =>
      unit.evaluate((el) => getComputedStyle(el).animationName);
    const ringCount = () =>
      unit.evaluate(
        (el) => getComputedStyle(el).boxShadow.split('rgb').length - 1,
      );

    await unit.click();
    await expect(unit).toHaveAttribute('data-selection-mode', 'MOVE');
    expect(await ringCount()).toBe(2);
    expect(await animationName()).toMatch(/selection-pulse$/);

    await modeButton(page, 'ATTACK').click();
    await expect(unit).toHaveClass(/selected/);
    await expect(unit).toHaveAttribute('data-selection-mode', 'ATTACK');
    await expect(other).toHaveClass(/dimmed/);
    expect(await ringCount()).toBe(4);
    expect(await animationName()).toMatch(/selection-pulse-attack$/);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await animationName()).toBe('none');
    expect(await ringCount()).toBe(4);

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await modeButton(page, 'MOVE').click();
    await expect(unit).toHaveAttribute('data-selection-mode', 'MOVE');
    expect(await ringCount()).toBe(2);
  });
});
