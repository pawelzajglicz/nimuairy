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
import type { LastMovementOutcome } from './movement-outcome';
import { toMovementPreview } from './movement-preview';

interface BattleUiState {
  selectedUnitId: string | undefined;
  interactionMode: InteractionMode;
  hoveredDestination: Position | undefined;
  /**
   * One global slot: replaced only by the next move attempt, and kept across
   * selection and mode changes and the end of a turn.
   */
  lastOutcome: LastMovementOutcome | undefined;
}

const initialUiState: BattleUiState = {
  selectedUnitId: undefined,
  interactionMode: InteractionMode.MOVE,
  hoveredDestination: undefined,
  lastOutcome: undefined,
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
      // Derived, never stored, so it always reflects the current state. Any
      // unit can be inspected; only execution checks whether it may move.
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
        selectedUnit: computed(() =>
          battleState()?.units.find(({ id }) => id === selectedUnitId()),
        ),
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
      const unit = store.selectedUnit();
      const range = store._movementRange();
      if (!state || !unit || !range?.ok) {
        return;
      }
      const preview = toMovementPreview(range.value, destination);
      if (!preview) {
        return;
      }

      const result = store._engine.execute(state, {
        type: 'MOVE_UNIT',
        unitId: unit.id,
        destination,
        // Exactly the previewed path, so the executed move is the one shown.
        path: preview.steps.map(({ to }) => to),
      });
      if (!result.ok) {
        patchState(store, {
          lastOutcome: {
            kind: 'REJECTED',
            action: 'MOVE',
            error: result.error,
          },
        });
        return;
      }
      // A target removed under a resting pointer never fires mouseleave, so
      // the hover is cleared here rather than left pointing at the old range.
      patchState(store, {
        battleState: result.value.state,
        hoveredDestination: undefined,
        lastOutcome: {
          kind: 'MOVED',
          unitId: unit.id,
          owner: unit.owner,
          steps: result.value.steps,
          cost: result.value.cost,
        },
      });
    },
    endTurn(): void {
      const state = store.battleState();
      if (!state) {
        return;
      }
      // Selection and hover belong to the turn that just ended, whichever
      // player owns the selected unit, so the new turn starts with nothing
      // selected.
      patchState(store, {
        battleState: store._engine.endTurn(state),
        selectedUnitId: undefined,
        hoveredDestination: undefined,
      });
    },
  })),
);
