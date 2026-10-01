import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { BoardInteraction } from '../../board-interaction';
import type { BattleState, Position } from '../../domain/battle-state';
import type { ReachableCell } from '../../domain/movement';
import { FOOTPRINTS, testUnit } from '../../domain/testing/battle-fixtures';
import type { MovementPreview } from '../../movement-preview';
import { BattleBoardComponent } from './battle-board.component';

function buildBattleState(overrides: Partial<BattleState> = {}): BattleState {
  return {
    board: { width: 21, height: 11, terrain: [] },
    units: [],
    orbs: [],
    walls: [],
    currentPlayer: 'LEFT',
    ...overrides,
  };
}

function render(battleState: BattleState) {
  const fixture = TestBed.createComponent(BattleBoardComponent);
  fixture.componentRef.setInput('battleState', battleState);
  fixture.detectChanges();
  return fixture;
}

function captureInteraction(
  fixture: ReturnType<typeof render>,
): BoardInteraction[] {
  const emitted: BoardInteraction[] = [];
  fixture.componentInstance.interaction.subscribe((interaction) =>
    emitted.push(interaction),
  );
  return emitted;
}

function terrainAt(...positions: [number, number][]) {
  return {
    width: 21,
    height: 11,
    terrain: positions.map(([x, y]) => ({
      position: { x, y },
      type: 'PLAIN' as const,
    })),
  };
}

/** The terrain button for the n-th terrain cell, or null when that cell is occupied. */
function terrainButton(
  fixture: ReturnType<typeof render>,
  index: number,
): HTMLElement | null {
  const cells: HTMLElement[] = Array.from(
    fixture.nativeElement.querySelectorAll('app-cell'),
  );
  return cells[index].querySelector('button');
}

