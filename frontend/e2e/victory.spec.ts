import { test, expect, type Page } from '@playwright/test';
import type {
  BattleStateResponse,
  OrbDto,
  PositionDto,
  UnitDto,
} from '../src/app/api/generated/model';

const WIDTH = 4;
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

function orb(
  id: string,
  owner: 'LEFT' | 'RIGHT',
  position: PositionDto,
): OrbDto {
  return {
    id,
    owner,
    position,
    footprint: [{ x: 0, y: 0 }],
    health: 5,
    maxHealth: 5,
    defense: 0,
  };
}

// 4x3 PLAIN board, terrain listed x-major (index = x * HEIGHT + y), with the
// middle row LEFT orb (0,1), right-1 (1,1), left-1 (2,1), RIGHT orb (3,1):
// each unit stands next to the enemy orb, and one attack (10 damage against
// defense 0) destroys an orb's 5 HP.
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
    unit('left-1', 'LEFT', { x: 2, y: 1 }),
    unit('right-1', 'RIGHT', { x: 1, y: 1 }),
  ],
  walls: [],
  orbs: [
    orb('orb-left', 'LEFT', { x: 0, y: 1 }),
    orb('orb-right', 'RIGHT', { x: 3, y: 1 }),
  ],
  currentPlayer: 'LEFT',
};

/**
 * Serves the demo battle, or each given status in turn, and counts the
 * requests so a restart can be shown to fetch the battle again.
 */
async function openBoard(page: Page, statuses: readonly number[] = [200]) {
  const requests = { count: 0 };
  await page.route('**/api/v1/battles/demo', (route) => {
    const status = statuses[Math.min(requests.count, statuses.length - 1)];
    requests.count++;
    return status === 200
      ? route.fulfill({ json: battleState })
      : route.fulfill({ status, json: {} });
  });
  await page.goto('/battle/demo');
  await expect(page.locator('.board-grid')).toBeVisible();
  return requests;
}

