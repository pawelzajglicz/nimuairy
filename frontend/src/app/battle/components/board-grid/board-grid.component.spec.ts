import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { BoardDto, TerrainCellDto } from '../../../api/generated/model';
import { BoardGridComponent } from './board-grid.component';

function buildDemoBoard(): BoardDto {
  const width = 21;
  const height = 11;
  const terrain: TerrainCellDto[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      terrain.push({ position: { x, y }, type: 'PLAIN' as const });
    }
  }

  return { width, height, terrain };
}

describe('BoardGridComponent', () => {
  it('renders one app-cell per terrain cell for the 21x11 demo board', async () => {
    const fixture = TestBed.createComponent(BoardGridComponent);
    fixture.componentRef.setInput('board', buildDemoBoard());
    await fixture.whenStable();

    const cells = fixture.nativeElement.querySelectorAll('app-cell');
    expect(cells.length).toBe(231);
  });

  it('renders every cell not covered by a unit as a button', async () => {
    const fixture = TestBed.createComponent(BoardGridComponent);
    fixture.componentRef.setInput('board', buildDemoBoard());
    fixture.componentRef.setInput('unitPositions', new Set(['3,2', '17,2']));
    await fixture.whenStable();

    const buttons = fixture.nativeElement.querySelectorAll('button.cell');
    expect(buttons.length).toBe(231 - 2);
  });
});
