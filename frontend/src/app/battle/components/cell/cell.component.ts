import { Component, input } from '@angular/core';
import type { PositionDto, TerrainCellDtoType } from '../../../api/generated/model';

@Component({
  selector: 'app-cell',
  imports: [],
  templateUrl: './cell.component.html',
  styleUrl: './cell.component.css',
})
export class CellComponent {
  readonly position = input.required<PositionDto>();
  readonly terrainType = input<TerrainCellDtoType>();
}
