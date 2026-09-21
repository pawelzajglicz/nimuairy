import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { PositionDto } from '../../../api/generated/model';
import { CellComponent } from './cell.component';

function render(position: PositionDto, occupiedByUnit = false) {
  const fixture = TestBed.createComponent(CellComponent);
  fixture.componentRef.setInput('position', position);
  fixture.componentRef.setInput('occupiedByUnit', occupiedByUnit);
  fixture.detectChanges();
  return fixture;
}

describe('CellComponent', () => {
  describe('when not covered by a unit', () => {
    it('renders as a native button, so it is keyboard operable by construction', () => {
      const fixture = render({ x: 3, y: 2 });
      const cell: HTMLElement = fixture.nativeElement.querySelector('.cell');

      expect(cell.tagName).toBe('BUTTON');
    });

    it('emits cellClick with its position when activated', () => {
      const fixture = render({ x: 3, y: 2 });
      const emitted: PositionDto[] = [];
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
      const emitted: PositionDto[] = [];
      fixture.componentInstance.cellClick.subscribe((position) =>
        emitted.push(position),
      );

      const cell: HTMLElement = fixture.nativeElement.querySelector('.cell');
      cell.click();

      expect(emitted).toEqual([]);
    });
  });
});
