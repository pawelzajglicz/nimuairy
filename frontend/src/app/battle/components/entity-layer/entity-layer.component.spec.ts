import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { BattleState, Position } from '../../domain/battle-state';
import type { AttackTarget } from '../../domain/combat';
import {
  FOOTPRINTS,
  testOrb,
  testUnit,
  testWall,
} from '../../domain/testing/battle-fixtures';
import { InteractionMode } from '../../interaction-mode';
import { toGridPosition } from '../../utils/coordinate-mapper';
import { EntityLayerComponent } from './entity-layer.component';

const BOARD_HEIGHT = 11;

function buildBattleState(overrides: Partial<BattleState> = {}): BattleState {
  return {
    board: { width: 21, height: BOARD_HEIGHT, terrain: [] },
    units: [],
    orbs: [],
    walls: [],
    currentPlayer: 'LEFT',
    activeUnitId: undefined,
    ...overrides,
  };
}

function render(
  battleState: BattleState,
  selectedUnitId?: string,
  interactionMode: InteractionMode = InteractionMode.MOVE,
) {
  const fixture = TestBed.createComponent(EntityLayerComponent);
  fixture.componentRef.setInput('battleState', battleState);
  fixture.componentRef.setInput('selectedUnitId', selectedUnitId);
  fixture.componentRef.setInput('interactionMode', interactionMode);
  fixture.detectChanges();
  return fixture;
}

function selectedUnitCells(fixture: ReturnType<typeof render>): HTMLElement[] {
  return Array.from(
    fixture.nativeElement.querySelectorAll(
      '.entity-cell[data-kind="unit"].selected',
    ),
  );
}

