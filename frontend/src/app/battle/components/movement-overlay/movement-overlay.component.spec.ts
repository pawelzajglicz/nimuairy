import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { Board, Position, Unit } from '../../domain/battle-state';
import type { ReachableCell } from '../../domain/movement';
import { actionPointCost } from '../../domain/movement-cost';
import { FOOTPRINTS, testUnit } from '../../domain/testing/battle-fixtures';
import type { MovementPreview } from '../../movement-preview';
import { toGridPosition } from '../../utils/coordinate-mapper';
import { MovementOverlayComponent } from './movement-overlay.component';

const BOARD: Board = { width: 21, height: 11, terrain: [] };

/** A reachable cell; the overlay only reads its position and AP cost. */
function destination(x: number, y: number, cost: number): ReachableCell {
  const position = { x, y };
  return {
    position,
    cost,
    actionPointCost: actionPointCost(cost),
    via: { from: { x: 2, y: 2 }, to: position, cost },
  };
}

/** (2,2) → (3,2) → (4,3): one orthogonal and one diagonal step. */
const PREVIEW: MovementPreview = {
  destination: { x: 4, y: 3 },
  steps: [
    { from: { x: 2, y: 2 }, to: { x: 3, y: 2 }, cost: 1 },
    { from: { x: 3, y: 2 }, to: { x: 4, y: 3 }, cost: Math.SQRT2 },
  ],
  cost: 3,
};

const TWO_DESTINATIONS = [
  destination(3, 2, 1),
  destination(4, 3, 1 + Math.SQRT2),
];

function render({
  destinations = [],
  preview,
  unit,
}: {
  destinations?: readonly ReachableCell[];
  preview?: MovementPreview;
  unit?: Unit;
} = {}) {
  const fixture = TestBed.createComponent(MovementOverlayComponent);
  fixture.componentRef.setInput('board', BOARD);
  fixture.componentRef.setInput('destinations', destinations);
  fixture.componentRef.setInput('preview', preview);
  fixture.componentRef.setInput('unit', unit);
  fixture.detectChanges();
  return fixture;
}

type Fixture = ReturnType<typeof render>;

function all(fixture: Fixture, selector: string): HTMLElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll(selector));
}

function gridPosition(element: HTMLElement) {
  return {
    gridColumn: Number(element.style.gridColumn),
    gridRow: Number(element.style.gridRow),
  };
}

