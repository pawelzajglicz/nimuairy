import { Component, computed, input, output } from '@angular/core';
import type {
  BattleState,
  PlayerSide,
  Position,
} from '../../domain/battle-state';
import type { AttackTarget, AttackTargetKind } from '../../domain/combat';
import { occupiedCells } from '../../domain/geometry';
import { InteractionMode } from '../../interaction-mode';
import { toGridPosition } from '../../utils/coordinate-mapper';

type EntityKind = 'unit' | 'orb' | 'wall';

/** Typed as a Record so that a new EntityKind does not compile without one. */
const TARGET_KIND: Record<EntityKind, AttackTargetKind> = {
  unit: 'UNIT',
  wall: 'WALL',
  orb: 'ORB',
};

interface RenderedEntityCell {
  key: string;
  id: string;
  kind: EntityKind;
  owner: PlayerSide;
  /** See targetKey: identifies the entity among all collections. */
  targetKey: string;
  health: number;
  maxHealth: number;
  /**
   * At 0 HP. Which kinds stay in the state when destroyed is the domain's
   * call; whatever it keeps is drawn as destroyed.
   */
  destroyed: boolean;
  gridColumn: number;
  gridRow: number;
}

interface RenderedHealthLabel {
  key: string;
  id: string;
  kind: EntityKind;
  owner: PlayerSide;
  targetKey: string;
  /** current/max, for example 350/500. */
  text: string;
  gridColumn: number;
  gridRow: number;
}

const NO_TARGETS: readonly AttackTarget[] = [];

/**
 * Kind and id together, so equal ids in different collections never mix.
 * The kind never contains ':', so the key is unambiguous.
 */
function targetKey({ kind, id }: AttackTarget): string {
  return `${kind}:${id}`;
}

@Component({
  selector: 'app-entity-layer',
  imports: [],
  templateUrl: './entity-layer.component.html',
  styleUrl: './entity-layer.component.css',
})
export class EntityLayerComponent {
  readonly battleState = input<BattleState>();
  readonly selectedUnitId = input<string>();
  readonly interactionMode = input<InteractionMode>(InteractionMode.MOVE);
  /** The selected unit's legal attack targets, as the domain reports them. */
  readonly attackTargets = input<readonly AttackTarget[]>(NO_TARGETS);
  /** The target of the last successful attack, highlighted until replaced. */
  readonly attackedTarget = input<AttackTarget>();

  readonly unitClick = output<string>();
  readonly attackTargetClick = output<AttackTarget>();

  protected readonly board = computed(() => this.battleState()?.board);

  protected isSelected(cell: RenderedEntityCell): boolean {
    return cell.kind === 'unit' && cell.id === this.selectedUnitId();
  }

  /** The mode the selection is shown in; only the selected unit carries it. */
  protected selectionMode(cell: RenderedEntityCell): InteractionMode | null {
    return this.isSelected(cell) ? this.interactionMode() : null;
  }

  /**
   * Other units step back while one is selected, so the selection stands out
   * without extra colour. Attack targets stay fully visible.
   */
  protected isDimmed(cell: RenderedEntityCell): boolean {
    return (
      this.selectedUnitId() !== undefined &&
      !this.isSelected(cell) &&
      !this.isAttackTarget(cell)
    );
  }

  /** Built once per change of the targets, not per cell and binding. */
  private readonly attackTargetKeys = computed(
    () => new Set(this.attackTargets().map(targetKey)),
  );

  private readonly attackedKey = computed(() => {
    const attacked = this.attackedTarget();
    return attacked ? targetKey(attacked) : undefined;
  });

  protected isAttackTarget(cell: RenderedEntityCell): boolean {
    return this.attackTargetKeys().has(cell.targetKey);
  }

  protected isAttacked(cell: RenderedEntityCell): boolean {
    return cell.targetKey === this.attackedKey();
  }

  protected attackLabel(cell: RenderedEntityCell): string {
    return `Attack ${cell.owner} ${cell.kind} ${cell.id}, ${healthText(cell)} HP`;
  }

  protected unitLabel(cell: RenderedEntityCell): string {
    return `${cell.owner} unit, ${healthText(cell)} HP`;
  }

