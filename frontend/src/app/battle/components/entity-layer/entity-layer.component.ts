import { Component, computed, input } from '@angular/core';
import type {
  BattleStateResponse,
  OrbDtoOwner,
  PositionDto,
  UnitDtoOwner,
  WallDtoOwner,
} from '../../../api/generated/model';
import { toGridPosition } from '../../utils/coordinate-mapper';

type EntityKind = 'unit' | 'orb' | 'wall';
type EntityOwner = UnitDtoOwner | OrbDtoOwner | WallDtoOwner;

interface RenderedEntityCell {
  key: string;
  kind: EntityKind;
  owner: EntityOwner | undefined;
  gridColumn: number;
  gridRow: number;
}

@Component({
  selector: 'app-entity-layer',
  imports: [],
  templateUrl: './entity-layer.component.html',
  styleUrl: './entity-layer.component.css',
})
export class EntityLayerComponent {
  readonly battleState = input<BattleStateResponse>();

  protected readonly board = computed(() => this.battleState()?.board);

  protected readonly entityCells = computed<RenderedEntityCell[]>(() => {
    const state = this.battleState();
    const height = state?.board?.height ?? 0;

    // Walls first, then orbs, then units, so units render on top when footprints overlap.
    return [
      ...(state?.walls ?? []).flatMap((wall) =>
        footprintCells('wall', wall.owner, wall.id, wall.position, wall.footprint, height),
      ),
      ...(state?.orbs ?? []).flatMap((orb) =>
        footprintCells('orb', orb.owner, orb.id, orb.position, orb.footprint, height),
      ),
      ...(state?.units ?? []).flatMap((unit) =>
        footprintCells('unit', unit.owner, unit.id, unit.position, unit.footprint, height),
      ),
    ];
  });
}

function footprintCells(
  kind: EntityKind,
  owner: EntityOwner | undefined,
  id: string | undefined,
  anchor: PositionDto | undefined,
  footprint: PositionDto[] | undefined,
  boardHeight: number,
): RenderedEntityCell[] {
  const anchorX = anchor?.x ?? 0;
  const anchorY = anchor?.y ?? 0;

  return (footprint ?? []).map((offset, index) => {
    const x = anchorX + (offset.x ?? 0);
    const y = anchorY + (offset.y ?? 0);
    const { gridColumn, gridRow } = toGridPosition({ x, y }, boardHeight);

    return {
      key: `${kind}-${id ?? index}-${x},${y}`,
      kind,
      owner,
      gridColumn,
      gridRow,
    };
  });
}
