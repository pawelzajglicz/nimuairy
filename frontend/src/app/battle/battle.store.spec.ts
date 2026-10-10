import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BattleStateResponse,
  TerrainCellDto,
  UnitDto,
} from '../api/generated/model';
import { toBattleState } from './battle-state.mapper';
import { BattleStore } from './battle.store';
import { BattleEngine } from './domain/battle-engine';
import type { Position } from './domain/battle-state';
import { InteractionMode } from './interaction-mode';

function demoResponse(): BattleStateResponse {
  return {
    board: {
      width: 3,
      height: 2,
      terrain: [
        { position: { x: 0, y: 0 }, type: 'PLAIN' },
        { position: { x: 1, y: 0 }, type: 'PLAIN' },
        { position: { x: 2, y: 0 }, type: 'ROCK' },
        { position: { x: 0, y: 1 }, type: 'PLAIN' },
        { position: { x: 1, y: 1 }, type: 'PLAIN' },
        { position: { x: 2, y: 1 }, type: 'PLAIN' },
      ],
    },
    orbs: [],
    walls: [],
    units: [
      {
        id: 'left-unit-1',
        owner: 'LEFT',
        unitType: 'SWORDSMAN',
        position: { x: 0, y: 0 },
        footprint: [{ x: 0, y: 0 }],
        health: 10,
        attack: 4,
        defense: 2,
        actionPointBudget: 3,
        movementCostFactor: 1,
      },
    ],
    currentPlayer: 'LEFT',
  };
}