describe('EntityLayerComponent', () => {
  it('renders one cell per footprint offset across units, orbs and walls', () => {
    const battleState = buildBattleState({
      units: [
        testUnit({
          id: 'u1',
          owner: 'LEFT',
          position: { x: 3, y: 2 },
          footprint: [{ x: 0, y: 0 }],
        }),
      ],
      orbs: [
        {
          id: 'o1',
          owner: 'RIGHT',
          health: 100,
          maxHealth: 100,
          defense: 0,
          position: { x: 20, y: 5 },
          footprint: [{ x: 0, y: 0 }],
        },
      ],
      walls: [
        {
          id: 'w1',
          owner: 'LEFT',
          health: 100,
          maxHealth: 100,
          defense: 100,
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
      units: [
        testUnit({
          id: 'u1',
          owner: 'LEFT',
          position: { x: 3, y: 2 },
          footprint: [{ x: 0, y: 0 }],
        }),
      ],
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
        testUnit({
          id: 'u1',
          owner: 'LEFT',
          position: { x: 3, y: 2 },
          footprint: [{ x: 0, y: 0 }],
        }),
        testUnit({
          id: 'u2',
          owner: 'RIGHT',
          position: { x: 17, y: 2 },
          footprint: [{ x: 0, y: 0 }],
        }),
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
    const lShapeOffsets: Position[] = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 0 },
    ];
    const battleState = buildBattleState({
      walls: [
        {
          id: 'w1',
          owner: 'RIGHT',
          health: 100,
          maxHealth: 100,
          defense: 100,
          position: { x: 18, y: 0 },
          footprint: lShapeOffsets,
        },
      ],
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
        toGridPosition({ x: 18 + offset.x, y: offset.y }, BOARD_HEIGHT),
      )
      .sort((a, b) => a.gridColumn - b.gridColumn || a.gridRow - b.gridRow);

    expect(actual).toEqual(expected);
  });

  it('renders the demo 2x11 wall footprint as 22 occupied cells', () => {
    const offsets: Position[] = [];
    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < BOARD_HEIGHT; dy++) {
        offsets.push({ x: dx, y: dy });
      }
    }
    const battleState = buildBattleState({
      walls: [
        {
          id: 'wall-left',
          owner: 'LEFT',
          health: 100,
          maxHealth: 100,
          defense: 100,
          position: { x: 1, y: 0 },
          footprint: offsets,
        },
      ],
    });

    const fixture = render(battleState);
    const cells = fixture.nativeElement.querySelectorAll(
      '.entity-cell[data-kind="wall"]',
    );

    expect(cells.length).toBe(22);
  });

  describe('keyboard operability', () => {
    it('renders a unit as a native button, so it is keyboard operable by construction', () => {
      const battleState = buildBattleState({
        units: [
          testUnit({
            id: 'u1',
            owner: 'LEFT',
            position: { x: 3, y: 2 },
            footprint: [{ x: 0, y: 0 }],
          }),
        ],
      });

      const fixture = render(battleState);
      const unitCell: HTMLElement = fixture.nativeElement.querySelector(
        '.entity-cell[data-kind="unit"]',
      );

      expect(unitCell.tagName).toBe('BUTTON');
    });

    it('emits unitClick with the same id regardless of whether activation came from a click', () => {
      const battleState = buildBattleState({
        units: [
          testUnit({
            id: 'u1',
            owner: 'LEFT',
            position: { x: 3, y: 2 },
            footprint: [{ x: 0, y: 0 }],
          }),
        ],
      });

      const fixture = render(battleState);
      const emitted: string[] = [];
      fixture.componentInstance.unitClick.subscribe((unitId) =>
        emitted.push(unitId),
      );

      const unitCell: HTMLElement = fixture.nativeElement.querySelector(
        '.entity-cell[data-kind="unit"]',
      );
      unitCell.click();

      expect(emitted).toEqual(['u1']);
    });

    it('does not make wall or orb cells keyboard-focusable', () => {
      const battleState = buildBattleState({
        orbs: [
          {
            id: 'o1',
            owner: 'RIGHT',
            health: 100,
            maxHealth: 100,
            defense: 0,
            position: { x: 20, y: 5 },
            footprint: [{ x: 0, y: 0 }],
          },
        ],
        walls: [
          {
            id: 'w1',
            owner: 'LEFT',
            health: 100,
            maxHealth: 100,
            defense: 100,
            position: { x: 1, y: 0 },
            footprint: [{ x: 0, y: 0 }],
          },
        ],
      });

      const fixture = render(battleState);
      const orbCell: HTMLElement = fixture.nativeElement.querySelector(
        '.entity-cell[data-kind="orb"]',
      );
      const wallCell: HTMLElement = fixture.nativeElement.querySelector(
        '.entity-cell[data-kind="wall"]',
      );

      expect(orbCell.tagName).not.toBe('BUTTON');
      expect(orbCell.hasAttribute('tabindex')).toBe(false);
      expect(wallCell.tagName).not.toBe('BUTTON');
      expect(wallCell.hasAttribute('tabindex')).toBe(false);
    });
  });

  describe('selected unit', () => {
    const twoUnits = buildBattleState({
      units: [
        testUnit({
          id: 'unit-left-1',
          owner: 'LEFT',
          position: { x: 3, y: 2 },
          footprint: [{ x: 0, y: 0 }],
        }),
        testUnit({
          id: 'unit-right-1',
          owner: 'RIGHT',
          position: { x: 17, y: 2 },
          footprint: [{ x: 0, y: 0 }],
        }),
      ],
    });

    /** Per-unit visual state keyed by owner, e.g. { LEFT: 'selected', RIGHT: 'dimmed' }. */
    function unitStates(fixture: ReturnType<typeof render>) {
      const units: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll(
          '.entity-cell[data-kind="unit"]',
        ),
      );
      return Object.fromEntries(
        units.map((u) => [
          u.getAttribute('data-owner'),
          u.classList.contains('selected')
            ? 'selected'
            : u.classList.contains('dimmed')
              ? 'dimmed'
              : 'normal',
        ]),
      );
    }

    it('shows every unit normally when there is no selection', () => {
      const fixture = render(twoUnits, undefined);

      expect(unitStates(fixture)).toEqual({ LEFT: 'normal', RIGHT: 'normal' });
    });

    it('marks the selected friendly unit and dims the others', () => {
      const fixture = render(twoUnits, 'unit-left-1');

      expect(unitStates(fixture)).toEqual({
        LEFT: 'selected',
        RIGHT: 'dimmed',
      });
    });

    it('treats a selected enemy unit exactly the same way', () => {
      const fixture = render(twoUnits, 'unit-right-1');

      expect(unitStates(fixture)).toEqual({
        LEFT: 'dimmed',
        RIGHT: 'selected',
      });
    });

    it('moves the mark and the dimming when the selection changes, and restores everything when cleared', () => {
      const fixture = render(twoUnits, 'unit-left-1');

      fixture.componentRef.setInput('selectedUnitId', 'unit-right-1');
      fixture.detectChanges();
      expect(unitStates(fixture)).toEqual({
        LEFT: 'dimmed',
        RIGHT: 'selected',
      });

      fixture.componentRef.setInput('selectedUnitId', undefined);
      fixture.detectChanges();
      expect(unitStates(fixture)).toEqual({ LEFT: 'normal', RIGHT: 'normal' });
    });

    it('marks every footprint cell of a multi-cell selected unit and dims none of them', () => {
      const battleState = buildBattleState({
        units: [
          testUnit({
            id: 'big-unit',
            owner: 'LEFT',
            position: { x: 5, y: 5 },
            footprint: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0, y: 1 },
            ],
          }),
          testUnit({
            id: 'other',
            owner: 'RIGHT',
            position: { x: 17, y: 2 },
            footprint: [{ x: 0, y: 0 }],
          }),
        ],
      });

      const fixture = render(battleState, 'big-unit');

      expect(selectedUnitCells(fixture)).toHaveLength(3);
      expect(
        fixture.nativeElement.querySelectorAll('.entity-cell.selected.dimmed'),
      ).toHaveLength(0);
      expect(
        fixture.nativeElement.querySelectorAll('.entity-cell.dimmed'),
      ).toHaveLength(1);
    });

    it('does not expose aria-pressed, since re-clicking a selected unit does not toggle it off', () => {
      const fixture = render(twoUnits, 'unit-left-1');

      expect(fixture.nativeElement.querySelector('[aria-pressed]')).toBeNull();
    });
  });

  describe('selection mode visual', () => {
    const twoUnits = buildBattleState({
      units: [
        testUnit({
          id: 'unit-left-1',
          owner: 'LEFT',
          position: { x: 3, y: 2 },
          footprint: [{ x: 0, y: 0 }],
        }),
        testUnit({
          id: 'unit-right-1',
          owner: 'RIGHT',
          position: { x: 17, y: 2 },
          footprint: [{ x: 0, y: 0 }],
        }),
      ],
    });

    function selectionModes(fixture: ReturnType<typeof render>) {
      const units: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll(
          '.entity-cell[data-kind="unit"]',
        ),
      );
      return Object.fromEntries(
        units.map((u) => [
          u.getAttribute('data-owner'),
          u.getAttribute('data-selection-mode'),
        ]),
      );
    }

    it('tags only the selected unit with the current mode', () => {
      expect(selectionModes(render(twoUnits, undefined))).toEqual({
        LEFT: null,
        RIGHT: null,
      });
      expect(
        selectionModes(render(twoUnits, 'unit-left-1', InteractionMode.MOVE)),
      ).toEqual({ LEFT: 'MOVE', RIGHT: null });
      expect(
        selectionModes(render(twoUnits, 'unit-left-1', InteractionMode.ATTACK)),
      ).toEqual({ LEFT: 'ATTACK', RIGHT: null });
    });

    it('applies the same mode treatment to a selected enemy unit', () => {
      expect(
        selectionModes(
          render(twoUnits, 'unit-right-1', InteractionMode.ATTACK),
        ),
      ).toEqual({ LEFT: null, RIGHT: 'ATTACK' });
    });

    it('switches the visual when the mode changes, keeping selection and dimming', () => {
      const fixture = render(twoUnits, 'unit-left-1', InteractionMode.MOVE);

      fixture.componentRef.setInput('interactionMode', InteractionMode.ATTACK);
      fixture.detectChanges();

      expect(selectionModes(fixture)).toEqual({ LEFT: 'ATTACK', RIGHT: null });
      expect(selectedUnitCells(fixture)).toHaveLength(1);
      expect(
        fixture.nativeElement.querySelectorAll('.entity-cell.dimmed'),
      ).toHaveLength(1);

      fixture.componentRef.setInput('interactionMode', InteractionMode.MOVE);
      fixture.detectChanges();
      expect(selectionModes(fixture)).toEqual({ LEFT: 'MOVE', RIGHT: null });
    });

    it('tags every footprint cell of a multi-cell selected unit with the mode', () => {
      const battleState = buildBattleState({
        units: [
          testUnit({
            id: 'big-unit',
            owner: 'LEFT',
            position: { x: 5, y: 5 },
            footprint: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0, y: 1 },
            ],
          }),
        ],
      });

      const fixture = render(battleState, 'big-unit', InteractionMode.ATTACK);

      expect(
        fixture.nativeElement.querySelectorAll(
          '.entity-cell.selected[data-selection-mode="ATTACK"]',
        ),
      ).toHaveLength(3);
    });
  });

  describe('attack targets', () => {
    const attacker = testUnit({ id: 'left-1', position: { x: 2, y: 2 } });
    const friend = testUnit({ id: 'left-2', position: { x: 2, y: 3 } });
    const enemy = testUnit({
      id: 'right-1',
      owner: 'RIGHT',
      position: { x: 3, y: 2 },
    });
    const state = buildBattleState({
      units: [attacker, friend, enemy],
      walls: [testWall({ id: 'shared', position: { x: 1, y: 1 } })],
      orbs: [testOrb({ id: 'shared', position: { x: 0, y: 2 } })],
    });

    function renderTargets(
      battleState: BattleState,
      {
        targets = [],
        attacked,
        mode = InteractionMode.ATTACK,
      }: {
        targets?: readonly AttackTarget[];
        attacked?: AttackTarget;
        mode?: InteractionMode;
      } = {},
    ) {
      const fixture = TestBed.createComponent(EntityLayerComponent);
      fixture.componentRef.setInput('battleState', battleState);
      fixture.componentRef.setInput('selectedUnitId', 'left-1');
      fixture.componentRef.setInput('interactionMode', mode);
      fixture.componentRef.setInput('attackTargets', targets);
      fixture.componentRef.setInput('attackedTarget', attacked);
      fixture.detectChanges();
      return fixture;
    }

    function cellsOf(
      fixture: ReturnType<typeof renderTargets>,
      kind: string,
    ): HTMLElement[] {
      return Array.from(
        fixture.nativeElement.querySelectorAll(
          `.entity-cell[data-kind="${kind}"]`,
        ),
      );
    }

    function capture(fixture: ReturnType<typeof renderTargets>) {
      const attacks: AttackTarget[] = [];
      const units: string[] = [];
      fixture.componentInstance.attackTargetClick.subscribe((target) =>
        attacks.push(target),
      );
      fixture.componentInstance.unitClick.subscribe((id) => units.push(id));
      return { attacks, units };
    }

    it('marks only the given targets, and leaves walls and orbs inert otherwise', () => {
      const fixture = renderTargets(state, {
        targets: [{ kind: 'UNIT', id: 'right-1' }],
      });
      const targets: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('.attack-target'),
      );

      expect(targets.map((cell) => cell.getAttribute('data-kind'))).toEqual([
        'unit',
      ]);
      for (const cell of [
        ...cellsOf(fixture, 'wall'),
        ...cellsOf(fixture, 'orb'),
      ]) {
        expect(cell.tagName).toBe('DIV');
      }
    });

    it('does not dim an attack target while a unit is selected', () => {
      const fixture = renderTargets(state, {
        targets: [{ kind: 'UNIT', id: 'right-1' }],
      });
      const [friendCell, enemyCell] = cellsOf(fixture, 'unit').slice(1);

      expect(friendCell.classList).toContain('dimmed');
      expect(enemyCell.classList).not.toContain('dimmed');
    });

    it('emits an attack, not a selection, when a target unit is clicked', () => {
      const fixture = renderTargets(state, {
        targets: [{ kind: 'UNIT', id: 'right-1' }],
      });
      const emitted = capture(fixture);

      cellsOf(fixture, 'unit')[2].click();

      expect(emitted.attacks).toEqual([{ kind: 'UNIT', id: 'right-1' }]);
      expect(emitted.units).toEqual([]);
    });

    it('still selects a unit that is not a target', () => {
      const fixture = renderTargets(state, {
        targets: [{ kind: 'UNIT', id: 'right-1' }],
      });
      const emitted = capture(fixture);

      cellsOf(fixture, 'unit')[1].click();

      expect(emitted.units).toEqual(['left-2']);
      expect(emitted.attacks).toEqual([]);
    });

    it('turns a wall or orb target into a button that emits its own kind', () => {
      const fixture = renderTargets(state, {
        targets: [
          { kind: 'WALL', id: 'shared' },
          { kind: 'ORB', id: 'shared' },
        ],
      });
      const emitted = capture(fixture);
      const [wallCell] = cellsOf(fixture, 'wall');
      const [orbCell] = cellsOf(fixture, 'orb');

      expect(wallCell.tagName).toBe('BUTTON');
      expect(orbCell.tagName).toBe('BUTTON');
      wallCell.click();
      orbCell.click();

      expect(emitted.attacks).toEqual([
        { kind: 'WALL', id: 'shared' },
        { kind: 'ORB', id: 'shared' },
      ]);
    });

    it('tells apart a wall and an orb that share an id', () => {
      const fixture = renderTargets(state, {
        targets: [{ kind: 'ORB', id: 'shared' }],
        attacked: { kind: 'ORB', id: 'shared' },
      });

      expect(cellsOf(fixture, 'orb')[0].classList).toContain('attack-target');
      expect(cellsOf(fixture, 'orb')[0].classList).toContain('attacked');
      for (const cell of cellsOf(fixture, 'wall')) {
        expect(cell.classList).not.toContain('attack-target');
        expect(cell.classList).not.toContain('attacked');
      }
    });

    it("labels a target with what a click does and the target's current and maximum HP", () => {
      const fixture = renderTargets(state, {
        targets: [
          { kind: 'UNIT', id: 'right-1' },
          { kind: 'WALL', id: 'shared' },
        ],
      });

      expect(cellsOf(fixture, 'unit')[2].getAttribute('aria-label')).toBe(
        'Attack RIGHT unit right-1, 10/10 HP',
      );
      expect(cellsOf(fixture, 'wall')[0].getAttribute('aria-label')).toBe(
        'Attack RIGHT wall shared, 30/30 HP',
      );
      expect(cellsOf(fixture, 'unit')[1].getAttribute('aria-label')).toBe(
        'LEFT unit, 10/10 HP',
      );
    });

    it('highlights every footprint cell of the attacked target, and nothing else', () => {
      const fixture = renderTargets(state, {
        attacked: { kind: 'WALL', id: 'shared' },
        mode: InteractionMode.MOVE,
      });
      const highlighted: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('.attacked'),
      );

      // testWall is a 1×3 column.
      expect(highlighted).toHaveLength(3);
      expect(
        highlighted.every((cell) => cell.getAttribute('data-kind') === 'wall'),
      ).toBe(true);
    });

    it('shows an orb at 0 HP as destroyed, and one with HP left as intact', () => {
      const fixture = renderTargets(
        buildBattleState({
          orbs: [
            testOrb({ id: 'destroyed', health: 0, position: { x: 0, y: 0 } }),
            testOrb({ id: 'intact', health: 1, position: { x: 5, y: 0 } }),
          ],
        }),
      );
      const [destroyed, intact] = cellsOf(fixture, 'orb');

      expect(destroyed.getAttribute('data-destroyed')).toBe('true');
      expect(intact.hasAttribute('data-destroyed')).toBe(false);
    });
  });

  describe('health labels', () => {
    function labels(fixture: ReturnType<typeof render>): HTMLElement[] {
      return Array.from(
        fixture.nativeElement.querySelectorAll('.health-label'),
      );
    }

    /** The visible text; a label may also carry screen-reader-only context. */
    function shown(fixture: ReturnType<typeof render>): (string | undefined)[] {
      return labels(fixture).map((label) =>
        label.querySelector('.health-label-value')?.textContent?.trim(),
      );
    }

    function placedAt(label: HTMLElement): Position {
      return {
        x: Number(label.style.gridColumn) - 1,
        y: BOARD_HEIGHT - Number(label.style.gridRow),
      };
    }

    const left = testUnit({ id: 'left-1' });
    const right = testUnit({
      id: 'right-1',
      owner: 'RIGHT',
      position: { x: 3, y: 2 },
      health: 25,
      maxHealth: 40,
    });
    const wall = testWall({ position: { x: 8, y: 0 }, health: 12 });
    const orb = testOrb({ position: { x: 12, y: 0 } });

    it("shows each unit's, wall's and orb's own current and maximum HP", () => {
      const fixture = render(
        buildBattleState({ units: [left, right], walls: [wall], orbs: [orb] }),
      );

      // Walls, then orbs, then units, like the cells.
      expect(shown(fixture)).toEqual(['12/30', '20/20', '10/10', '25/40']);
    });

    it('labels a multi-cell entity once, on its bottom-left occupied cell', () => {
      const square = testUnit({
        position: { x: 5, y: 4 },
        footprint: FOOTPRINTS['2x2'],
      });
      // The anchor (0,0) is not part of this footprint.
      const offAnchor = testUnit({
        id: 'off-anchor',
        position: { x: 10, y: 1 },
        footprint: [
          { x: 1, y: 2 },
          { x: 0, y: 2 },
          { x: 0, y: 3 },
        ],
      });

      const placed = labels(
        render(buildBattleState({ units: [square, offAnchor], walls: [wall] })),
      ).map(placedAt);

      // testWall is a 1×3 column standing on (8,0).
      expect(placed).toEqual([
        { x: 8, y: 0 },
        { x: 5, y: 4 },
        { x: 10, y: 3 },
      ]);
    });

    it('follows the new state: current HP changes, the maximum stays, and removed units and walls lose their labels', () => {
      const fixture = render(
        buildBattleState({ units: [left, right], walls: [wall] }),
      );

      fixture.componentRef.setInput(
        'battleState',
        buildBattleState({ units: [{ ...left, health: 3 }] }),
      );
      fixture.detectChanges();

      expect(shown(fixture)).toEqual(['3/10']);
    });

    it('skips an entity that covers no cell instead of breaking the other labels', () => {
      const fixture = render(
        buildBattleState({
          units: [left],
          walls: [testWall({ id: 'no-cells', footprint: [] })],
        }),
      );

      expect(shown(fixture)).toEqual(['10/10']);
    });

    it('keeps the label of an orb at 0 HP, which stays on the board', () => {
      const fixture = render(
        buildBattleState({ orbs: [testOrb({ health: 0 })] }),
      );

      expect(shown(fixture)).toEqual(['0/20']);
    });

    it('stays with its entity while selected, targeted and highlighted as attacked', () => {
      const fixture = TestBed.createComponent(EntityLayerComponent);
      fixture.componentRef.setInput(
        'battleState',
        buildBattleState({ units: [left, right], walls: [wall] }),
      );
      fixture.componentRef.setInput('selectedUnitId', 'left-1');
      fixture.componentRef.setInput('interactionMode', InteractionMode.ATTACK);
      fixture.componentRef.setInput('attackTargets', [
        { kind: 'UNIT', id: 'right-1' },
        { kind: 'WALL', id: 'right-wall' },
      ]);
      fixture.componentRef.setInput('attackedTarget', {
        kind: 'UNIT',
        id: 'right-1',
      });
      fixture.detectChanges();

      expect(labels(fixture).map(placedAt)).toEqual([
        wall.position,
        left.position,
        right.position,
      ]);
    });

    it("is display only, and leaves a unit's HP to its buttons' names", () => {
      const fixture = render(buildBattleState({ units: [left] }));
      const [label] = labels(fixture);
      const unit: HTMLElement = fixture.nativeElement.querySelector(
        'button.entity-cell[data-kind="unit"]',
      );

      expect(label.tagName).toBe('SPAN');
      expect(label.hasAttribute('tabindex')).toBe(false);
      expect(label.querySelector('button, [tabindex]')).toBeNull();
      expect(label.getAttribute('aria-hidden')).toBe('true');
      expect(unit.getAttribute('aria-label')).toBe('LEFT unit, 10/10 HP');
    });

    it('keeps the HP of a wall or orb that is not a target readable for assistive technology', () => {
      const fixture = render(buildBattleState({ walls: [wall], orbs: [orb] }));
      const [wallLabel, orbLabel] = labels(fixture);

      expect(wallLabel.hasAttribute('aria-hidden')).toBe(false);
      expect(wallLabel.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'RIGHT wall right-wall, HP 12/30',
      );
      expect(orbLabel.textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'RIGHT orb right-orb, HP 20/20',
      );
    });

    it("hides a target wall's label from assistive technology, as its buttons name the HP", () => {
      const fixture = TestBed.createComponent(EntityLayerComponent);
      fixture.componentRef.setInput(
        'battleState',
        buildBattleState({ walls: [wall] }),
      );
      fixture.componentRef.setInput('attackTargets', [
        { kind: 'WALL', id: 'right-wall' },
      ]);
      fixture.detectChanges();
      const [label] = labels(fixture);
      const wallButton: HTMLElement = fixture.nativeElement.querySelector(
        'button.entity-cell[data-kind="wall"]',
      );

      expect(label.getAttribute('aria-hidden')).toBe('true');
      expect(label.querySelector('.health-label-context')).toBeNull();
      expect(wallButton.getAttribute('aria-label')).toBe(
        'Attack RIGHT wall right-wall, 12/30 HP',
      );
    });
  });
});
