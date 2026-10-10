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

/** A LEFT unit at (4,3) that has spent 3 of its 5 AP. */
const movedUnit = testUnit({
  id: 'unit-left-2',
  position: { x: 4, y: 3 },
  actionPointBudget: 5,
  remainingActionPoints: 2,
});

describe('MovementInfoComponent', () => {
  describe('selected unit', () => {
    it('shows AP spent, the budget and what remains', () => {
      const fixture = render({ unit: movedUnit });

      expect(text(fixture, '.unit-movement')).toBe(
        'unit-left-2 (LEFT) · AP spent 3 / 5 · remaining 2',
      );
    });

    it('shows nothing spent for a unit that has not moved', () => {
      const fixture = render({ unit: testUnit() });

      expect(text(fixture, '.unit-movement')).toBe(
        'left-1x1 (LEFT) · AP spent 0 / 5 · remaining 5',
      );
    });

    it('shows the previewed path from the unit and its AP cost', () => {
      const fixture = render({
        unit: movedUnit,
        preview: {
          destination: { x: 6, y: 4 },
          steps: [
            { from: { x: 4, y: 3 }, to: { x: 5, y: 3 }, cost: 1 },
            { from: { x: 5, y: 3 }, to: { x: 6, y: 4 }, cost: Math.SQRT2 },
          ],
          cost: 3,
        },
      });

      expect(text(fixture, '.preview')).toBe(
        'Preview: cost 3 AP · (4,3) → (5,3) → (6,4)',
      );
    });

    it('shows no unit details without a selected unit', () => {
      const fixture = render();

      expect(text(fixture, '.no-selection')).toBe('No unit selected.');
      expect(fixture.nativeElement.querySelector('.unit-movement')).toBeNull();
    });
  });

  describe('last outcome', () => {
    it('describes a move with its owner, unit, start, end and AP cost', () => {
      const fixture = render({
        lastOutcome: {
          kind: 'MOVED',
          unitId: 'unit-left-2',
          owner: 'LEFT',
          steps: [
            { from: { x: 5, y: 4 }, to: { x: 6, y: 4 }, cost: 1 },
            { from: { x: 6, y: 4 }, to: { x: 7, y: 5 }, cost: Math.SQRT2 },
          ],
          cost: 3,
        },
      });

      expect(text(fixture, '.last-outcome')).toBe(
        'LEFT moved unit-left-2 (5,4) → (7,5) · cost 3 AP',
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
            type: 'INSUFFICIENT_ACTION_POINTS',
            required: 3,
            available: 2,
          },
        },
        expected:
          'Move rejected: INSUFFICIENT_ACTION_POINTS (needs 3 AP, has 2 AP)',
      },
      {
        outcome: {
          kind: 'REJECTED',
          action: 'MOVE',
          error: { type: 'UNIT_CANNOT_MOVE', unitId: 'unit-right-1' },
        },
        expected: 'Move rejected: UNIT_CANNOT_MOVE',
      },
    ])('describes a rejection: $expected', ({ outcome, expected }) => {
      expect(text(render({ lastOutcome: outcome }), '.last-outcome')).toBe(
        expected,
      );
    });

    it('stays visible without a selected unit, in a polite live region', () => {
      const fixture = render({
        lastOutcome: {
          kind: 'REJECTED',
          action: 'MOVE',
          error: { type: 'UNIT_CANNOT_MOVE', unitId: 'unit-right-1' },
        },
      });
      const line: HTMLElement =
        fixture.nativeElement.querySelector('.last-outcome');

      expect(fixture.nativeElement.querySelector('.unit-movement')).toBeNull();
      expect(line.textContent?.trim()).toBe('Move rejected: UNIT_CANNOT_MOVE');
      expect(line.getAttribute('aria-live')).toBe('polite');
    });

    it('is empty before any move', () => {
      expect(text(render(), '.last-outcome')).toBe('');
    });
  });
});
