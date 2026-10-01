import { Component, computed, input, output } from '@angular/core';
import type { Board, Position, TerrainType } from '../../domain/battle-state';
import { positionKey } from '../../domain/geometry';
import { toGridPosition } from '../../utils/coordinate-mapper';
import { CellComponent } from '../cell/cell.component';

interface RenderedCell {
  key: string;
  position: Position;
  terrainType: TerrainType;
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
  readonly board = input<Board>();
  /** Keys (see positionKey) of domain positions covered by a unit footprint. */
  readonly unitPositions = input<ReadonlySet<string>>(NO_UNIT_POSITIONS);

  readonly cellClick = output<Position>();

  protected readonly cells = computed<RenderedCell[]>(() => {
    const board = this.board();
    const height = board?.height ?? 0;
    const unitPositions = this.unitPositions();

    return (board?.terrain ?? []).map(({ position, type }) => {
      const key = positionKey(position);
      const { gridColumn, gridRow } = toGridPosition(position, height);

      return {
        key,
        position,
        terrainType: type,
        occupiedByUnit: unitPositions.has(key),
        gridColumn,
        gridRow,
      };
    });
  });
}
