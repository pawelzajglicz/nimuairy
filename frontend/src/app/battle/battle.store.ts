import { computed } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withLinkedState,
  withMethods,
  withProps,
  withState,
} from '@ngrx/signals';
import { getDemoBattleResource } from '../api/generated/nimuairy-api';
import { toBattleState } from './battle-state.mapper';
import type { BattleState } from './domain/battle-state';
import { InteractionMode } from './interaction-mode';

interface BattleSelectionState {
  selectedUnitId: string | undefined;
  interactionMode: InteractionMode;
}

const initialSelectionState: BattleSelectionState = {
  selectedUnitId: undefined,
  interactionMode: InteractionMode.MOVE,
};

/**
 * Owns the demo battle's request lifecycle (loading/error), the current domain
 * BattleState, and the feature-level selection/interaction-mode UI state.
 * Gameplay rules belong to the framework-independent BattleEngine (domain/), not here.
 */
export const BattleStore = signalStore(
  withState(initialSelectionState),
  withProps(() => ({
    _demoBattleResource: getDemoBattleResource(),
  })),
  // Seeded from the response, then replaced only by BattleEngine results. As a
  // linked signal it re-seeds only when the response itself changes, so this
  // computation must read nothing but the resource: any other dependency would
  // silently reset the battle.
  withLinkedState(({ _demoBattleResource }) => ({
    battleState: (): BattleState | undefined =>
      _demoBattleResource.hasValue()
        ? toBattleState(_demoBattleResource.value())
        : undefined,
  })),
  withComputed(({ _demoBattleResource }) => ({
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
