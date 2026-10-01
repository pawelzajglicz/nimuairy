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
import { BattleEngine } from './domain/battle-engine';
import type { BattleState, Position } from './domain/battle-state';
import type { ReachableCell } from './domain/movement';
import { InteractionMode } from './interaction-mode';
import { toMovementPreview } from './movement-preview';

interface BattleUiState {
  selectedUnitId: string | undefined;
  interactionMode: InteractionMode;
  hoveredDestination: Position | undefined;
}

const initialUiState: BattleUiState = {
  selectedUnitId: undefined,
  interactionMode: InteractionMode.MOVE,
  hoveredDestination: undefined,
};

const NO_DESTINATIONS: readonly ReachableCell[] = [];

/**
 * Owns the demo battle's request lifecycle (loading/error), the current domain
 * BattleState, and the feature-level selection/interaction/hover UI state.
 * Gameplay rules belong to the framework-independent BattleEngine (domain/), not here.
 */
export const BattleStore = signalStore(
  withState(initialUiState),
  withProps(() => ({
    _demoBattleResource: getDemoBattleResource(),
    // Created directly rather than injected: the engine is framework-independent.
    _engine: new BattleEngine(),
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
  withComputed(
    ({
      _demoBattleResource,
      _engine,
      battleState,
      selectedUnitId,
      interactionMode,
      hoveredDestination,
    }) => {
      // Derived, never stored, so it always reflects the current state. The
      // engine decides whether the selected unit may move at all.
      const _movementRange = computed(() => {
        const state = battleState();
        const unitId = selectedUnitId();
        if (
          !state ||
          unitId === undefined ||
          interactionMode() !== InteractionMode.MOVE
        ) {
          return undefined;
        }
        return _engine.reachability(state, unitId);
      });

      return {
        loading: computed(() => _demoBattleResource.isLoading()),
        error: computed(() => _demoBattleResource.error()),
        _movementRange,
        /** Where the selected unit can move; its own anchor is not a destination. */
        reachableDestinations: computed(() => {
          const range = _movementRange();
          return range?.ok
            ? [...range.value.cells.values()].filter(({ via }) => via !== null)
            : NO_DESTINATIONS;
        }),
        movementPreview: computed(() => {
          const range = _movementRange();
          const hovered = hoveredDestination();
          return range?.ok && hovered
            ? toMovementPreview(range.value, hovered)
            : undefined;
        }),
      };
    },
  ),
  withMethods((store) => ({
    selectUnit(unitId: string): void {
      patchState(store, {
        selectedUnitId: unitId,
        hoveredDestination: undefined,
      });
    },
    clearSelection(): void {
      patchState(store, {
        selectedUnitId: undefined,
        hoveredDestination: undefined,
      });
    },
    setInteractionMode(mode: InteractionMode): void {
      patchState(store, {
        interactionMode: mode,
        hoveredDestination: undefined,
      });
    },
    hoverDestination(destination: Position | undefined): void {
      patchState(store, { hoveredDestination: destination });
    },
    moveSelectedUnit(destination: Position): void {
      const state = store.battleState();
      const unitId = store.selectedUnitId();
      const range = store._movementRange();
      if (!state || unitId === undefined || !range?.ok) {
        return;
      }
      const preview = toMovementPreview(range.value, destination);
      if (!preview) {
        return;
      }

      const result = store._engine.execute(state, {
        type: 'MOVE_UNIT',
        unitId,
        destination,
        // Exactly the previewed path, so the executed move is the one shown.
        path: preview.steps.map(({ to }) => to),
      });
      if (result.ok) {
        // A target removed under a resting pointer never fires mouseleave, so
        // the hover is cleared here rather than left pointing at the old range.
        patchState(store, {
          battleState: result.value.state,
          hoveredDestination: undefined,
        });
      }
    },
  })),
);
