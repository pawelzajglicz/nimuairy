import type { PositionDto } from '../../api/generated/model';
import type { Position } from '../domain/battle-state';
import { occupiedCells } from '../domain/geometry';
import type { DomainPosition } from './coordinate-mapper';

export { positionKey } from '../domain/geometry';

/**
 * Expands an entity's anchor position plus footprint offsets into the domain
 * cells it occupies. Adapts the optional DTO fields for rendering; the
 * footprint geometry itself lives in the domain.
 */
export function footprintPositions(
  anchor: PositionDto | undefined,
  footprint: PositionDto[] | undefined,
): DomainPosition[] {
  return occupiedCells(toPosition(anchor), (footprint ?? []).map(toPosition));
}

function toPosition(dto: PositionDto | undefined): Position {
  return { x: dto?.x ?? 0, y: dto?.y ?? 0 };
}
