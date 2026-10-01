import { Component, computed, input, output } from '@angular/core';
import type { BoardInteraction } from '../../board-interaction';
import type { BattleState, Position } from '../../domain/battle-state';
import { occupiedCells, positionKey } from '../../domain/geometry';
import type { ReachableCell } from '../../domain/movement';
import { InteractionMode } from '../../interaction-mode';
import type { MovementPreview } from '../../movement-preview';
import { BoardGridComponent } from '../board-grid/board-grid.component';
import { EntityLayerComponent } from '../entity-layer/entity-layer.component';
import { MovementOverlayComponent } from '../movement-overlay/movement-overlay.component';

/**
 * Coordinates board-level interaction: it is the single place that turns raw
 * unit/cell/destination clicks from its children into a BoardInteraction, so
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

  readonly interaction = output<BoardInteraction>();
  /** The destination under the pointer or focus; undefined when it leaves. */
  readonly destinationHover = output<Position | undefined>();

  protected readonly selectedUnit = computed(() =>
    this.battleState()?.units.find(({ id }) => id === this.selectedUnitId()),
  );

  /**
   * Every domain position covered by a unit footprint. A unit is its own
   * interactive target, so the terrain underneath must not offer a second one.
   * Walls and orbs are deliberately excluded: they are not interactive yet, so
   * the terrain under them stays the click/keyboard target (which clears the
   * selection). Derived from battleState; never stored anywhere else.
   */
  protected readonly unitPositions = computed<ReadonlySet<string>>(() => {
    const units = this.battleState()?.units ?? [];

    return new Set(
      units.flatMap((unit) =>
        occupiedCells(unit.position, unit.footprint).map(positionKey),
      ),
    );
  });

  protected onUnitClick(unitId: string): void {
    this.interaction.emit({ kind: 'unit-clicked', unitId });
  }

  protected onCellClick(position: Position): void {
    this.interaction.emit({ kind: 'cell-clicked', position });
  }

  protected onDestinationClick(position: Position): void {
    this.interaction.emit({ kind: 'destination-clicked', position });
  }
}
