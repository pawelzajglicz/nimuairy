import { Component, computed, input, output } from '@angular/core';
import type {
  BoardDto,
  PositionDto,
  TerrainCellDtoType,
} from '../../../api/generated/model';
import { toGridPosition } from '../../utils/coordinate-mapper';
import { positionKey } from '../../utils/footprint';
import { CellComponent } from '../cell/cell.component';

interface RenderedCell {
  key: string;
  position: PositionDto;
  terrainType: TerrainCellDtoType | undefined;
  occupiedByUnit: boolean;
  gridColumn: number;
  gridRow: number;
}

const NO_UNIT_POSITIONS: ReadonlySet<string> = new Set();

@Component({
  selector: 'app-board-grid',
  imports: [CellComponent],
  templateUrl: './board-grid.component.html',
  styleUrl: './board-grid.component.css',
})
export class BoardGridComponent {
  readonly board = input<BoardDto>();
  /** Keys (see positionKey) of domain positions covered by a unit footprint. */
  readonly unitPositions = input<ReadonlySet<string>>(NO_UNIT_POSITIONS);

  readonly cellClick = output<PositionDto>();

  protected readonly cells = computed<RenderedCell[]>(() => {
    const board = this.board();
    const height = board?.height ?? 0;
    const unitPositions = this.unitPositions();

    return (board?.terrain ?? []).map((terrainCell) => {
      const x = terrainCell.position?.x ?? 0;
      const y = terrainCell.position?.y ?? 0;
      const key = positionKey({ x, y });
      const { gridColumn, gridRow } = toGridPosition({ x, y }, height);

      return {
        key,
        position: { x, y },
        terrainType: terrainCell.type,
        occupiedByUnit: unitPositions.has(key),
        gridColumn,
        gridRow,
      };
    });
  });
}
