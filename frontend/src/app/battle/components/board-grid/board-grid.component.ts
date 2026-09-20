import { Component, computed, input } from '@angular/core';
import type { BoardDto, PositionDto, TerrainCellDtoType } from '../../../api/generated/model';
import { toGridPosition } from '../../utils/coordinate-mapper';
import { CellComponent } from '../cell/cell.component';

interface RenderedCell {
  key: string;
  position: PositionDto;
  terrainType: TerrainCellDtoType | undefined;
  gridColumn: number;
  gridRow: number;
}

@Component({
  selector: 'app-board-grid',
  imports: [CellComponent],
  templateUrl: './board-grid.component.html',
  styleUrl: './board-grid.component.css',
})
export class BoardGridComponent {
  readonly board = input<BoardDto>();

  protected readonly cells = computed<RenderedCell[]>(() => {
    const board = this.board();
    const height = board?.height ?? 0;

    return (board?.terrain ?? []).map((terrainCell) => {
      const x = terrainCell.position?.x ?? 0;
      const y = terrainCell.position?.y ?? 0;
      const { gridColumn, gridRow } = toGridPosition({ x, y }, height);

      return {
        key: `${x},${y}`,
        position: { x, y },
        terrainType: terrainCell.type,
        gridColumn,
        gridRow,
      };
    });
  });
}
