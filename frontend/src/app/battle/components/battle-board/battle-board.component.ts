import { Component, computed, input, output } from '@angular/core';
import type { BoardInteraction } from '../../board-interaction';
import type {
  BattleState,
  Orb,
  Position,
  Unit,
  Wall,
} from '../../domain/battle-state';
import type { AttackTarget, AttackTargetKind } from '../../domain/combat';
import { occupiedCells, positionKey } from '../../domain/geometry';
import type { ReachableCell } from '../../domain/movement';
import { InteractionMode } from '../../interaction-mode';
import type { MovementPreview } from '../../movement-preview';
import { BoardGridComponent } from '../board-grid/board-grid.component';
import { EntityLayerComponent } from '../entity-layer/entity-layer.component';
import { MovementOverlayComponent } from '../movement-overlay/movement-overlay.component';

/** Typed as a Record so that a new target kind does not compile without one. */
const TARGET_COLLECTION: Record<
  AttackTargetKind,
  (state: BattleState) => readonly (Unit | Wall | Orb)[]
> = {
  UNIT: (state) => state.units,
  WALL: (state) => state.walls,
  ORB: (state) => state.orbs,
};

/**
 * Coordinates board-level interaction: it is the single place that turns raw
 * unit/cell/destination/attack-target clicks from its children into a BoardInteraction, so
 * that EntityLayer, BoardGrid and MovementOverlay stay simple emitters of what
 * was clicked, not owners of what that click means.
 */
@Component({
  selector: 'app-battle-board',
  imports: [BoardGridComponent, EntityLayerComponent, MovementOverlayComponent],
  templateUrl: './battle-board.component.html',
  styleUrl: './battle-board.component.css',
})
export class BattleBoardComponent {
  readonly battleState = input<BattleState>();
  readonly selectedUnitId = input<string>();
  readonly interactionMode = input<InteractionMode>(InteractionMode.MOVE);
  readonly reachableDestinations = input<readonly ReachableCell[]>([]);
  readonly movementPreview = input<MovementPreview>();
  /** The selected unit's legal attack targets, as the domain reports them. */
  readonly attackTargets = input<readonly AttackTarget[]>([]);
  readonly attackedTarget = input<AttackTarget>();

  readonly interaction = output<BoardInteraction>();
  /** The destination under the pointer or focus; undefined when it leaves. */
  readonly destinationHover = output<Position | undefined>();

  protected readonly selectedUnit = computed(() =>
    this.battleState()?.units.find(({ id }) => id === this.selectedUnitId()),
  );

  /**
   * Every domain position covered by an interactive entity: any unit, and a
   * wall or orb while it is an attack target. Such an entity is its own click
   * target, so the terrain underneath must not offer a second one. Other walls
   * and orbs are not interactive, so the terrain under them stays the
   * click/keyboard target (which clears the selection). Derived from
   * battleState and the targets; never stored anywhere else.
   */
  protected readonly entityTargetPositions = computed<ReadonlySet<string>>(
    () => {
      const state = this.battleState();
      if (!state) {
        return new Set();
      }
      const targets = this.attackTargets().flatMap(({ kind, id }) =>
        TARGET_COLLECTION[kind](state).filter((entity) => entity.id === id),
      );

      return new Set(
        [...state.units, ...targets].flatMap(({ position, footprint }) =>
          occupiedCells(position, footprint).map(positionKey),
        ),
      );
    },
  );

  protected onUnitClick(unitId: string): void {
    this.interaction.emit({ kind: 'unit-clicked', unitId });
  }

  protected onCellClick(position: Position): void {
    this.interaction.emit({ kind: 'cell-clicked', position });
  }

  protected onDestinationClick(position: Position): void {
    this.interaction.emit({ kind: 'destination-clicked', position });
  }

  protected onAttackTargetClick(target: AttackTarget): void {
    this.interaction.emit({ kind: 'attack-target-clicked', target });
  }
}
