import { test, expect, type Page } from '@playwright/test';
import type {
  BattleStateResponse,
  PositionDto,
  UnitDto,
} from '../src/app/api/generated/model';

const WIDTH = 6;
const HEIGHT = 4;

function unit(
  id: string,
  owner: 'LEFT' | 'RIGHT',
  position: PositionDto,
  footprint: PositionDto[],
  moveRange: number,
): UnitDto {
  return {
    id,
    owner,
    unitType: 'SWORDSMAN',
    position,
    footprint,
    health: 100,
    attack: 10,
    defense: 5,
    moveRange,
  };
}

// 6x4 PLAIN board, terrain listed x-major (index = x * HEIGHT + y):
// - LEFT 1x1 at (0,0) with 2 movement;
// - LEFT 2x1 at (2,2), covering (2,2) and (3,2), with 1 movement;
// - RIGHT 1x1 at (5,0).
const battleState: BattleStateResponse = {
  board: {
    width: WIDTH,
    height: HEIGHT,
    terrain: Array.from({ length: WIDTH }, (_, x) =>
      Array.from({ length: HEIGHT }, (_, y) => ({
        position: { x, y },
        type: 'PLAIN' as const,
      })),
    ).flat(),
  },
  units: [
    unit('left-small', 'LEFT', { x: 0, y: 0 }, [{ x: 0, y: 0 }], 2),
    unit(
      'left-wide',
      'LEFT',
      { x: 2, y: 2 },
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      1,
    ),
    unit('right-small', 'RIGHT', { x: 5, y: 0 }, [{ x: 0, y: 0 }], 3),
  ],
  orbs: [],
  walls: [],
};

async function openBoard(page: Page) {
  await page.route('**/api/v1/battles/demo', (route) =>
    route.fulfill({ json: battleState }),
  );
  await page.goto('/battle/demo');
  await expect(page.locator('.board-grid')).toBeVisible();
}

