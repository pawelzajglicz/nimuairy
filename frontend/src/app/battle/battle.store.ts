import { computed } from '@angular/core';
import { signalStore, withComputed, withProps } from '@ngrx/signals';
import { getDemoBattleResource } from '../api/generated/nimuairy-api';

/**
 * Owns the demo battle's request lifecycle (loading/error/state).
 * Gameplay rules belong to a future, framework-independent BattleEngine, not here.
 */
export const BattleStore = signalStore(
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
);
