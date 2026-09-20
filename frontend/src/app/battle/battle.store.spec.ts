import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { BattleStateResponse } from '../api/generated/model';
import { BattleStore } from './battle.store';

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
});
