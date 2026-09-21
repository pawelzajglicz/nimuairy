import { computed } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import { getDemoBattleResource } from '../api/generated/nimuairy-api';
import type { UnitDtoOwner } from '../api/generated/model';
import { InteractionMode } from './interaction-mode';

interface BattleSelectionState {
  currentPlayer: UnitDtoOwner;
  selectedUnitId: string | undefined;
  interactionMode: InteractionMode;
}

const initialSelectionState: BattleSelectionState = {
  currentPlayer: 'LEFT',
  selectedUnitId: undefined,
  interactionMode: InteractionMode.MOVE,
};

/**
 * Owns the demo battle's request lifecycle (loading/error/state) plus the
 * feature-level selection/interaction-mode UI state.
 * Gameplay rules belong to a future, framework-independent BattleEngine, not here.
 */
export const BattleStore = signalStore(
  withState(initialSelectionState),
  withProps(() => ({
    _demoBattleResource: getDemoBattleResource(),
  })),
  withComputed(({ _demoBattleResource }) => ({
    battleState: computed(() =>
      _demoBattleResource.hasValue() ? _demoBattleResource.value() : undefined,
    ),
    loading: computed(() => _demoBattleResource.isLoading()),
    error: computed(() => _demoBattleResource.error()),
  })),
  withMethods((store) => ({
    selectUnit(unitId: string): void {
      patchState(store, { selectedUnitId: unitId });
    },
    clearSelection(): void {
      patchState(store, { selectedUnitId: undefined });
    },
    setInteractionMode(mode: InteractionMode): void {
      patchState(store, { interactionMode: mode });
    },
  })),
);
