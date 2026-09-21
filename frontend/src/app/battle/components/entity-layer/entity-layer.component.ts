import { Component, computed, input, output } from '@angular/core';
import type {
  BattleStateResponse,
  OrbDtoOwner,
  PositionDto,
  UnitDtoOwner,
  WallDtoOwner,
} from '../../../api/generated/model';
import { toGridPosition } from '../../utils/coordinate-mapper';
import { footprintPositions } from '../../utils/footprint';
import { InteractionMode } from '../../interaction-mode';

type EntityKind = 'unit' | 'orb' | 'wall';
type EntityOwner = UnitDtoOwner | OrbDtoOwner | WallDtoOwner;

interface RenderedEntityCell {
  key: string;
  id: string | undefined;
  kind: EntityKind;
  owner: EntityOwner | undefined;
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
  readonly battleState = input<BattleStateResponse>();
  readonly selectedUnitId = input<string>();
  readonly interactionMode = input<InteractionMode>(InteractionMode.MOVE);

  readonly unitClick = output<string>();

  protected readonly board = computed(() => this.battleState()?.board);

  protected isSelected(cell: RenderedEntityCell): boolean {
    return cell.id !== undefined && cell.id === this.selectedUnitId();
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
    const height = state?.board?.height ?? 0;

    // Walls first, then orbs, then units, so units render on top when footprints overlap.
    return [
      ...(state?.walls ?? []).flatMap((wall) =>
        footprintCells(
          'wall',
          wall.owner,
          wall.id,
          wall.position,
          wall.footprint,
          height,
        ),
      ),
      ...(state?.orbs ?? []).flatMap((orb) =>
        footprintCells(
          'orb',
          orb.owner,
          orb.id,
          orb.position,
          orb.footprint,
          height,
        ),
      ),
      ...(state?.units ?? []).flatMap((unit) =>
        footprintCells(
          'unit',
          unit.owner,
          unit.id,
          unit.position,
          unit.footprint,
          height,
        ),
      ),
    ];
  });

  protected onEntityCellClick(cell: RenderedEntityCell): void {
    if (cell.kind === 'unit' && cell.id) {
      this.unitClick.emit(cell.id);
    }
  }
}

function footprintCells(
  kind: EntityKind,
  owner: EntityOwner | undefined,
  id: string | undefined,
  anchor: PositionDto | undefined,
  footprint: PositionDto[] | undefined,
  boardHeight: number,
): RenderedEntityCell[] {
  return footprintPositions(anchor, footprint).map(({ x, y }, index) => {
    const { gridColumn, gridRow } = toGridPosition({ x, y }, boardHeight);

    return {
      key: `${kind}-${id ?? index}-${x},${y}`,
      id,
      kind,
      owner,
      gridColumn,
      gridRow,
    };
  });
}
