import { Component, computed, input, output } from '@angular/core';
import type {
  BattleState,
  PlayerSide,
  Position,
} from '../../domain/battle-state';
import { occupiedCells } from '../../domain/geometry';
import { InteractionMode } from '../../interaction-mode';
import { toGridPosition } from '../../utils/coordinate-mapper';

type EntityKind = 'unit' | 'orb' | 'wall';

interface RenderedEntityCell {
  key: string;
  id: string;
  kind: EntityKind;
  owner: PlayerSide;
  gridColumn: number;
  gridRow: number;
}

@Component({
  selector: 'app-entity-layer',
  imports: [],
  templateUrl: './entity-layer.component.html',
  styleUrl: './entity-layer.component.css',
})
export class EntityLayerComponent {
  readonly battleState = input<BattleState>();
  readonly selectedUnitId = input<string>();
  readonly interactionMode = input<InteractionMode>(InteractionMode.MOVE);

  readonly unitClick = output<string>();

  protected readonly board = computed(() => this.battleState()?.board);

  protected isSelected(cell: RenderedEntityCell): boolean {
    return cell.id === this.selectedUnitId();
  }

  /** The mode the selection is shown in; only the selected unit carries it. */
  protected selectionMode(cell: RenderedEntityCell): InteractionMode | null {
    return this.isSelected(cell) ? this.interactionMode() : null;
  }

  /** Other units step back while one is selected, so the selection stands out without extra colour. */
  protected isDimmed(cell: RenderedEntityCell): boolean {
    return this.selectedUnitId() !== undefined && !this.isSelected(cell);
  }

  protected readonly entityCells = computed<RenderedEntityCell[]>(() => {
    const state = this.battleState();
    const height = state?.board.height ?? 0;

    // Walls first, then orbs, then units, so units render on top when footprints overlap.
    return [
      ...(state?.walls ?? []).flatMap((wall) =>
        footprintCells('wall', wall, height),
      ),
      ...(state?.orbs ?? []).flatMap((orb) =>
        footprintCells('orb', orb, height),
      ),
      ...(state?.units ?? []).flatMap((unit) =>
        footprintCells('unit', unit, height),
      ),
    ];
  });

  protected onEntityCellClick(cell: RenderedEntityCell): void {
    if (cell.kind === 'unit') {
      this.unitClick.emit(cell.id);
    }
  }
}

interface PlacedEntity {
  readonly id: string;
  readonly owner: PlayerSide;
  readonly position: Position;
  readonly footprint: readonly Position[];
}

function footprintCells(
  kind: EntityKind,
  { id, owner, position, footprint }: PlacedEntity,
  boardHeight: number,
): RenderedEntityCell[] {
  return occupiedCells(position, footprint).map((cell) => {
    const { gridColumn, gridRow } = toGridPosition(cell, boardHeight);

    return {
      key: `${kind}-${id}-${cell.x},${cell.y}`,
      id,
      kind,
      owner,
      gridColumn,
      gridRow,
    };
  });
}
