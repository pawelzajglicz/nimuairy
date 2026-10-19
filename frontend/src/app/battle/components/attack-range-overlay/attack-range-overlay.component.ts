import { Component, computed, input } from '@angular/core';
import type { Board, Position } from '../../domain/battle-state';
import { positionKey } from '../../domain/geometry';
import { toGridPosition } from '../../utils/coordinate-mapper';

interface RenderedCell {
  key: string;
  gridColumn: number;
  gridRow: number;
}

const NO_CELLS: readonly Position[] = [];

/**
 * The selected unit's melee reach, drawn under the units as a marking on the
 * board itself. The cells come from the domain; this layer only places them.
 * It is not interactive: what may be attacked is shown, and clicked, on the
 * entity layer above.
 */
@Component({
  selector: 'app-attack-range-overlay',
  imports: [],
  templateUrl: './attack-range-overlay.component.html',
  styleUrl: './attack-range-overlay.component.css',
})
export class AttackRangeOverlayComponent {
  readonly board = input<Board>();
  readonly cells = input<readonly Position[]>(NO_CELLS);

  protected readonly renderedCells = computed<RenderedCell[]>(() => {
    const height = this.board()?.height ?? 0;
    return this.cells().map((cell) => ({
      key: positionKey(cell),
      ...toGridPosition(cell, height),
    }));
  });
}