// Clicks at a cell's screen position, as in the attack tests, so whichever
// board layer is on top there receives the event.
async function clickCell(page: Page, x: number, y: number) {
  const cell = page.locator('app-cell').nth(x * HEIGHT + y);
  await cell.scrollIntoViewIfNeeded();
  const box = await cell.boundingBox();
  if (!box) throw new Error(`Cell (${x},${y}) has no bounding box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

// Required: the generated PositionDto marks x and y optional.
async function destroyOrb(
  page: Page,
  attacker: Required<PositionDto>,
  orbCell: Required<PositionDto>,
) {
  await clickCell(page, attacker.x, attacker.y);
  await modeButton(page, 'ATTACK').click();
  await clickCell(page, orbCell.x, orbCell.y);
}

const leftWins = (page: Page) =>
  destroyOrb(page, { x: 2, y: 1 }, { x: 3, y: 1 });

const modeButton = (page: Page, mode: 'MOVE' | 'ATTACK') =>
  page.locator(`.mode-button[data-mode="${mode}"]`);
const endTurnButton = (page: Page) =>
  page.getByRole('button', { name: 'END TURN' });
const newBattleButton = (page: Page) =>
  page.getByRole('button', { name: 'NEW BATTLE' });
const battleResult = (page: Page) => page.locator('.battle-result');
const outcome = (page: Page) => page.locator('.last-outcome');
const unitInfo = (page: Page) => page.locator('.unit-movement');
const orbCell = (page: Page, owner: 'LEFT' | 'RIGHT') =>
  page.locator(`.entity-cell[data-kind="orb"][data-owner="${owner}"]`);
const orbHealth = (page: Page, owner: 'LEFT' | 'RIGHT') =>
  page
    .locator('.health-label', {
      hasText: `${owner} orb orb-${owner.toLowerCase()}`,
    })
    .locator('.health-label-value');

test.describe('battle victory and restart', () => {
  test('destroying the RIGHT orb ends the battle for LEFT, keeps the final board, and NEW BATTLE starts a fresh one in place', async ({
    page,
  }) => {
    const requests = await openBoard(page);

    await leftWins(page);

    await expect(battleResult(page)).toHaveText(
      'Bitwa zakończona — zwycięzca: LEFT',
    );
    await expect(outcome(page)).toContainText('attacked ORB orb-right');
    await expect(orbCell(page, 'RIGHT')).toHaveAttribute(
      'data-destroyed',
      'true',
    );
    await expect(orbHealth(page, 'RIGHT')).toHaveText('0/5');
    await expect(orbHealth(page, 'LEFT')).toHaveText('5/5');

    await expect(endTurnButton(page)).toBeDisabled();
    await expect(modeButton(page, 'MOVE')).toBeDisabled();
    await expect(modeButton(page, 'ATTACK')).toBeDisabled();
    await expect(page.locator('.attack-target')).toHaveCount(0);
    await expect(page.locator('.attack-range-cell')).toHaveCount(0);

    const finalOutcome =
      'LEFT left-1 attacked ORB orb-right · damage 10 · remaining HP 0 · cost 2 AP · destroyed';

    // Units can still be inspected. In a running battle this click would
    // attack right-1, the selected left-1's target; now it only selects it.
    await clickCell(page, 1, 1);
    await expect(unitInfo(page)).toHaveText(
      'right-1 (RIGHT) · HP 100 · AP spent 0 / 6 · remaining 6',
    );
    await expect(outcome(page)).toHaveText(finalOutcome);

    // left-1 still has AP and right-1 in reach, yet is offered no target.
    await clickCell(page, 2, 1);
    await expect(unitInfo(page)).toHaveText(
      'left-1 (LEFT) · HP 100 · AP spent 2 / 6 · remaining 4',
    );
    await expect(page.locator('.attack-target')).toHaveCount(0);
    await expect(page.locator('.attack-range-cell')).toHaveCount(0);

    // The destroyed orb is no target either: the click reaches the terrain
    // beneath, which only clears the selection.
    await clickCell(page, 3, 1);
    await expect(page.locator('.entity-cell.selected')).toHaveCount(0);
    await expect(outcome(page)).toHaveText(finalOutcome);
    await expect(orbHealth(page, 'RIGHT')).toHaveText('0/5');
    await expect(battleResult(page)).toHaveText(
      'Bitwa zakończona — zwycięzca: LEFT',
    );

    // Lost on a full page reload, so it proves the restart happened in place.
    await page.evaluate(() => {
      (window as { e2eNoReload?: boolean }).e2eNoReload = true;
    });
    await newBattleButton(page).click();

    await expect(battleResult(page)).toHaveCount(0);
    await expect(page.locator('.current-player')).toHaveText('Turn: LEFT');
    await expect(orbCell(page, 'RIGHT')).not.toHaveAttribute('data-destroyed');
    await expect(orbHealth(page, 'RIGHT')).toHaveText('5/5');
    await expect(endTurnButton(page)).toBeEnabled();
    await expect(modeButton(page, 'MOVE')).toBeEnabled();
    await expect(modeButton(page, 'MOVE')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(modeButton(page, 'ATTACK')).toBeEnabled();
    await expect(outcome(page)).toHaveText('');
    await expect(page.locator('.entity-cell.selected')).toHaveCount(0);
    expect(requests.count).toBe(2);
    expect(
      await page.evaluate(
        () => (window as { e2eNoReload?: boolean }).e2eNoReload,
      ),
    ).toBe(true);

    // The fresh battle is playable again.
    await clickCell(page, 2, 1);
    await expect(page.locator('button.movement-target').first()).toBeVisible();
  });

  test('destroying the LEFT orb ends the battle for RIGHT', async ({
    page,
  }) => {
    await openBoard(page);
    await endTurnButton(page).click();

    await destroyOrb(page, { x: 1, y: 1 }, { x: 0, y: 1 });

    await expect(battleResult(page)).toHaveText(
      'Bitwa zakończona — zwycięzca: RIGHT',
    );
    await expect(orbCell(page, 'LEFT')).toHaveAttribute(
      'data-destroyed',
      'true',
    );
    await expect(orbHealth(page, 'LEFT')).toHaveText('0/5');
    await expect(endTurnButton(page)).toBeDisabled();
  });

  test('a failed NEW BATTLE shows the error instead of a battle, and can be retried', async ({
    page,
  }) => {
    await openBoard(page, [200, 500, 200]);
    await leftWins(page);
    await expect(battleResult(page)).toBeVisible();

    await newBattleButton(page).click();

    await expect(page.locator('.load-status')).toHaveText(
      'Failed to load the demo battle.',
    );
    await expect(page.locator('.board-grid')).toHaveCount(0);
    await expect(battleResult(page)).toHaveCount(0);

    await newBattleButton(page).click();

    await expect(page.locator('.board-grid')).toBeVisible();
    await expect(page.locator('.current-player')).toHaveText('Turn: LEFT');
    await expect(battleResult(page)).toHaveCount(0);
    await expect(orbHealth(page, 'RIGHT')).toHaveText('5/5');
  });
});
