import { test, expect, type Page } from '@playwright/test';
import type {
  BattleStateResponse,
  PositionDto,
  UnitDto,
} from '../src/app/api/generated/model';

const WIDTH = 5;
const HEIGHT = 3;

function unit(
  id: string,
  owner: 'LEFT' | 'RIGHT',
  position: PositionDto,
): UnitDto {
  return {
    id,
    owner,
    unitType: 'SWORDSMAN',
    position,
    footprint: [{ x: 0, y: 0 }],
    health: 100,
    maxHealth: 100,
    attack: 10,
    defense: 5,
    actionPointBudget: 6,
    movementCostFactor: 1,
    attackActionPointCost: 2,
  };
}

// 5x3 PLAIN board, terrain listed x-major (index = x * HEIGHT + y). The LEFT
// attacker at (1,1) (attack 10, 6 AP) is surrounded orthogonally by:
// - a RIGHT unit at (2,1): 100 HP, defense 5;
// - a RIGHT 2x1 wall covering (1,2) and (2,2): 5 HP, defense 0;
// - a RIGHT orb at (0,1): 5 HP, defense 0;
// - a friendly LEFT unit at (1,0).
// The LEFT orb at (4,0), out of everyone's reach, is only there because a new
// battle needs one living orb per side.
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
    unit('left-1', 'LEFT', { x: 1, y: 1 }),
    unit('left-2', 'LEFT', { x: 1, y: 0 }),
    unit('right-1', 'RIGHT', { x: 2, y: 1 }),
  ],
  walls: [
    {
      id: 'wall-right',
      owner: 'RIGHT',
      position: { x: 1, y: 2 },
      footprint: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      health: 5,
      maxHealth: 5,
      defense: 0,
    },
  ],
  orbs: [
    {
      id: 'orb-right',
      owner: 'RIGHT',
      position: { x: 0, y: 1 },
      footprint: [{ x: 0, y: 0 }],
      health: 5,
      maxHealth: 5,
      defense: 0,
    },
    {
      id: 'orb-left',
      owner: 'LEFT',
      position: { x: 4, y: 0 },
      footprint: [{ x: 0, y: 0 }],
      health: 75,
      maxHealth: 75,
      defense: 0,
    },
  ],
  currentPlayer: 'LEFT',
};

async function openBoard(page: Page) {
  await page.route('**/api/v1/battles/demo', (route) =>
    route.fulfill({ json: battleState }),
  );
  await page.goto('/battle/demo');
  await expect(page.locator('.board-grid')).toBeVisible();
}

