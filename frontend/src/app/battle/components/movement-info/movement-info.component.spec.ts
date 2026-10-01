import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { Unit } from '../../domain/battle-state';
import { testUnit } from '../../domain/testing/battle-fixtures';
import type { LastMovementOutcome } from '../../movement-outcome';
import type { MovementPreview } from '../../movement-preview';
import { MovementInfoComponent } from './movement-info.component';

interface Inputs {
  unit?: Unit;
  preview?: MovementPreview;
  lastOutcome?: LastMovementOutcome;
}

function render(inputs: Inputs = {}) {
  const fixture = TestBed.createComponent(MovementInfoComponent);
  for (const [name, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, value);
  }
  fixture.detectChanges();
  return fixture;
}

type Fixture = ReturnType<typeof render>;

/** Text content with whitespace collapsed, or undefined when nothing matches. */
function text(fixture: Fixture, selector: string): string | undefined {
  const element: HTMLElement | null =
    fixture.nativeElement.querySelector(selector);
  return element?.textContent?.replace(/\s+/g, ' ').trim();
}

/** A LEFT unit at (4,3) that has spent 1 + √2 of its 5 movement. */
const movedUnit = testUnit({
  id: 'unit-left-2',
  position: { x: 4, y: 3 },
  moveRange: 5,
  remainingMovement: 5 - 1 - Math.SQRT2,
});

describe('MovementInfoComponent', () => {
  describe('selected unit', () => {
    it('shows movement spent, the allowance and what remains, rounded to two decimals', () => {
      const fixture = render({ unit: movedUnit });

      expect(text(fixture, '.unit-movement')).toBe(
        'unit-left-2 (LEFT) · Move 2.41 / 5 · remaining 2.59',
      );
    });

    it('shows nothing spent for a unit that has not moved', () => {
      const fixture = render({ unit: testUnit() });

      expect(text(fixture, '.unit-movement')).toBe(
        'left-1x1 (LEFT) · Move 0 / 5 · remaining 5',
      );
    });

    it('offers a reset control that emits when activated', () => {
      const fixture = render({ unit: movedUnit });
      let resets = 0;
      fixture.componentInstance.resetMovement.subscribe(() => resets++);
      const button: HTMLButtonElement = fixture.nativeElement.querySelector(
        'button.reset-button',
      );

      button.click();

      expect(button.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'Reset movement (dev)',
      );
      expect(resets).toBe(1);
    });

    it('shows the previewed path from the unit and its cost', () => {
      const fixture = render({
        unit: movedUnit,
        preview: {
          destination: { x: 6, y: 4 },
          steps: [
            { from: { x: 4, y: 3 }, to: { x: 5, y: 3 }, cost: 1 },
            { from: { x: 5, y: 3 }, to: { x: 6, y: 4 }, cost: Math.SQRT2 },
          ],
          cost: 1 + Math.SQRT2,
        },
      });

      expect(text(fixture, '.preview')).toBe(
        'Preview: cost 2.41 · (4,3) → (5,3) → (6,4)',
      );
    });

    it('shows no unit details or reset control without a selected unit', () => {
      const fixture = render();

      expect(text(fixture, '.no-selection')).toBe('No unit selected.');
      expect(fixture.nativeElement.querySelector('.unit-movement')).toBeNull();
      expect(fixture.nativeElement.querySelector('.reset-button')).toBeNull();
    });
  });

  describe('last outcome', () => {
    it('describes a move with its owner, unit, start, end and cost', () => {
      const fixture = render({
        lastOutcome: {
          kind: 'MOVED',
          unitId: 'unit-left-2',
          owner: 'LEFT',
          steps: [
            { from: { x: 5, y: 4 }, to: { x: 6, y: 4 }, cost: 1 },
            { from: { x: 6, y: 4 }, to: { x: 7, y: 5 }, cost: Math.SQRT2 },
          ],
          cost: 1 + Math.SQRT2,
        },
      });

      expect(text(fixture, '.last-outcome')).toBe(
        'LEFT moved unit-left-2 (5,4) → (7,5) · cost 2.41',
      );
    });

    it('describes a movement reset', () => {
      const fixture = render({
        lastOutcome: { kind: 'MOVEMENT_RESET', unitId: 'unit-left-2' },
      });

      expect(text(fixture, '.last-outcome')).toBe(
        'Movement reset for unit-left-2',
      );
    });

    it.each<{ outcome: LastMovementOutcome; expected: string }>([
      {
        outcome: {
          kind: 'REJECTED',
          action: 'MOVE',
          error: { type: 'INVALID_PATH', reason: 'BLOCKED' },
        },
        expected: 'Move rejected: INVALID_PATH (BLOCKED)',
      },
      {
        outcome: {
          kind: 'REJECTED',
          action: 'MOVE',
          error: {
            type: 'INSUFFICIENT_MOVEMENT',
            required: 1 + Math.SQRT2,
            available: 2,
          },
        },
        expected: 'Move rejected: INSUFFICIENT_MOVEMENT (needs 2.41, has 2)',
      },
      {
        outcome: {
          kind: 'REJECTED',
          action: 'RESET',
          error: { type: 'UNIT_CANNOT_MOVE', unitId: 'unit-right-1' },
        },
        expected: 'Reset rejected: UNIT_CANNOT_MOVE',
      },
    ])('describes a rejection: $expected', ({ outcome, expected }) => {
      expect(text(render({ lastOutcome: outcome }), '.last-outcome')).toBe(
        expected,
      );
    });

    it('stays visible without a selected unit, in a polite live region', () => {
      const fixture = render({
        lastOutcome: { kind: 'MOVEMENT_RESET', unitId: 'unit-left-2' },
      });
      const line: HTMLElement =
        fixture.nativeElement.querySelector('.last-outcome');

      expect(fixture.nativeElement.querySelector('.unit-movement')).toBeNull();
      expect(line.textContent?.trim()).toBe('Movement reset for unit-left-2');
      expect(line.getAttribute('aria-live')).toBe('polite');
    });

    it('is empty before any move or reset', () => {
      expect(text(render(), '.last-outcome')).toBe('');
    });
  });
});
