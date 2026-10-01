import { Component, input, output } from '@angular/core';
import type { Position, TerrainType } from '../../domain/battle-state';

@Component({
  selector: 'app-cell',
  imports: [],
  templateUrl: './cell.component.html',
  styleUrl: './cell.component.css',
})
export class CellComponent {
  readonly position = input.required<Position>();
  readonly terrainType = input<TerrainType>();
  /** True when a unit covers this cell; the unit is then the sole click/keyboard target, so the terrain is inert. */
  readonly occupiedByUnit = input(false);

  readonly cellClick = output<Position>();
}
