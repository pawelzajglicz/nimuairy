import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { Position, TerrainType } from '../../domain/battle-state';
import { CellComponent } from './cell.component';

function render(
  position: Position,
  occupiedByUnit = false,
  terrainType?: TerrainType,
) {
  const fixture = TestBed.createComponent(CellComponent);
  fixture.componentRef.setInput('position', position);
  fixture.componentRef.setInput('occupiedByUnit', occupiedByUnit);
  if (terrainType !== undefined) {
    fixture.componentRef.setInput('terrainType', terrainType);
  }
  fixture.detectChanges();
  return fixture;
}

describe('CellComponent', () => {
  describe('terrain rendering', () => {
    it('exposes the terrain type as a data-terrain attribute, distinguishing ROCK from PLAIN', () => {
      const plain = render({ x: 3, y: 2 }, false, 'PLAIN');
      const rock = render({ x: 3, y: 2 }, false, 'ROCK');

      expect(
        plain.nativeElement.querySelector('.cell').getAttribute('data-terrain'),
      ).toBe('PLAIN');
      expect(
        rock.nativeElement.querySelector('.cell').getAttribute('data-terrain'),
      ).toBe('ROCK');
    });
  });

  describe('when not covered by a unit', () => {
    it('renders as a native button, so it is keyboard operable by construction', () => {
      const fixture = render({ x: 3, y: 2 });
      const cell: HTMLElement = fixture.nativeElement.querySelector('.cell');

      expect(cell.tagName).toBe('BUTTON');
    });

    it('emits cellClick with its position when activated', () => {
      const fixture = render({ x: 3, y: 2 });
      const emitted: Position[] = [];
      fixture.componentInstance.cellClick.subscribe((position) =>
        emitted.push(position),
      );

      const button: HTMLElement = fixture.nativeElement.querySelector('.cell');
      button.click();

      expect(emitted).toEqual([{ x: 3, y: 2 }]);
    });
  });

  describe('when covered by a unit', () => {
    it('still renders the terrain, but not as a button or focusable element', () => {
      const fixture = render({ x: 3, y: 2 }, true);
      const cell: HTMLElement = fixture.nativeElement.querySelector('.cell');

      expect(cell).toBeTruthy();
      expect(cell.tagName).not.toBe('BUTTON');
      expect(cell.hasAttribute('tabindex')).toBe(false);
      expect(fixture.nativeElement.querySelector('button')).toBeNull();
    });

    it('does not emit cellClick when clicked', () => {
      const fixture = render({ x: 3, y: 2 }, true);
      const emitted: Position[] = [];
      fixture.componentInstance.cellClick.subscribe((position) =>
        emitted.push(position),
      );

      const cell: HTMLElement = fixture.nativeElement.querySelector('.cell');
      cell.click();

      expect(emitted).toEqual([]);
    });
  });
});
