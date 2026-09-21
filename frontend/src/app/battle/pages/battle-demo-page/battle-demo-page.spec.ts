import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BattleStateResponse } from '../../../api/generated/model';
import { BattleStore } from '../../battle.store';
import { BattleBoardComponent } from '../../components/battle-board/battle-board.component';
import { InteractionMode } from '../../interaction-mode';
import { BattleDemoPage } from './battle-demo-page';

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
      {
        id: 'unit-left-1',
        owner: 'LEFT',
        position: { x: 3, y: 2 },
        footprint: [{ x: 0, y: 0 }],
      },
      {
        id: 'unit-right-1',
        owner: 'RIGHT',
        position: { x: 17, y: 2 },
        footprint: [{ x: 0, y: 0 }],
      },
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
          {
            id: 'unit-left-1',
            owner: 'LEFT',
            position: { x: 3, y: 2 },
            footprint: [{ x: 0, y: 0 }],
          },
          {
            id: 'unit-left-2',
            owner: 'LEFT',
            position: { x: 3, y: 4 },
            footprint: [{ x: 0, y: 0 }],
          },
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
              position: { x: 1, y: 0 },
              footprint: [{ x: 0, y: 0 }],
            },
          ],
          orbs: [
            {
              id: 'orb-left',
              owner: 'LEFT',
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
        {
          id: 'unit-left-1',
          owner: 'LEFT',
          position: { x: 3, y: 2 },
          footprint: [{ x: 0, y: 0 }],
        },
        {
          id: 'unit-right-1',
          owner: 'RIGHT',
          position: { x: 17, y: 2 },
          footprint: [{ x: 0, y: 0 }],
        },
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
});