// Clicks at a cell's screen position, so whichever board layer is on top
// there receives the event, as in the movement tests: this guards that attack
// targets, including walls and orbs, actually take the pointer.
async function clickCell(page: Page, x: number, y: number) {
  const cell = page.locator('app-cell').nth(x * HEIGHT + y);
  await cell.scrollIntoViewIfNeeded();
  const box = await cell.boundingBox();
  if (!box) throw new Error(`Cell (${x},${y}) has no bounding box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function selectAttacker(page: Page) {
  await clickCell(page, 1, 1);
  await page.locator('.mode-button[data-mode="ATTACK"]').click();
}

const outcome = (page: Page) => page.locator('.last-outcome');
const attackerInfo = (page: Page) => page.locator('.unit-movement');

test.describe('attacks with real pointer interaction', () => {
  test('ATTACK mode offers only the enemy unit, wall and orb in reach', async ({
    page,
  }) => {
    await openBoard(page);

    await selectAttacker(page);

    await expect(page.locator('.attack-target')).toHaveCount(4);
    await expect(
      page.getByRole('button', {
        name: 'Attack RIGHT unit right-1, 100/100 HP',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Attack RIGHT orb orb-right, 5/5 HP' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: 'Attack RIGHT wall wall-right, 5/5 HP',
      }),
    ).toHaveCount(2);
  });

  test('attacking an adjacent enemy unit updates its HP, the outcome and the AP', async ({
    page,
  }) => {
    await openBoard(page);
    await selectAttacker(page);

    await clickCell(page, 2, 1);

    await expect(outcome(page)).toHaveText(
      'LEFT left-1 attacked UNIT right-1 · damage 5 · remaining HP 95 · cost 2 AP',
    );
    await expect(attackerInfo(page)).toContainText('remaining 4');
    const target = page.getByRole('button', {
      name: 'Attack RIGHT unit right-1, 95/100 HP',
    });
    await expect(target).toBeVisible();
    await expect(target).toHaveClass(/attacked/);
  });

  test('clicking a friendly unit selects it instead of attacking', async ({
    page,
  }) => {
    await openBoard(page);
    await selectAttacker(page);

    await clickCell(page, 1, 0);

    await expect(outcome(page)).toHaveText('');
    await expect(attackerInfo(page)).toContainText('left-2');
  });

  test('a wall destroyed through one of its cells disappears, and its cells become passable', async ({
    page,
  }) => {
    await openBoard(page);
    await selectAttacker(page);

    // (2,2) is the wall's second cell, not its anchor.
    await clickCell(page, 2, 2);

    await expect(page.locator('.entity-cell[data-kind="wall"]')).toHaveCount(0);
    await expect(outcome(page)).toContainText('remaining HP 0');
    await expect(outcome(page)).toContainText('destroyed');

    await page.locator('.mode-button[data-mode="MOVE"]').click();
    await clickCell(page, 1, 2);

    await expect(outcome(page)).toHaveText(
      'LEFT moved left-1 (1,1) → (1,2) · cost 1 AP',
    );
    await expect(attackerInfo(page)).toContainText('remaining 3');
  });

  test('a destroyed orb stays on the board, drawn as destroyed', async ({
    page,
  }) => {
    await openBoard(page);
    await selectAttacker(page);

    await clickCell(page, 0, 1);

    const orb = page.locator(
      '.entity-cell[data-kind="orb"][data-owner="RIGHT"]',
    );
    await expect(orb).toHaveCount(1);
    await expect(orb).toHaveAttribute('data-destroyed', 'true');
    await expect(orb).toHaveCSS('filter', 'grayscale(1)');
    await expect(outcome(page)).toContainText('attacked ORB orb-right');
    await expect(outcome(page)).toContainText('destroyed');
  });

  test("ATTACK mode marks the selected unit's reach, and MOVE mode hides it", async ({
    page,
  }) => {
    await openBoard(page);
    await selectAttacker(page);

    await expect(page.locator('.attack-range-cell')).toHaveCount(4);

    await page.locator('.mode-button[data-mode="MOVE"]').click();

    await expect(page.locator('.attack-range-cell')).toHaveCount(0);
  });

  test('the reach of a unit that may not attack is shown, without targets', async ({
    page,
  }) => {
    await openBoard(page);
    // Selected in MOVE mode, where a click on the enemy only selects it.
    await clickCell(page, 2, 1);
    await page.locator('.mode-button[data-mode="ATTACK"]').click();

    await expect(page.locator('.attack-range-cell')).toHaveCount(4);
    await expect(page.locator('.attack-target')).toHaveCount(0);
  });

  // Labels follow the cell order: the wall, the RIGHT orb, the LEFT orb, then
  // left-1, left-2, right-1.
  const healthValues = (page: Page) => page.locator('.health-label-value');

  test("every unit, wall and orb shows current/max HP, and the attacked unit's label follows the attack", async ({
    page,
  }) => {
    await openBoard(page);
    await expect(healthValues(page)).toHaveText([
      '5/5',
      '5/5',
      '75/75',
      '100/100',
      '100/100',
      '100/100',
    ]);

    await selectAttacker(page);
    await clickCell(page, 2, 1);

    await expect(healthValues(page)).toHaveText([
      '5/5',
      '5/5',
      '75/75',
      '100/100',
      '100/100',
      '95/100',
    ]);
  });

  test('a destroyed wall loses its label, while a destroyed orb keeps its label at 0 HP', async ({
    page,
  }) => {
    await openBoard(page);
    await selectAttacker(page);

    await clickCell(page, 2, 2);
    await clickCell(page, 0, 1);

    await expect(healthValues(page)).toHaveText([
      '0/5',
      '75/75',
      '100/100',
      '100/100',
      '100/100',
    ]);
  });

  test('a click on an HP label reaches the entity beneath it', async ({
    page,
  }) => {
    await openBoard(page);
    const labels = page.locator('.health-label');
    const clickCentre = async (index: number) => {
      // page.mouse works in viewport coordinates, so the label must be on screen.
      await labels.nth(index).scrollIntoViewIfNeeded();
      const box = await labels.nth(index).boundingBox();
      if (!box) throw new Error(`HP label ${index} has no bounding box`);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    };

    // MOVE mode: the label of left-2 selects left-2.
    await clickCentre(4);
    await expect(attackerInfo(page)).toContainText('left-2');

    // ATTACK mode: the label of the target right-1 attacks it, and so does
    // the label of the target wall.
    await selectAttacker(page);
    await clickCentre(5);
    await expect(outcome(page)).toHaveText(
      'LEFT left-1 attacked UNIT right-1 · damage 5 · remaining HP 95 · cost 2 AP',
    );
    await clickCentre(0);
    await expect(outcome(page)).toContainText('attacked WALL wall-right');
  });
});
