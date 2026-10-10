import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  BattleStateResponse,
  UnitDto,
} from '../../../api/generated/model';
import { BattleStore } from '../../battle.store';
import { BattleBoardComponent } from '../../components/battle-board/battle-board.component';
import { InteractionMode } from '../../interaction-mode';
import { BattleDemoPage } from './battle-demo-page';

/** A complete unit DTO, since the store maps responses into the domain model. */
function unitDto(overrides: UnitDto): UnitDto {
  return {
    unitType: 'SWORDSMAN',
    footprint: [{ x: 0, y: 0 }],
    health: 100,
    attack: 10,
    defense: 5,
    actionPointBudget: 3,
    movementCostFactor: 1,
    ...overrides,
  };
}

describe('BattleDemoPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  async function renderWithLoadedBattle(
    units: BattleStateResponse['units'] = [],
    overrides: Partial<BattleStateResponse> = {},
  ) {
    const fixture = TestBed.createComponent(BattleDemoPage);
    fixture.detectChanges();

    const response: BattleStateResponse = {
      board: { width: 21, height: 11, terrain: [] },
      orbs: [],
      walls: [],
      units,
      currentPlayer: 'LEFT',
      ...overrides,
    };
    httpMock.expectOne('/api/v1/battles/demo').flush(response);
    await fixture.whenStable();
    fixture.detectChanges();

    const store = fixture.debugElement.injector.get(BattleStore);
    const board = fixture.debugElement.query(
      By.directive(BattleBoardComponent),
    );

    return { fixture, store, board };
  }

  it('selects the unit when the board reports a UnitClicked interaction', async () => {
    const { store, board } = await renderWithLoadedBattle();

    board.triggerEventHandler('interaction', {
      kind: 'unit-clicked',
      unitId: 'unit-left-1',
    });

    expect(store.selectedUnitId()).toBe('unit-left-1');
  });

  it('selects an enemy unit when clicked, without rejecting it', async () => {
    const { store, board } = await renderWithLoadedBattle();

    board.triggerEventHandler('interaction', {
      kind: 'unit-clicked',
      unitId: 'unit-right-1',
    });

    expect(store.selectedUnitId()).toBe('unit-right-1');
  });

  it('clears the selection when the board reports a CellClicked interaction', async () => {
    const { store, board } = await renderWithLoadedBattle();
    store.selectUnit('unit-left-1');

    board.triggerEventHandler('interaction', {
      kind: 'cell-clicked',
      position: { x: 5, y: 5 },
    });

    expect(store.selectedUnitId()).toBeUndefined();
  });

  it('preserves the interaction mode when a unit is selected', async () => {
    const { store, board } = await renderWithLoadedBattle();
    store.setInteractionMode(InteractionMode.ATTACK);

    board.triggerEventHandler('interaction', {
      kind: 'unit-clicked',
      unitId: 'unit-left-1',
    });

    expect(store.interactionMode()).toBe(InteractionMode.ATTACK);
  });

  it('preserves the interaction mode when the selection is cleared', async () => {
    const { store, board } = await renderWithLoadedBattle();
    store.setInteractionMode(InteractionMode.ATTACK);

    board.triggerEventHandler('interaction', {
      kind: 'cell-clicked',
      position: { x: 5, y: 5 },
    });

    expect(store.interactionMode()).toBe(InteractionMode.ATTACK);
  });

  it('shows selection and dimming from the store on the board, regardless of interaction mode', async () => {
    const { fixture, store } = await renderWithLoadedBattle([
      unitDto({
        id: 'unit-left-1',
        owner: 'LEFT',
        position: { x: 3, y: 2 },
        footprint: [{ x: 0, y: 0 }],
      }),
      unitDto({
        id: 'unit-right-1',
        owner: 'RIGHT',
        position: { x: 17, y: 2 },
        footprint: [{ x: 0, y: 0 }],
      }),
    ]);
    const count = (selector: string) =>
      fixture.nativeElement.querySelectorAll(selector).length;
    const expectState = (selected: number, dimmed: number) => {
      expect(count('.entity-cell.selected')).toBe(selected);
      expect(count('.entity-cell.dimmed')).toBe(dimmed);
    };

    expectState(0, 0);

    store.selectUnit('unit-left-1');
    fixture.detectChanges();
    expectState(1, 1);

    store.setInteractionMode(InteractionMode.ATTACK);
    fixture.detectChanges();
    expectState(1, 1);

    store.setInteractionMode(InteractionMode.MOVE);
    fixture.detectChanges();
    expectState(1, 1);

    store.clearSelection();
    fixture.detectChanges();
    expectState(0, 0);
  });

  describe('selection through real board clicks', () => {
    // Terrain order matters: index 0 = empty, 1 = under the unit, 2 = under the wall, 3 = under the orb.
    const EMPTY = 0;
    const UNDER_WALL = 2;
    const UNDER_ORB = 3;

    async function renderDemoBoard() {
      const rendered = await renderWithLoadedBattle(
        [
          unitDto({
            id: 'unit-left-1',
            owner: 'LEFT',
            position: { x: 3, y: 2 },
            footprint: [{ x: 0, y: 0 }],
          }),
          unitDto({
            id: 'unit-left-2',
            owner: 'LEFT',
            position: { x: 3, y: 4 },
            footprint: [{ x: 0, y: 0 }],
          }),
        ],
        {
          board: {
            width: 21,
            height: 11,
            terrain: [
              { position: { x: 4, y: 2 }, type: 'PLAIN' },
              { position: { x: 3, y: 2 }, type: 'PLAIN' },
              { position: { x: 1, y: 0 }, type: 'PLAIN' },
              { position: { x: 0, y: 5 }, type: 'PLAIN' },
              { position: { x: 3, y: 4 }, type: 'PLAIN' },
            ],
          },
          walls: [
            {
              id: 'wall-left',
              owner: 'LEFT',
              health: 100,
              position: { x: 1, y: 0 },
              footprint: [{ x: 0, y: 0 }],
            },
          ],
          orbs: [
            {
              id: 'orb-left',
              owner: 'LEFT',
              health: 100,
              position: { x: 0, y: 5 },
              footprint: [{ x: 0, y: 0 }],
            },
          ],
        },
      );
      const root: HTMLElement = rendered.fixture.nativeElement;

      const clickUnit = (unitId: string) => {
        const units: HTMLElement[] = Array.from(
          root.querySelectorAll('button.entity-cell[data-kind="unit"]'),
        );
        const index = unitId === 'unit-left-1' ? 0 : 1;
        units[index].click();
        rendered.fixture.detectChanges();
      };
      const clickTerrain = (index: number) => {
        const cells: HTMLElement[] = Array.from(
          root.querySelectorAll('app-cell'),
        );
        const button = cells[index].querySelector('button');
        expect(button).not.toBeNull();
        button?.click();
        rendered.fixture.detectChanges();
      };
      const selectedUnits = () =>
        Array.from(
          root.querySelectorAll('.entity-cell.selected'),
        ) as HTMLElement[];

      return { ...rendered, clickUnit, clickTerrain, selectedUnits };
    }

    it('clicking an empty cell clears both the store selection and the visual mark', async () => {
      const { store, clickUnit, clickTerrain, selectedUnits } =
        await renderDemoBoard();

      clickUnit('unit-left-1');
      expect(store.selectedUnitId()).toBe('unit-left-1');
      expect(selectedUnits()).toHaveLength(1);

      clickTerrain(EMPTY);
      expect(store.selectedUnitId()).toBeUndefined();
      expect(selectedUnits()).toHaveLength(0);
    });

    it('clicking a wall clears both the store selection and the visual mark', async () => {
      const { store, clickUnit, clickTerrain, selectedUnits } =
        await renderDemoBoard();

      clickUnit('unit-left-1');
      expect(selectedUnits()).toHaveLength(1);

      clickTerrain(UNDER_WALL);
      expect(store.selectedUnitId()).toBeUndefined();
      expect(selectedUnits()).toHaveLength(0);
    });

    it('clicking an orb clears both the store selection and the visual mark', async () => {
      const { store, clickUnit, clickTerrain, selectedUnits } =
        await renderDemoBoard();

      clickUnit('unit-left-1');
      expect(selectedUnits()).toHaveLength(1);

      clickTerrain(UNDER_ORB);
      expect(store.selectedUnitId()).toBeUndefined();
      expect(selectedUnits()).toHaveLength(0);
    });

    it('clicking another unit moves the selection and the visual mark', async () => {
      const { store, clickUnit, selectedUnits } = await renderDemoBoard();

      clickUnit('unit-left-1');
      clickUnit('unit-left-2');

      expect(store.selectedUnitId()).toBe('unit-left-2');
      expect(selectedUnits()).toHaveLength(1);
      expect(selectedUnits()[0].getAttribute('data-owner')).toBe('LEFT');
    });

    it('clicking the already selected unit keeps it selected', async () => {
      const { store, clickUnit, selectedUnits } = await renderDemoBoard();

      clickUnit('unit-left-1');
      clickUnit('unit-left-1');

      expect(store.selectedUnitId()).toBe('unit-left-1');
      expect(selectedUnits()).toHaveLength(1);
    });
  });

  describe('interaction mode controls', () => {
    async function renderWithTwoUnits() {
      const rendered = await renderWithLoadedBattle([
        unitDto({
          id: 'unit-left-1',
          owner: 'LEFT',
          position: { x: 3, y: 2 },
          footprint: [{ x: 0, y: 0 }],
        }),
        unitDto({
          id: 'unit-right-1',
          owner: 'RIGHT',
          position: { x: 17, y: 2 },
          footprint: [{ x: 0, y: 0 }],
        }),
      ]);
      const root: HTMLElement = rendered.fixture.nativeElement;
      const modeButton = (mode: InteractionMode): HTMLButtonElement =>
        root.querySelector(`.mode-button[data-mode="${mode}"]`)!;
      const clickMode = (mode: InteractionMode) => {
        modeButton(mode).click();
        rendered.fixture.detectChanges();
      };
      const pressed = () => ({
        MOVE: modeButton(InteractionMode.MOVE).getAttribute('aria-pressed'),
        ATTACK: modeButton(InteractionMode.ATTACK).getAttribute('aria-pressed'),
      });
      const selectedUnit = (): HTMLElement | null =>
        root.querySelector('.entity-cell.selected');

      return { ...rendered, modeButton, clickMode, pressed, selectedUnit };
    }

    it('starts in MOVE with native buttons reflecting the mode', async () => {
      const { store, modeButton, pressed } = await renderWithTwoUnits();

      expect(store.interactionMode()).toBe(InteractionMode.MOVE);
      expect(modeButton(InteractionMode.MOVE).tagName).toBe('BUTTON');
      expect(modeButton(InteractionMode.ATTACK).tagName).toBe('BUTTON');
      expect(pressed()).toEqual({ MOVE: 'true', ATTACK: 'false' });
    });

    it('clicking ATTACK then MOVE updates the store and the pressed state', async () => {
      const { store, clickMode, pressed } = await renderWithTwoUnits();

      clickMode(InteractionMode.ATTACK);
      expect(store.interactionMode()).toBe(InteractionMode.ATTACK);
      expect(pressed()).toEqual({ MOVE: 'false', ATTACK: 'true' });

      clickMode(InteractionMode.MOVE);
      expect(store.interactionMode()).toBe(InteractionMode.MOVE);
      expect(pressed()).toEqual({ MOVE: 'true', ATTACK: 'false' });
    });

    it('changing mode keeps the selected unit and only swaps its mode visual', async () => {
      const { store, fixture, clickMode, selectedUnit } =
        await renderWithTwoUnits();
      store.selectUnit('unit-right-1');
      fixture.detectChanges();
      expect(selectedUnit()?.getAttribute('data-selection-mode')).toBe('MOVE');

      clickMode(InteractionMode.ATTACK);
      expect(store.selectedUnitId()).toBe('unit-right-1');
      expect(selectedUnit()?.getAttribute('data-owner')).toBe('RIGHT');
      expect(selectedUnit()?.getAttribute('data-selection-mode')).toBe(
        'ATTACK',
      );
      expect(
        fixture.nativeElement.querySelectorAll('.entity-cell.dimmed'),
      ).toHaveLength(1);

      clickMode(InteractionMode.MOVE);
      expect(store.selectedUnitId()).toBe('unit-right-1');
      expect(selectedUnit()?.getAttribute('data-selection-mode')).toBe('MOVE');
    });

    it('changing mode with no selection only changes the mode', async () => {
      const { store, clickMode, selectedUnit } = await renderWithTwoUnits();

      clickMode(InteractionMode.ATTACK);

      expect(store.selectedUnitId()).toBeUndefined();
      expect(selectedUnit()).toBeNull();
      expect(store.interactionMode()).toBe(InteractionMode.ATTACK);
    });

    it('clearing selection removes the mode visual but keeps the mode', async () => {
      const { store, fixture, board, clickMode, selectedUnit } =
        await renderWithTwoUnits();
      store.selectUnit('unit-left-1');
      clickMode(InteractionMode.ATTACK);
      expect(selectedUnit()?.getAttribute('data-selection-mode')).toBe(
        'ATTACK',
      );

      board.triggerEventHandler('interaction', {
        kind: 'cell-clicked',
        position: { x: 5, y: 5 },
      });
      fixture.detectChanges();

      expect(selectedUnit()).toBeNull();
      expect(
        fixture.nativeElement.querySelector('[data-selection-mode]'),
      ).toBeNull();
      expect(store.interactionMode()).toBe(InteractionMode.ATTACK);
    });
  });

  describe('movement', () => {
    const HEIGHT = 5;

    // A 7×5 PLAIN board: LEFT at (1,1) with 1 movement, so only its four
    // orthogonal neighbours are reachable; RIGHT at (5,3).
    async function renderMovementBoard() {
      const rendered = await renderWithLoadedBattle(
        [
          unitDto({
            id: 'unit-left-1',
            owner: 'LEFT',
            position: { x: 1, y: 1 },
            actionPointBudget: 1,
          }),
          unitDto({
            id: 'unit-right-1',
            owner: 'RIGHT',
            position: { x: 5, y: 3 },
          }),
        ],
        {
          board: {
            width: 7,
            height: HEIGHT,
            terrain: Array.from({ length: 7 }, (_, x) =>
              Array.from({ length: HEIGHT }, (_, y) => ({
                position: { x, y },
                type: 'PLAIN' as const,
              })),
            ).flat(),
          },
        },
      );
      const root: HTMLElement = rendered.fixture.nativeElement;
      const unit = (owner: 'LEFT' | 'RIGHT'): HTMLElement =>
        root.querySelector(
          `button.entity-cell[data-kind="unit"][data-owner="${owner}"]`,
        )!;
      const targets = (): HTMLElement[] =>
        Array.from(root.querySelectorAll('button.movement-target'));
      const target = (x: number, y: number): HTMLElement =>
        root.querySelector(
          `button.movement-target[aria-label^="Move to (${x}, ${y})"]`,
        )!;
      const act = (action: () => void) => {
        action();
        rendered.fixture.detectChanges();
      };

      const text = (selector: string) =>
        root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();

      return { ...rendered, root, unit, targets, target, act, text };
    }

    it('shows movement targets for a selected LEFT unit and moves it when one is clicked', async () => {
      const { unit, targets, target, act } = await renderMovementBoard();

      act(() => unit('LEFT').click());
      expect(targets()).toHaveLength(4);

      act(() => target(2, 1).click());

      expect(unit('LEFT').style.gridColumn).toBe('3');
      expect(unit('LEFT').style.gridRow).toBe(String(HEIGHT - 1));
      expect(unit('LEFT').classList).toContain('selected');
      // The single AP is spent, so nothing is reachable any more.
      expect(targets()).toHaveLength(0);
    });

    it('previews the hovered path and its cost, and removes it on leave', async () => {
      const { root, unit, target, act } = await renderMovementBoard();
      act(() => unit('LEFT').click());

      act(() => target(2, 1).dispatchEvent(new MouseEvent('mouseenter')));
      expect(root.querySelector('.movement-path polyline')).not.toBeNull();
      expect(root.querySelector('.preview-cost')?.textContent?.trim()).toBe(
        '1',
      );

      act(() => target(2, 1).dispatchEvent(new MouseEvent('mouseleave')));
      expect(root.querySelector('.movement-path')).toBeNull();
      expect(root.querySelector('.preview-cost')).toBeNull();
    });

    it('shows movement targets and a path preview for a selected RIGHT unit', async () => {
      const { root, unit, targets, target, act } = await renderMovementBoard();

      act(() => unit('RIGHT').click());
      expect(unit('RIGHT').classList).toContain('selected');
      expect(targets().length).toBeGreaterThan(0);

      act(() => target(6, 3).dispatchEvent(new MouseEvent('mouseenter')));
      expect(root.querySelector('.movement-path polyline')).not.toBeNull();
      expect(root.querySelector('.preview-cost')?.textContent?.trim()).toBe(
        '1',
      );
    });

    it('shows no movement targets in ATTACK mode', async () => {
      const { root, unit, targets, act } = await renderMovementBoard();
      act(() => unit('LEFT').click());

      act(() =>
        root
          .querySelector<HTMLElement>(
            `.mode-button[data-mode="${InteractionMode.ATTACK}"]`,
          )!
          .click(),
      );

      expect(targets()).toHaveLength(0);
    });

    it("shows the selected unit's spent and remaining AP and the last move", async () => {
      const { unit, target, act, text } = await renderMovementBoard();
      act(() => unit('LEFT').click());
      expect(text('.unit-movement')).toBe(
        'unit-left-1 (LEFT) · AP spent 0 / 1 · remaining 1',
      );

      act(() => target(2, 1).click());

      expect(text('.unit-movement')).toBe(
        'unit-left-1 (LEFT) · AP spent 1 / 1 · remaining 0',
      );
      expect(text('.spent-label')).toBe('1');
      expect(text('.last-outcome')).toBe(
        'LEFT moved unit-left-1 (1,1) → (2,1) · cost 1 AP',
      );
    });

    describe('turns', () => {
      function endTurnButton(root: HTMLElement): HTMLButtonElement {
        return root.querySelector('button.end-turn-button')!;
      }

      it('shows LEFT as the current player at the start', async () => {
        const { root, text } = await renderMovementBoard();

        expect(text('.current-player')).toBe('Turn: LEFT');
        expect(
          root.querySelector('.current-player')?.getAttribute('aria-live'),
        ).toBe('polite');
      });

      it('passes the turn to RIGHT and back to LEFT with END TURN', async () => {
        const { root, act, text } = await renderMovementBoard();
        const button = endTurnButton(root);
        expect(button.type).toBe('button');
        expect(button.textContent?.trim()).toBe('END TURN');

        act(() => button.click());
        expect(text('.current-player')).toBe('Turn: RIGHT');

        act(() => button.click());
        expect(text('.current-player')).toBe('Turn: LEFT');
      });

      it('keeps END TURN enabled at 0 AP and passes the turn', async () => {
        const { root, unit, target, act, text } = await renderMovementBoard();
        act(() => unit('LEFT').click());
        act(() => target(2, 1).click());
        expect(text('.unit-movement')).toBe(
          'unit-left-1 (LEFT) · AP spent 1 / 1 · remaining 0',
        );

        const button = endTurnButton(root);
        expect(button.disabled).toBe(false);
        act(() => button.click());

        expect(text('.current-player')).toBe('Turn: RIGHT');
      });

      it("shows the engine's new state after END TURN: the turn changes hands and AP return at turn start", async () => {
        const { root, store, unit, targets, target, act, text } =
          await renderMovementBoard();
        act(() => unit('LEFT').click());
        act(() => target(2, 1).click());
        expect(store.battleState()?.activeUnitId).toBe('unit-left-1');

        act(() => endTurnButton(root).click());

        expect(store.battleState()?.activeUnitId).toBeUndefined();
        act(() => unit('LEFT').click());
        expect(text('.unit-movement')).toBe(
          'unit-left-1 (LEFT) · AP spent 1 / 1 · remaining 0',
        );
        act(() => unit('RIGHT').click());
        act(() => target(6, 3).click());
        expect(text('.last-outcome')).toBe(
          'RIGHT moved unit-right-1 (5,3) → (6,3) · cost 1 AP',
        );

        act(() => endTurnButton(root).click());
        act(() => unit('LEFT').click());

        expect(text('.unit-movement')).toBe(
          'unit-left-1 (LEFT) · AP spent 0 / 1 · remaining 1',
        );
        expect(targets()).toHaveLength(4);
      });

      it('clears the selection and the hovered preview on END TURN, keeping the last outcome', async () => {
        const { root, store, unit, targets, target, act, text } =
          await renderMovementBoard();
        act(() => unit('RIGHT').click());
        act(() => target(6, 3).click());
        act(() => unit('LEFT').click());
        act(() => target(2, 1).dispatchEvent(new MouseEvent('mouseenter')));
        expect(root.querySelector('.movement-path')).not.toBeNull();

        act(() => endTurnButton(root).click());

        expect(store.selectedUnitId()).toBeUndefined();
        expect(store.hoveredDestination()).toBeUndefined();
        expect(root.querySelector('.entity-cell.selected')).toBeNull();
        expect(root.querySelector('.movement-path')).toBeNull();
        expect(targets()).toHaveLength(0);
        expect(text('.no-selection')).toBe('No unit selected.');
        expect(text('.last-outcome')).toBe('Move rejected: UNIT_CANNOT_MOVE');
        expect(store.interactionMode()).toBe(InteractionMode.MOVE);
      });

      it('no longer offers the movement reset control', async () => {
        const { root, unit, act } = await renderMovementBoard();
        act(() => unit('LEFT').click());

        const labels = Array.from(root.querySelectorAll('button')).map(
          (button) => button.textContent ?? '',
        );
        expect(root.querySelector('.reset-button')).toBeNull();
        expect(labels.some((label) => /reset/i.test(label))).toBe(false);
      });
    });

    it('reports the rejected move when a RIGHT unit target is clicked, leaving the unit in place', async () => {
      const { unit, target, act, text } = await renderMovementBoard();
      act(() => unit('RIGHT').click());

      act(() => target(6, 3).click());

      expect(unit('RIGHT').style.gridColumn).toBe('6');
      expect(unit('RIGHT').style.gridRow).toBe(String(HEIGHT - 3));
      expect(text('.unit-movement')).toBe(
        'unit-right-1 (RIGHT) · AP spent 0 / 3 · remaining 3',
      );
      expect(text('.last-outcome')).toBe('Move rejected: UNIT_CANNOT_MOVE');
    });
  });
});