describe('BattleBoardComponent', () => {
  it('emits a UnitClicked interaction with the correct unitId when a unit is clicked', () => {
    const fixture = render(
      buildBattleState({
        units: [
          testUnit({
            id: 'unit-left-1',
            owner: 'LEFT',
            position: { x: 3, y: 2 },
            footprint: [{ x: 0, y: 0 }],
          }),
        ],
      }),
    );
    const emitted = captureInteraction(fixture);

    const unitCell: HTMLElement = fixture.nativeElement.querySelector(
      '.entity-cell[data-kind="unit"]',
    );
    unitCell.click();

    expect(emitted).toEqual([{ kind: 'unit-clicked', unitId: 'unit-left-1' }]);
  });

  it('emits a UnitClicked interaction for an enemy unit, without rejecting it at this layer', () => {
    const fixture = render(
      buildBattleState({
        units: [
          testUnit({
            id: 'unit-right-1',
            owner: 'RIGHT',
            position: { x: 17, y: 2 },
            footprint: [{ x: 0, y: 0 }],
          }),
        ],
      }),
    );
    const emitted = captureInteraction(fixture);

    const unitCell: HTMLElement = fixture.nativeElement.querySelector(
      '.entity-cell[data-kind="unit"]',
    );
    unitCell.click();

    expect(emitted).toEqual([{ kind: 'unit-clicked', unitId: 'unit-right-1' }]);
  });

  it('emits a CellClicked interaction with the correct position when a plain cell is clicked', () => {
    const fixture = render(
      buildBattleState({
        board: {
          width: 21,
          height: 11,
          terrain: [{ position: { x: 5, y: 5 }, type: 'PLAIN' }],
        },
      }),
    );
    const emitted = captureInteraction(fixture);

    const cell: HTMLElement = fixture.nativeElement.querySelector('.cell');
    cell.click();

    expect(emitted).toEqual([
      { kind: 'cell-clicked', position: { x: 5, y: 5 } },
    ]);
  });

  describe('cells covered by entities', () => {
    it('leaves the unit as the only interactive target on a unit-occupied cell', () => {
      const fixture = render(
        buildBattleState({
          board: terrainAt([3, 2], [4, 2]),
          units: [
            testUnit({
              id: 'unit-left-1',
              owner: 'LEFT',
              position: { x: 3, y: 2 },
              footprint: [{ x: 0, y: 0 }],
            }),
          ],
        }),
      );
      const emitted = captureInteraction(fixture);

      expect(terrainButton(fixture, 0)).toBeNull();
      expect(terrainButton(fixture, 1)).not.toBeNull();

      const unitButton: HTMLElement = fixture.nativeElement.querySelector(
        'button.entity-cell[data-kind="unit"]',
      );
      unitButton.click();
      terrainButton(fixture, 1)?.click();

      expect(emitted).toEqual([
        { kind: 'unit-clicked', unitId: 'unit-left-1' },
        { kind: 'cell-clicked', position: { x: 4, y: 2 } },
      ]);
    });

    it('keeps the terrain under a wall footprint clickable, emitting CellClicked (wall itself stays inert)', () => {
      const fixture = render(
        buildBattleState({
          board: terrainAt([1, 0], [2, 0], [1, 1], [2, 1]),
          walls: [
            {
              id: 'wall-left',
              owner: 'LEFT',
              health: 100,
              position: { x: 1, y: 0 },
              footprint: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 0, y: 1 },
              ],
            },
          ],
        }),
      );
      const emitted = captureInteraction(fixture);

      for (let i = 0; i < 4; i++) {
        expect(terrainButton(fixture, i)).not.toBeNull();
      }
      expect(
        fixture.nativeElement.querySelector(
          'button.entity-cell[data-kind="wall"]',
        ),
      ).toBeNull();

      terrainButton(fixture, 1)?.click();

      expect(emitted).toEqual([
        { kind: 'cell-clicked', position: { x: 2, y: 0 } },
      ]);
    });

    it('keeps the terrain under an orb clickable, emitting CellClicked (orb itself stays inert)', () => {
      const fixture = render(
        buildBattleState({
          board: terrainAt([20, 5], [19, 5]),
          orbs: [
            {
              id: 'orb-right',
              owner: 'RIGHT',
              health: 100,
              position: { x: 20, y: 5 },
              footprint: [{ x: 0, y: 0 }],
            },
          ],
        }),
      );
      const emitted = captureInteraction(fixture);

      expect(terrainButton(fixture, 0)).not.toBeNull();
      expect(
        fixture.nativeElement.querySelector(
          'button.entity-cell[data-kind="orb"]',
        ),
      ).toBeNull();

      terrainButton(fixture, 0)?.click();

      expect(emitted).toEqual([
        { kind: 'cell-clicked', position: { x: 20, y: 5 } },
      ]);
    });
  });

  describe('movement destinations', () => {
    // A selected 2×1 unit at (5,4) covers (5,4) and (6,4).
    const wideUnit = testUnit({
      id: 'wide',
      position: { x: 5, y: 4 },
      footprint: FOOTPRINTS['2x1'],
    });

    function destination(x: number, y: number): ReachableCell {
      const position = { x, y };
      return {
        position,
        cost: 1,
        via: { from: { x: 5, y: 4 }, to: position, cost: 1 },
      };
    }

    function renderWithDestinations(
      destinations: readonly ReachableCell[],
      preview?: MovementPreview,
    ) {
      const fixture = TestBed.createComponent(BattleBoardComponent);
      fixture.componentRef.setInput(
        'battleState',
        buildBattleState({
          board: terrainAt([4, 4], [5, 4], [6, 4], [7, 4]),
          units: [wideUnit],
        }),
      );
      fixture.componentRef.setInput('selectedUnitId', 'wide');
      fixture.componentRef.setInput('reachableDestinations', destinations);
      fixture.componentRef.setInput('movementPreview', preview);
      fixture.detectChanges();
      return fixture;
    }

    function target(
      fixture: ReturnType<typeof render>,
      label: string,
    ): HTMLElement {
      return fixture.nativeElement.querySelector(
        `button.movement-target[aria-label^="Move to ${label}"]`,
      );
    }

    it('emits a DestinationClicked interaction when a movement target is clicked', () => {
      const fixture = renderWithDestinations([destination(4, 4)]);
      const emitted = captureInteraction(fixture);

      target(fixture, '(4, 4)').click();

      expect(emitted).toEqual([
        { kind: 'destination-clicked', position: { x: 4, y: 4 } },
      ]);
    });

    it('forwards hovering a movement target, and leaving it', () => {
      const fixture = renderWithDestinations([destination(4, 4)]);
      const hovered: (Position | undefined)[] = [];
      fixture.componentInstance.destinationHover.subscribe((position) =>
        hovered.push(position),
      );

      target(fixture, '(4, 4)').dispatchEvent(new MouseEvent('mouseenter'));
      target(fixture, '(4, 4)').dispatchEvent(new MouseEvent('mouseleave'));

      expect(hovered).toEqual([{ x: 4, y: 4 }, undefined]);
    });

    it('still emits CellClicked for a terrain cell that is not a destination', () => {
      const fixture = renderWithDestinations([destination(4, 4)]);
      const emitted = captureInteraction(fixture);

      terrainButton(fixture, 3)?.click();

      expect(emitted).toEqual([
        { kind: 'cell-clicked', position: { x: 7, y: 4 } },
      ]);
    });

    it("offers a target for a destination overlapping the selected unit's own cells", () => {
      const fixture = renderWithDestinations([destination(6, 4)]);
      const emitted = captureInteraction(fixture);

      // The terrain at (6,4) is inert under the unit; the movement target is not.
      expect(terrainButton(fixture, 2)).toBeNull();
      target(fixture, '(6, 4)').click();

      expect(emitted).toEqual([
        { kind: 'destination-clicked', position: { x: 6, y: 4 } },
      ]);
    });

    it("outlines the selected unit's footprint at the previewed destination", () => {
      const fixture = renderWithDestinations([destination(6, 4)], {
        destination: { x: 6, y: 4 },
        steps: [{ from: { x: 5, y: 4 }, to: { x: 6, y: 4 }, cost: 1 }],
        cost: 1,
      });

      expect(
        fixture.nativeElement.querySelectorAll('.footprint-preview'),
      ).toHaveLength(2);
    });
  });
});
