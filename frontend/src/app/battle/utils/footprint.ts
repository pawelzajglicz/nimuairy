import type { PositionDto } from '../../api/generated/model';
import type { DomainPosition } from './coordinate-mapper';

/** Expands an entity's anchor position plus footprint offsets into the domain cells it occupies. */
export function footprintPositions(
  anchor: PositionDto | undefined,
  footprint: PositionDto[] | undefined,
): DomainPosition[] {
  const anchorX = anchor?.x ?? 0;
  const anchorY = anchor?.y ?? 0;

  return (footprint ?? []).map((offset) => ({
    x: anchorX + (offset.x ?? 0),
    y: anchorY + (offset.y ?? 0),
  }));
}

export function positionKey(position: DomainPosition): string {
  return `${position.x},${position.y}`;
}