describe('BattleStore', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), BattleStore],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('starts loading the demo battle with no state yet', () => {
    const store = TestBed.inject(BattleStore);
    TestBed.tick();

    expect(store.loading()).toBe(true);
    expect(store.battleState()).toBeUndefined();
    expect(store.error()).toBeUndefined();

    httpMock.expectOne('/api/v1/battles/demo').flush({});
  });

  it('exposes the loaded response as the domain battle state', async () => {
    const store = TestBed.inject(BattleStore);
    TestBed.tick();

    httpMock.expectOne('/api/v1/battles/demo').flush(demoResponse());
    await vi.waitFor(() => expect(store.loading()).toBe(false));

    expect(store.battleState()).toEqual(toBattleState(demoResponse()));
    expect(store.battleState()?.currentPlayer).toBe('LEFT');
    expect(store.battleState()?.units[0].remainingActionPoints).toBe(3);
    expect(store.error()).toBeUndefined();
  });

  it('keeps the same battle state object across selection and mode changes', async () => {
    const store = TestBed.inject(BattleStore);
    TestBed.tick();
    httpMock.expectOne('/api/v1/battles/demo').flush(demoResponse());
    await vi.waitFor(() => expect(store.loading()).toBe(false));
    const loaded = store.battleState();

    store.selectUnit('left-unit-1');
    store.setInteractionMode(InteractionMode.ATTACK);
    store.clearSelection();

    expect(store.battleState()).toBe(loaded);
  });

  it('exposes an error when the request fails', async () => {
    const store = TestBed.inject(BattleStore);
    TestBed.tick();

    httpMock
      .expectOne('/api/v1/battles/demo')
      .flush('failure', { status: 500, statusText: 'Server Error' });
    await vi.waitFor(() => expect(store.loading()).toBe(false));

    expect(store.error()).toBeDefined();
    expect(store.battleState()).toBeUndefined();
  });

  describe('selection and interaction mode', () => {
    it('starts with no selected unit', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.tick();

      expect(store.selectedUnitId()).toBeUndefined();

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });

    it('starts in MOVE interaction mode', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.tick();

      expect(store.interactionMode()).toBe(InteractionMode.MOVE);

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });

    it('selectUnit sets the selected unit', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.tick();

      store.selectUnit('left-unit-1');

      expect(store.selectedUnitId()).toBe('left-unit-1');

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });

    it('selectUnit replaces the previous selection', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.tick();

      store.selectUnit('left-unit-1');
      store.selectUnit('left-unit-2');

      expect(store.selectedUnitId()).toBe('left-unit-2');

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });

    it('allows selecting an opponent unit', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.tick();

      store.selectUnit('right-unit-1');

      expect(store.selectedUnitId()).toBe('right-unit-1');

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });

    it('clearSelection removes the selection', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.tick();

      store.selectUnit('left-unit-1');
      store.clearSelection();

      expect(store.selectedUnitId()).toBeUndefined();

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });

    it('clearSelection preserves the interaction mode', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.tick();

      store.setInteractionMode(InteractionMode.ATTACK);
      store.clearSelection();

      expect(store.interactionMode()).toBe(InteractionMode.ATTACK);

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });

    it('setInteractionMode changes the mode', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.tick();

      store.setInteractionMode(InteractionMode.ATTACK);

      expect(store.interactionMode()).toBe(InteractionMode.ATTACK);

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });

    it('changing interaction mode preserves the selected unit', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.tick();

      store.selectUnit('left-unit-1');
      store.setInteractionMode(InteractionMode.ATTACK);

      expect(store.selectedUnitId()).toBe('left-unit-1');

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });

    it('selecting another unit preserves the current interaction mode', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.tick();

      store.setInteractionMode(InteractionMode.ATTACK);
      store.selectUnit('left-unit-1');
      store.selectUnit('right-unit-1');

      expect(store.interactionMode()).toBe(InteractionMode.ATTACK);

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });
  });

  describe('movement', () => {
    function unitDto(
      id: string,
      owner: 'LEFT' | 'RIGHT',
      position: Position,
    ): UnitDto {
      return {
        id,
        owner,
        unitType: 'SWORDSMAN',
        position,
        footprint: [{ x: 0, y: 0 }],
        health: 10,
        attack: 4,
        defense: 2,
        actionPointBudget: 2,
        movementCostFactor: 1,
      };
    }

    /** A 6×3 PLAIN board: LEFT at (1,1) and RIGHT at (2,2), both with 2 AP. */
    function movementResponse(): BattleStateResponse {
      const terrain: TerrainCellDto[] = [];
      for (let x = 0; x < 6; x++) {
        for (let y = 0; y < 3; y++) {
          terrain.push({ position: { x, y }, type: 'PLAIN' });
        }
      }
      return {
        board: { width: 6, height: 3, terrain },
        orbs: [],
        walls: [],
        units: [
          unitDto('left-unit-1', 'LEFT', { x: 1, y: 1 }),
          unitDto('right-unit-1', 'RIGHT', { x: 2, y: 2 }),
        ],
        currentPlayer: 'LEFT',
      };
    }

    async function loadedStore() {
      const store = TestBed.inject(BattleStore);
      TestBed.tick();
      httpMock.expectOne('/api/v1/battles/demo').flush(movementResponse());
      await vi.waitFor(() => expect(store.loading()).toBe(false));
      return store;
    }

    type LoadedStore = Awaited<ReturnType<typeof loadedStore>>;

    function leftUnit(store: LoadedStore) {
      return store.battleState()?.units.find(({ id }) => id === 'left-unit-1');
    }

    function destinations(store: LoadedStore): Position[] {
      return store.reachableDestinations().map(({ position }) => position);
    }

    it('offers no destinations without a selection or outside MOVE mode', async () => {
      const store = await loadedStore();
      expect(store.reachableDestinations()).toEqual([]);

      store.selectUnit('left-unit-1');
      store.setInteractionMode(InteractionMode.ATTACK);

      expect(store.reachableDestinations()).toEqual([]);
    });

    it("offers the selected unit's reachable destinations, without its own anchor or occupied cells", async () => {
      const store = await loadedStore();

      store.selectUnit('left-unit-1');

      expect(store.reachableDestinations()).toContainEqual(
        expect.objectContaining({ position: { x: 3, y: 1 }, cost: 2 }),
      );
      expect(destinations(store)).not.toContainEqual({ x: 1, y: 1 });
      expect(destinations(store)).not.toContainEqual({ x: 2, y: 2 });
    });

    it("offers the other player's unit destinations and previews for inspection", async () => {
      const store = await loadedStore();

      store.selectUnit('right-unit-1');
      store.hoverDestination({ x: 4, y: 2 });

      expect(store.reachableDestinations()).toContainEqual(
        expect.objectContaining({ position: { x: 4, y: 2 }, cost: 2 }),
      );
      expect(store.movementPreview()).toMatchObject({
        destination: { x: 4, y: 2 },
        cost: 2,
      });
    });

    it('previews the path and cost to a hovered destination', async () => {
      const store = await loadedStore();
      store.selectUnit('left-unit-1');

      store.hoverDestination({ x: 3, y: 1 });

      expect(store.movementPreview()).toEqual({
        destination: { x: 3, y: 1 },
        steps: [
          { from: { x: 1, y: 1 }, to: { x: 2, y: 1 }, cost: 1 },
          { from: { x: 2, y: 1 }, to: { x: 3, y: 1 }, cost: 1 },
        ],
        cost: 2,
      });
    });

    it('limits destinations by AP and previews a diagonal at its integer AP cost', async () => {
      const store = await loadedStore();
      store.selectUnit('left-unit-1');

      store.hoverDestination({ x: 0, y: 0 });

      expect(store.reachableDestinations()).toContainEqual(
        expect.objectContaining({
          position: { x: 0, y: 0 },
          cost: Math.SQRT2,
          actionPointCost: 2,
        }),
      );
      // 1 + √2 rounds up to 3 AP, more than the 2 AP the unit has.
      expect(destinations(store)).not.toContainEqual({ x: 3, y: 0 });
      expect(store.movementPreview()).toEqual({
        destination: { x: 0, y: 0 },
        steps: [{ from: { x: 1, y: 1 }, to: { x: 0, y: 0 }, cost: Math.SQRT2 }],
        cost: 2,
      });
    });

    it("shows no preview for an unreachable cell or the unit's own anchor", async () => {
      const store = await loadedStore();
      store.selectUnit('left-unit-1');

      store.hoverDestination({ x: 4, y: 1 });
      expect(store.movementPreview()).toBeUndefined();

      store.hoverDestination({ x: 1, y: 1 });
      expect(store.movementPreview()).toBeUndefined();
    });

    it('clears the hover when the selection or the mode changes', async () => {
      const store = await loadedStore();
      const hover = () => store.hoverDestination({ x: 2, y: 1 });

      store.selectUnit('left-unit-1');
      hover();
      store.selectUnit('right-unit-1');
      expect(store.hoveredDestination()).toBeUndefined();

      hover();
      store.setInteractionMode(InteractionMode.ATTACK);
      expect(store.hoveredDestination()).toBeUndefined();

      hover();
      store.clearSelection();
      expect(store.hoveredDestination()).toBeUndefined();
    });

    it('moves the selected unit to a destination and charges the path cost', async () => {
      const store = await loadedStore();
      store.selectUnit('left-unit-1');
      store.hoverDestination({ x: 3, y: 1 });

      store.moveSelectedUnit({ x: 3, y: 1 });

      expect(leftUnit(store)).toMatchObject({
        position: { x: 3, y: 1 },
        remainingActionPoints: 0,
        actionPointBudget: 2,
      });
      expect(store.selectedUnitId()).toBe('left-unit-1');
      expect(store.hoveredDestination()).toBeUndefined();
      expect(store.reachableDestinations()).toEqual([]);
    });

    it('lets a second move spend the remaining AP from the new position', async () => {
      const store = await loadedStore();
      store.selectUnit('left-unit-1');

      store.moveSelectedUnit({ x: 2, y: 1 });
      expect(leftUnit(store)?.remainingActionPoints).toBe(1);
      expect(store.reachableDestinations()).toContainEqual(
        expect.objectContaining({ position: { x: 3, y: 1 }, cost: 1 }),
      );

      store.moveSelectedUnit({ x: 3, y: 1 });
      expect(leftUnit(store)).toMatchObject({
        position: { x: 3, y: 1 },
        remainingActionPoints: 0,
      });
    });

    it('leaves the battle state untouched when the cell is not an offered destination', async () => {
      const store = await loadedStore();
      const before = store.battleState();

      store.selectUnit('left-unit-1');
      store.moveSelectedUnit({ x: 4, y: 1 });

      store.setInteractionMode(InteractionMode.ATTACK);
      store.moveSelectedUnit({ x: 2, y: 1 });

      expect(store.battleState()).toBe(before);
    });

    it("lets the engine reject moving the other player's unit, leaving the battle state untouched", async () => {
      const store = await loadedStore();
      const before = store.battleState();
      store.selectUnit('right-unit-1');

      store.moveSelectedUnit({ x: 3, y: 2 });

      expect(store.battleState()).toBe(before);
      expect(store.lastOutcome()).toEqual({
        kind: 'REJECTED',
        action: 'MOVE',
        error: { type: 'UNIT_CANNOT_MOVE', unitId: 'right-unit-1' },
      });
    });

    it('keeps the moved state across later UI changes, leaving loading and error alone', async () => {
      const store = await loadedStore();
      store.selectUnit('left-unit-1');
      store.moveSelectedUnit({ x: 2, y: 1 });
      const moved = store.battleState();

      store.selectUnit('right-unit-1');
      store.setInteractionMode(InteractionMode.ATTACK);
      store.hoverDestination({ x: 0, y: 0 });

      expect(store.battleState()).toBe(moved);
      expect(store.loading()).toBe(false);
      expect(store.error()).toBeUndefined();
    });

    it('exposes the selected unit as it is in the current battle state', async () => {
      const store = await loadedStore();
      store.selectUnit('left-unit-1');

      store.moveSelectedUnit({ x: 2, y: 1 });

      expect(store.selectedUnit()).toBe(leftUnit(store));
      expect(store.selectedUnit()?.position).toEqual({ x: 2, y: 1 });
    });

    describe('last outcome', () => {
      it("records a move with the engine's steps and cost", async () => {
        const store = await loadedStore();
        store.selectUnit('left-unit-1');

        store.moveSelectedUnit({ x: 3, y: 1 });

        expect(store.lastOutcome()).toEqual({
          kind: 'MOVED',
          unitId: 'left-unit-1',
          owner: 'LEFT',
          steps: [
            { from: { x: 1, y: 1 }, to: { x: 2, y: 1 }, cost: 1 },
            { from: { x: 2, y: 1 }, to: { x: 3, y: 1 }, cost: 1 },
          ],
          cost: 2,
        });
      });

      it('charges exactly the previewed AP cost for a diagonal move, exhausting the AP', async () => {
        const store = await loadedStore();
        store.selectUnit('left-unit-1');
        store.hoverDestination({ x: 0, y: 0 });
        const previewedCost = store.movementPreview()?.cost;

        store.moveSelectedUnit({ x: 0, y: 0 });

        expect(previewedCost).toBe(2);
        expect(store.lastOutcome()).toMatchObject({
          kind: 'MOVED',
          cost: previewedCost,
        });
        expect(leftUnit(store)).toMatchObject({
          position: { x: 0, y: 0 },
          remainingActionPoints: 0,
        });
        expect(store.reachableDestinations()).toEqual([]);
      });

      it('is kept across selection, mode, hover and turn changes', async () => {
        const store = await loadedStore();
        store.selectUnit('left-unit-1');
        store.moveSelectedUnit({ x: 2, y: 1 });
        const outcome = store.lastOutcome();

        store.hoverDestination({ x: 3, y: 1 });
        store.selectUnit('right-unit-1');
        store.setInteractionMode(InteractionMode.ATTACK);
        store.clearSelection();
        store.endTurn();

        expect(store.lastOutcome()).toBe(outcome);
      });

      it('is replaced by the next attempt, whichever unit made it', async () => {
        const store = await loadedStore();
        store.selectUnit('left-unit-1');
        store.moveSelectedUnit({ x: 2, y: 1 });

        expect(store.lastOutcome()?.kind).toBe('MOVED');

        store.selectUnit('right-unit-1');
        store.moveSelectedUnit({ x: 3, y: 2 });
        expect(store.lastOutcome()).toEqual({
          kind: 'REJECTED',
          action: 'MOVE',
          error: { type: 'UNIT_CANNOT_MOVE', unitId: 'right-unit-1' },
        });
      });

      it('is not touched when a cell that is not a destination is submitted', async () => {
        const store = await loadedStore();
        store.selectUnit('left-unit-1');

        store.moveSelectedUnit({ x: 4, y: 1 });

        expect(store.lastOutcome()).toBeUndefined();
      });
    });

    describe('end turn', () => {
      it('passes the turn to RIGHT and back to LEFT', async () => {
        const store = await loadedStore();

        store.endTurn();
        expect(store.battleState()?.currentPlayer).toBe('RIGHT');

        store.endTurn();
        expect(store.battleState()?.currentPlayer).toBe('LEFT');
      });

      it('stores the state the engine returns for END_TURN', async () => {
        const store = await loadedStore();
        store.selectUnit('left-unit-1');
        store.moveSelectedUnit({ x: 2, y: 1 });
        const before = store.battleState()!;

        store.endTurn();

        expect(store.battleState()).toEqual(new BattleEngine().endTurn(before));
      });

      it('clears the active unit, ends the turn at 0 AP and restores the AP of the player whose turn starts', async () => {
        const store = await loadedStore();
        store.selectUnit('left-unit-1');
        store.moveSelectedUnit({ x: 3, y: 1 });
        expect(store.battleState()?.activeUnitId).toBe('left-unit-1');
        expect(store.reachableDestinations()).toEqual([]);

        store.endTurn();
        expect(store.battleState()?.activeUnitId).toBeUndefined();
        expect(leftUnit(store)?.remainingActionPoints).toBe(0);

        store.endTurn();
        expect(leftUnit(store)).toMatchObject({
          position: { x: 3, y: 1 },
          remainingActionPoints: 2,
        });
        store.selectUnit('left-unit-1');
        expect(store.reachableDestinations()).not.toEqual([]);
      });

      it('clears the selection and hover, keeping the interaction mode and last outcome', async () => {
        const store = await loadedStore();
        store.selectUnit('left-unit-1');
        store.moveSelectedUnit({ x: 2, y: 1 });
        const outcome = store.lastOutcome();
        store.hoverDestination({ x: 3, y: 1 });
        expect(store.movementPreview()).toBeDefined();

        store.endTurn();

        expect(store.selectedUnitId()).toBeUndefined();
        expect(store.selectedUnit()).toBeUndefined();
        expect(store.hoveredDestination()).toBeUndefined();
        expect(store.movementPreview()).toBeUndefined();
        expect(store.interactionMode()).toBe(InteractionMode.MOVE);
        expect(store.lastOutcome()).toBe(outcome);
      });

      it('keeps a non-default interaction mode', async () => {
        const store = await loadedStore();
        store.setInteractionMode(InteractionMode.ATTACK);

        store.endTurn();

        expect(store.interactionMode()).toBe(InteractionMode.ATTACK);
      });
    });
  });
});