describe('MovementOverlayComponent', () => {
  describe('movement targets', () => {
    it('renders one native button per destination at its grid position', () => {
      const targets = all(
        render({ destinations: TWO_DESTINATIONS }),
        '.movement-target',
      );

      expect(targets.map((target) => target.tagName)).toEqual([
        'BUTTON',
        'BUTTON',
      ]);
      expect(targets.map(gridPosition)).toEqual([
        toGridPosition({ x: 3, y: 2 }, BOARD.height),
        toGridPosition({ x: 4, y: 3 }, BOARD.height),
      ]);
    });

    it('labels each target with its position and AP cost', () => {
      const targets = all(
        render({ destinations: TWO_DESTINATIONS }),
        '.movement-target',
      );

      expect(
        targets.map((target) => target.getAttribute('aria-label')),
      ).toEqual(['Move to (3, 2), cost 1 AP', 'Move to (4, 3), cost 3 AP']);
    });

    it('reports pointer and keyboard hover, and their end, as the hovered destination', () => {
      const fixture = render({ destinations: TWO_DESTINATIONS });
      const hovered: (Position | undefined)[] = [];
      fixture.componentInstance.destinationHover.subscribe((position) =>
        hovered.push(position),
      );
      const [target] = all(fixture, '.movement-target');

      target.dispatchEvent(new MouseEvent('mouseenter'));
      target.dispatchEvent(new MouseEvent('mouseleave'));
      target.dispatchEvent(new FocusEvent('focus'));
      target.dispatchEvent(new FocusEvent('blur'));

      expect(hovered).toEqual([
        { x: 3, y: 2 },
        undefined,
        { x: 3, y: 2 },
        undefined,
      ]);
    });

    it('emits the destination when a target is clicked', () => {
      const fixture = render({ destinations: TWO_DESTINATIONS });
      const clicked: Position[] = [];
      fixture.componentInstance.destinationClick.subscribe((position) =>
        clicked.push(position),
      );

      all(fixture, '.movement-target')[1].click();

      expect(clicked).toEqual([{ x: 4, y: 3 }]);
    });

    it('renders no targets without destinations', () => {
      expect(all(render(), '.movement-target')).toHaveLength(0);
    });
  });

  describe('path preview', () => {
    it('marks only the previewed target', () => {
      const previewed = all(
        render({ destinations: TWO_DESTINATIONS, preview: PREVIEW }),
        '.movement-target.previewed',
      );

      expect(previewed.map(gridPosition)).toEqual([
        toGridPosition({ x: 4, y: 3 }, BOARD.height),
      ]);
    });

    it('draws the path through the centres of the origin and every entered cell', () => {
      const fixture = render({
        destinations: TWO_DESTINATIONS,
        preview: PREVIEW,
      });
      const svg: SVGElement =
        fixture.nativeElement.querySelector('svg.movement-path');
      const centre = (position: Position) => {
        const { gridColumn, gridRow } = toGridPosition(position, BOARD.height);
        return `${gridColumn - 0.5},${gridRow - 0.5}`;
      };

      expect(svg.getAttribute('viewBox')).toBe('0 0 21 11');
      expect(svg.querySelector('polyline')?.getAttribute('points')).toBe(
        [
          { x: 2, y: 2 },
          { x: 3, y: 2 },
          { x: 4, y: 3 },
        ]
          .map(centre)
          .join(' '),
      );
    });

    it('shows the previewed AP cost at the destination', () => {
      const [label] = all(
        render({ destinations: TWO_DESTINATIONS, preview: PREVIEW }),
        '.preview-cost',
      );

      expect(label.textContent?.trim()).toBe('3');
      expect(gridPosition(label)).toEqual(
        toGridPosition({ x: 4, y: 3 }, BOARD.height),
      );
    });

    it("outlines the moving unit's complete footprint at the previewed destination", () => {
      const cells = all(
        render({
          destinations: TWO_DESTINATIONS,
          preview: PREVIEW,
          unit: testUnit({ footprint: FOOTPRINTS['2x1'] }),
        }),
        '.footprint-preview',
      );

      expect(cells.map(gridPosition)).toEqual([
        toGridPosition({ x: 4, y: 3 }, BOARD.height),
        toGridPosition({ x: 5, y: 3 }, BOARD.height),
      ]);
    });

    it('renders no path, cost or footprint without a preview', () => {
      const fixture = render({
        destinations: TWO_DESTINATIONS,
        unit: testUnit(),
      });

      expect(all(fixture, '.movement-path')).toHaveLength(0);
      expect(all(fixture, '.preview-cost')).toHaveLength(0);
      expect(all(fixture, '.footprint-preview')).toHaveLength(0);
    });
  });

  describe('spent AP', () => {
    it("labels the selected unit's anchor cell with the AP it has spent", () => {
      const [label] = all(
        render({
          unit: testUnit({
            position: { x: 4, y: 3 },
            actionPointBudget: 5,
            remainingActionPoints: 2,
          }),
        }),
        '.spent-label',
      );

      expect(label.textContent?.trim()).toBe('3');
      expect(gridPosition(label)).toEqual(
        toGridPosition({ x: 4, y: 3 }, BOARD.height),
      );
    });

    it('shows zero for a unit that has not moved, and nothing without a unit', () => {
      expect(
        all(
          render({ unit: testUnit() }),
          '.spent-label',
        )[0].textContent?.trim(),
      ).toBe('0');
      expect(all(render(), '.spent-label')).toHaveLength(0);
    });
  });
});