// These tests click and hover at a cell's screen position, so whichever board
// layer is on top there receives the event. That is the point: they guard the
// layer precedence (terrain, units, movement targets), which element.click()
// cannot detect.
async function cellCentre(page: Page, x: number, y: number) {
  const cell = page.locator('app-cell').nth(x * HEIGHT + y);
  // page.mouse works in viewport coordinates, so the cell must be on screen.
  await cell.scrollIntoViewIfNeeded();
  const box = await cell.boundingBox();
  if (!box) throw new Error(`Cell (${x},${y}) has no bounding box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function clickCell(page: Page, x: number, y: number) {
  const centre = await cellCentre(page, x, y);
  await page.mouse.click(centre.x, centre.y);
}

async function hoverCell(page: Page, x: number, y: number) {
  const centre = await cellCentre(page, x, y);
  await page.mouse.move(centre.x, centre.y);
}

/** Every rendered unit cell as "OWNER@x,y" in domain coordinates. */
function unitCells(page: Page): Promise<string[]> {
  return page.locator('button.entity-cell[data-kind="unit"]').evaluateAll(
    (cells, height) =>
      cells.map((cell) => {
        const { style, dataset } = cell as HTMLElement;
        const x = Number(style.gridColumnStart) - 1;
        const y = height - Number(style.gridRowStart);
        return `${dataset['owner']}@${x},${y}`;
      }),
    HEIGHT,
  );
}

const targets = (page: Page) => page.locator('button.movement-target');
const selectedCells = (page: Page) => page.locator('.entity-cell.selected');

test.describe('movement with real pointer interaction', () => {
  test('selecting a LEFT unit shows its movement targets', async ({ page }) => {
    await openBoard(page);

    await clickCell(page, 0, 0);

    await expect(targets(page)).toHaveCount(5);
    await expect(
      page.getByRole('button', { name: 'Move to (2, 0), cost 2' }),
    ).toBeVisible();
  });

  test('hovering a target previews its path and cost, and leaving removes it', async ({
    page,
  }) => {
    await openBoard(page);
    await clickCell(page, 0, 0);

    await hoverCell(page, 2, 0);
    await expect(page.locator('.preview-cost')).toHaveText('2');
    await expect(page.locator('.movement-path polyline')).toHaveAttribute(
      'points',
      '0.5,3.5 1.5,3.5 2.5,3.5',
    );

    // (1,0) lies under the drawn path; the path must not steal its hover.
    await hoverCell(page, 1, 0);
    await expect(page.locator('.preview-cost')).toHaveText('1');

    await page.mouse.move(1, 1);
    await expect(page.locator('.movement-path')).toHaveCount(0);
    await expect(page.locator('.preview-cost')).toHaveCount(0);
  });

  test('clicking a target moves the unit and spends its movement', async ({
    page,
  }) => {
    await openBoard(page);
    await clickCell(page, 0, 0);

    await clickCell(page, 2, 0);

    await expect.poll(() => unitCells(page)).toContain('LEFT@2,0');
    await expect(selectedCells(page)).toHaveCount(1);
    await expect(targets(page)).toHaveCount(0);
  });

  test("a target overlapping the selected unit's own cells receives the click", async ({
    page,
  }) => {
    await openBoard(page);
    await clickCell(page, 2, 2);
    await expect(selectedCells(page)).toHaveCount(2);
    await expect(targets(page)).toHaveCount(4);

    // (3,2) is covered by the selected 2x1 unit itself.
    await clickCell(page, 3, 2);

    await expect
      .poll(() => unitCells(page))
      .toEqual(['LEFT@0,0', 'LEFT@3,2', 'LEFT@4,2', 'RIGHT@5,0']);
  });

  test('friendly and enemy units outside the range stay selectable', async ({
    page,
  }) => {
    await openBoard(page);
    await clickCell(page, 0, 0);
    await expect(targets(page)).toHaveCount(5);

    await clickCell(page, 2, 2);
    await expect(selectedCells(page)).toHaveCount(2);

    await clickCell(page, 5, 0);
    await expect(
      page.locator('.entity-cell.selected[data-owner="RIGHT"]'),
    ).toHaveCount(1);
  });

  test('a RIGHT unit can be inspected but its move is rejected', async ({
    page,
  }) => {
    await openBoard(page);
    await clickCell(page, 5, 0);
    await expect(
      page.getByRole('button', { name: 'Move to (4, 0), cost 1' }),
    ).toBeVisible();

    await hoverCell(page, 4, 0);
    await expect(page.locator('.preview-cost')).toHaveText('1');
    await expect(page.locator('.movement-path polyline')).toHaveAttribute(
      'points',
      '5.5,3.5 4.5,3.5',
    );

    await clickCell(page, 4, 0);

    await expect(page.locator('.last-outcome')).toHaveText(
      'Move rejected: UNIT_CANNOT_MOVE',
    );
    await expect(page.locator('.unit-movement')).toHaveText(
      'right-small (RIGHT) · Move 0 / 3 · remaining 3',
    );
    expect(await unitCells(page)).toContain('RIGHT@5,0');
  });

  test('a terrain cell that is not a target still clears the selection', async ({
    page,
  }) => {
    await openBoard(page);
    await clickCell(page, 0, 0);
    await expect(targets(page)).toHaveCount(5);

    await clickCell(page, 4, 3);

    await expect(selectedCells(page)).toHaveCount(0);
    await expect(targets(page)).toHaveCount(0);
  });
});

test.describe('movement information and reset', () => {
  test('the panel shows the preview, spent and remaining movement, and the last move', async ({
    page,
  }) => {
    await openBoard(page);
    await clickCell(page, 0, 0);
    await expect(page.locator('.unit-movement')).toHaveText(
      'left-small (LEFT) · Move 0 / 2 · remaining 2',
    );

    await hoverCell(page, 2, 0);
    await expect(page.locator('.preview')).toHaveText(
      'Preview: cost 2 · (0,0) → (1,0) → (2,0)',
    );

    await clickCell(page, 2, 0);

    await expect(page.locator('.unit-movement')).toHaveText(
      'left-small (LEFT) · Move 2 / 2 · remaining 0',
    );
    await expect(page.locator('.spent-label')).toHaveText('2');
    await expect(page.locator('.last-outcome')).toHaveText(
      'LEFT moved left-small (0,0) → (2,0) · cost 2',
    );
  });

  test('the reset control restores movement for a further move', async ({
    page,
  }) => {
    await openBoard(page);
    await clickCell(page, 0, 0);
    await clickCell(page, 2, 0);
    await expect(targets(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Reset movement (dev)' }).click();

    await expect(page.locator('.last-outcome')).toHaveText(
      'Movement reset for left-small',
    );
    await expect(targets(page)).not.toHaveCount(0);

    await clickCell(page, 3, 0);
    await expect.poll(() => unitCells(page)).toContain('LEFT@3,0');
  });
});
