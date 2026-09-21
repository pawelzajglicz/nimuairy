import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BattleStateResponse } from '../api/generated/model';
import { BattleStore } from './battle.store';
import { InteractionMode } from './interaction-mode';

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
    TestBed.flushEffects();

    expect(store.loading()).toBe(true);
    expect(store.battleState()).toBeUndefined();
    expect(store.error()).toBeUndefined();

    httpMock.expectOne('/api/v1/battles/demo').flush({});
  });

  it('exposes the loaded battle state once the request succeeds', async () => {
    const store = TestBed.inject(BattleStore);
    TestBed.flushEffects();
    const response: BattleStateResponse = {
      board: { width: 21, height: 11, terrain: [] },
      orbs: [],
      walls: [],
      units: [],
    };

    httpMock.expectOne('/api/v1/battles/demo').flush(response);
    await vi.waitFor(() => expect(store.loading()).toBe(false));

    expect(store.battleState()).toEqual(response);
    expect(store.error()).toBeUndefined();
  });

  it('exposes an error when the request fails', async () => {
    const store = TestBed.inject(BattleStore);
    TestBed.flushEffects();

    httpMock
      .expectOne('/api/v1/battles/demo')
      .flush('failure', { status: 500, statusText: 'Server Error' });
    await vi.waitFor(() => expect(store.loading()).toBe(false));

    expect(store.error()).toBeDefined();
    expect(store.battleState()).toBeUndefined();
  });

  describe('selection and interaction mode', () => {
    it('starts with currentPlayer as LEFT', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.flushEffects();

      expect(store.currentPlayer()).toBe('LEFT');

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });

    it('starts with no selected unit', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.flushEffects();

      expect(store.selectedUnitId()).toBeUndefined();

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });

    it('starts in MOVE interaction mode', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.flushEffects();

      expect(store.interactionMode()).toBe(InteractionMode.MOVE);

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });

    it('selectUnit sets the selected unit', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.flushEffects();

      store.selectUnit('left-unit-1');

      expect(store.selectedUnitId()).toBe('left-unit-1');

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });

    it('selectUnit replaces the previous selection', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.flushEffects();

      store.selectUnit('left-unit-1');
      store.selectUnit('left-unit-2');

      expect(store.selectedUnitId()).toBe('left-unit-2');

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });

    it('allows selecting an opponent unit', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.flushEffects();

      store.selectUnit('right-unit-1');

      expect(store.selectedUnitId()).toBe('right-unit-1');

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });

    it('clearSelection removes the selection', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.flushEffects();

      store.selectUnit('left-unit-1');
      store.clearSelection();

      expect(store.selectedUnitId()).toBeUndefined();

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });

    it('clearSelection preserves the interaction mode', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.flushEffects();

      store.setInteractionMode(InteractionMode.ATTACK);
      store.clearSelection();

      expect(store.interactionMode()).toBe(InteractionMode.ATTACK);

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });

    it('setInteractionMode changes the mode', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.flushEffects();

      store.setInteractionMode(InteractionMode.ATTACK);

      expect(store.interactionMode()).toBe(InteractionMode.ATTACK);

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });

    it('changing interaction mode preserves the selected unit', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.flushEffects();

      store.selectUnit('left-unit-1');
      store.setInteractionMode(InteractionMode.ATTACK);

      expect(store.selectedUnitId()).toBe('left-unit-1');

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });

    it('selecting another unit preserves the current interaction mode', () => {
      const store = TestBed.inject(BattleStore);
      TestBed.flushEffects();

      store.setInteractionMode(InteractionMode.ATTACK);
      store.selectUnit('left-unit-1');
      store.selectUnit('right-unit-1');

      expect(store.interactionMode()).toBe(InteractionMode.ATTACK);

      httpMock.expectOne('/api/v1/battles/demo').flush({});
    });
  });
});
