import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { Board, Position } from '../../domain/battle-state';
import { toGridPosition } from '../../utils/coordinate-mapper';
import { AttackRangeOverlayComponent } from './attack-range-overlay.component';

const BOARD: Board = { width: 6, height: 4, terrain: [] };

function render(cells: readonly Position[], board?: Board) {
  const fixture = TestBed.createComponent(AttackRangeOverlayComponent);
  fixture.componentRef.setInput('board', board);
  fixture.componentRef.setInput('cells', cells);
  fixture.detectChanges();
  return fixture;
}

function rangeCells(fixture: ReturnType<typeof render>): HTMLElement[] {
  return Array.from(
    fixture.nativeElement.querySelectorAll('.attack-range-cell'),
  );
}

describe('AttackRangeOverlayComponent', () => {
  it('places one cell per position with the board coordinate mapping', () => {
    const cells = [
      { x: 1, y: 0 },
      { x: 4, y: 3 },
    ];

    const rendered = rangeCells(render(cells, BOARD));

    expect(rendered).toHaveLength(2);
    cells.forEach((cell, i) => {
      const { gridColumn, gridRow } = toGridPosition(cell, BOARD.height);
      expect(rendered[i].style.gridColumn).toBe(String(gridColumn));
      expect(rendered[i].style.gridRow).toBe(String(gridRow));
    });
  });

  it('draws nothing without cells', () => {
    expect(rangeCells(render([], BOARD))).toHaveLength(0);
  });

  it('draws nothing before the board is known', () => {
    expect(rangeCells(render([{ x: 1, y: 0 }], undefined))).toHaveLength(0);
  });

  it('offers nothing to click or focus', () => {
    const fixture = render([{ x: 1, y: 0 }], BOARD);

    expect(
      fixture.nativeElement.querySelector('button, [tabindex]'),
    ).toBeNull();
  });
});
