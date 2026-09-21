import { Component, computed, input, output } from '@angular/core';
import type {
  BattleStateResponse,
  PositionDto,
} from '../../../api/generated/model';
import type { BoardInteraction } from '../../board-interaction';
import { InteractionMode } from '../../interaction-mode';
import { footprintPositions, positionKey } from '../../utils/footprint';
import { BoardGridComponent } from '../board-grid/board-grid.component';
import { EntityLayerComponent } from '../entity-layer/entity-layer.component';

/**
 * Coordinates board-level interaction: it is the single place that turns raw
 * unit/cell clicks from its children into a BoardInteraction, so that
 * EntityLayer and BoardGrid stay simple emitters of what was clicked, not
 * owners of what that click means.
 */
@Component({
  selector: 'app-battle-board',
  imports: [BoardGridComponent, EntityLayerComponent],
  templateUrl: './battle-board.component.html',
  styleUrl: './battle-board.component.css',
})
export class BattleBoardComponent {
  readonly battleState = input<BattleStateResponse>();
  readonly selectedUnitId = input<string>();
  readonly interactionMode = input<InteractionMode>(InteractionMode.MOVE);

  readonly interaction = output<BoardInteraction>();

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
        footprintPositions(unit.position, unit.footprint).map(positionKey),
      ),
    );
  });

  protected onUnitClick(unitId: string): void {
    this.interaction.emit({ kind: 'unit-clicked', unitId });
  }

  protected onCellClick(position: PositionDto): void {
    this.interaction.emit({ kind: 'cell-clicked', position });
  }
}