  /**
   * An interactive entity names its HP on its own buttons, so its board label
   * stays visual only. A wall or orb that is not a target has no button, and
   * its label is the only place the HP is available.
   */
  protected isNamedByItsButtons(label: RenderedHealthLabel): boolean {
    return (
      label.kind === 'unit' || this.attackTargetKeys().has(label.targetKey)
    );
  }

  /**
   * One current/max HP label per entity, however many cells it covers,
   * placed on its bottom-left occupied cell. Same order as the cells.
   */
  protected readonly healthLabels = computed<RenderedHealthLabel[]>(() => {
    const state = this.battleState();
    const height = state?.board.height ?? 0;

    return [
      ...(state?.walls ?? []).flatMap((wall) =>
        healthLabel('wall', wall, height),
      ),
      ...(state?.orbs ?? []).flatMap((orb) => healthLabel('orb', orb, height)),
      ...(state?.units ?? []).flatMap((unit) =>
        healthLabel('unit', unit, height),
      ),
    ];
  });

  protected readonly entityCells = computed<RenderedEntityCell[]>(() => {
    const state = this.battleState();
    const height = state?.board.height ?? 0;

    // Walls first, then orbs, then units, so units render on top when footprints overlap.
    return [
      ...(state?.walls ?? []).flatMap((wall) =>
        footprintCells('wall', wall, height),
      ),
      ...(state?.orbs ?? []).flatMap((orb) =>
        footprintCells('orb', orb, height),
      ),
      ...(state?.units ?? []).flatMap((unit) =>
        footprintCells('unit', unit, height),
      ),
    ];
  });

  /**
   * A legal target is attacked rather than selected, whatever its kind; any
   * other unit is selected or inspected as before.
   */
  protected onEntityCellClick(cell: RenderedEntityCell): void {
    if (this.isAttackTarget(cell)) {
      this.attackTargetClick.emit({
        kind: TARGET_KIND[cell.kind],
        id: cell.id,
      });
    } else if (cell.kind === 'unit') {
      this.unitClick.emit(cell.id);
    }
  }
}

interface PlacedEntity {
  readonly id: string;
  readonly owner: PlayerSide;
  readonly position: Position;
  readonly footprint: readonly Position[];
  readonly health: number;
  readonly maxHealth: number;
}

function healthText({
  health,
  maxHealth,
}: Pick<PlacedEntity, 'health' | 'maxHealth'>): string {
  return `${health}/${maxHealth}`;
}

/**
 * The entity's label, or none for an entity that covers no cell: like its
 * cells, it then simply is not drawn, rather than breaking the whole layer.
 */
function healthLabel(
  kind: EntityKind,
  entity: PlacedEntity,
  boardHeight: number,
): RenderedHealthLabel[] {
  const cell = bottomLeftCell(entity);
  if (!cell) {
    return [];
  }
  const { id, owner } = entity;
  return [
    {
      key: `${kind}-${id}`,
      id,
      kind,
      owner,
      targetKey: targetKey({ kind: TARGET_KIND[kind], id }),
      text: healthText(entity),
      ...toGridPosition(cell, boardHeight),
    },
  ];
}

/**
 * The occupied cell lowest on the board, leftmost among those. Taken from the
 * occupied cells rather than the anchor, which a footprint does not have to
 * cover.
 */
function bottomLeftCell({
  position,
  footprint,
}: PlacedEntity): Position | undefined {
  return occupiedCells(position, footprint).reduce<Position | undefined>(
    (best, cell) =>
      !best || cell.y < best.y || (cell.y === best.y && cell.x < best.x)
        ? cell
        : best,
    undefined,
  );
}

function footprintCells(
  kind: EntityKind,
  { id, owner, position, footprint, health, maxHealth }: PlacedEntity,
  boardHeight: number,
): RenderedEntityCell[] {
  return occupiedCells(position, footprint).map((cell) => {
    const { gridColumn, gridRow } = toGridPosition(cell, boardHeight);

    return {
      key: `${kind}-${id}-${cell.x},${cell.y}`,
      id,
      kind,
      owner,
      targetKey: targetKey({ kind: TARGET_KIND[kind], id }),
      health,
      maxHealth,
      destroyed: health === 0,
      gridColumn,
      gridRow,
    };
  });
}
