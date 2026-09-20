import { TestBed } from '@angular/core/testing';
import type { BattleStateResponse, PositionDto } from '../../../api/generated/model';
import { toGridPosition } from '../../utils/coordinate-mapper';
import { EntityLayerComponent } from './entity-layer.component';

const BOARD_HEIGHT = 11;

function buildBattleState(overrides: Partial<BattleStateResponse> = {}): BattleStateResponse {
  return {
    board: { width: 21, height: BOARD_HEIGHT, terrain: [] },
    units: [],
    orbs: [],
    walls: [],
    ...overrides,
  };
}

function render(battleState: BattleStateResponse) {
  const fixture = TestBed.createComponent(EntityLayerComponent);
  fixture.componentRef.setInput('battleState', battleState);
  fixture.detectChanges();
  return fixture;
}

describe('EntityLayerComponent', () => {
  it('renders one cell per footprint offset across units, orbs and walls', () => {
    const battleState = buildBattleState({
      units: [{ id: 'u1', owner: 'LEFT', position: { x: 3, y: 2 }, footprint: [{ x: 0, y: 0 }] }],
      orbs: [{ id: 'o1', owner: 'RIGHT', position: { x: 20, y: 5 }, footprint: [{ x: 0, y: 0 }] }],
      walls: [
        {
          id: 'w1',
          owner: 'LEFT',
          position: { x: 1, y: 0 },
          footprint: [
            { x: 0, y: 0 },
            { x: 0, y: 1 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
          ],
        },
      ],
    });

    const fixture = render(battleState);
    const cells = fixture.nativeElement.querySelectorAll('.entity-cell');

    expect(cells.length).toBe(1 + 1 + 4);
  });

  it('positions a unit cell using CoordinateMapper for its anchor position', () => {
    const battleState = buildBattleState({
      units: [{ id: 'u1', owner: 'LEFT', position: { x: 3, y: 2 }, footprint: [{ x: 0, y: 0 }] }],
    });

    const fixture = render(battleState);
    const cell: HTMLElement = fixture.nativeElement.querySelector(
      '.entity-cell[data-kind="unit"]',
    );
    const expected = toGridPosition({ x: 3, y: 2 }, BOARD_HEIGHT);

    expect(cell.style.gridColumn).toBe(String(expected.gridColumn));
    expect(cell.style.gridRow).toBe(String(expected.gridRow));
  });

  it('tags each entity cell with its owner so LEFT and RIGHT can be styled distinctly', () => {
    const battleState = buildBattleState({
      units: [
        { id: 'u1', owner: 'LEFT', position: { x: 3, y: 2 }, footprint: [{ x: 0, y: 0 }] },
        { id: 'u2', owner: 'RIGHT', position: { x: 17, y: 2 }, footprint: [{ x: 0, y: 0 }] },
      ],
    });

    const fixture = render(battleState);
    const leftUnit: HTMLElement = fixture.nativeElement.querySelector(
      '.entity-cell[data-kind="unit"][data-owner="LEFT"]',
    );
    const rightUnit: HTMLElement = fixture.nativeElement.querySelector(
      '.entity-cell[data-kind="unit"][data-owner="RIGHT"]',
    );

    expect(leftUnit).toBeTruthy();
    expect(rightUnit).toBeTruthy();
  });

  it('expands a non-rectangular wall footprint into exactly its offsets, without assuming a rectangle', () => {
    const lShapeOffsets: PositionDto[] = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 0 },
    ];
    const battleState = buildBattleState({
      walls: [{ id: 'w1', owner: 'RIGHT', position: { x: 18, y: 0 }, footprint: lShapeOffsets }],
    });

    const fixture = render(battleState);
    const cells: HTMLElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.entity-cell[data-kind="wall"]'),
    );

    const actual = cells
      .map((cell) => ({
        gridColumn: Number(cell.style.gridColumn),
        gridRow: Number(cell.style.gridRow),
      }))
      .sort((a, b) => a.gridColumn - b.gridColumn || a.gridRow - b.gridRow);

    const expected = lShapeOffsets
      .map((offset) =>
        toGridPosition({ x: 18 + (offset.x ?? 0), y: 0 + (offset.y ?? 0) }, BOARD_HEIGHT),
      )
      .sort((a, b) => a.gridColumn - b.gridColumn || a.gridRow - b.gridRow);

    expect(actual).toEqual(expected);
  });

  it('renders the demo 2x11 wall footprint as 22 occupied cells', () => {
    const offsets: PositionDto[] = [];
    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < BOARD_HEIGHT; dy++) {
        offsets.push({ x: dx, y: dy });
      }
    }
    const battleState = buildBattleState({
      walls: [{ id: 'wall-left', owner: 'LEFT', position: { x: 1, y: 0 }, footprint: offsets }],
    });

    const fixture = render(battleState);
    const cells = fixture.nativeElement.querySelectorAll('.entity-cell[data-kind="wall"]');

    expect(cells.length).toBe(22);
  });
});
