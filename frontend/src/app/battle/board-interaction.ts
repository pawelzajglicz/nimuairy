import type { PositionDto } from '../api/generated/model';

/**
 * A raw board click, normalized to a domain-meaningful interaction.
 * Frontend-only UI concept; not part of the backend BattleState.
 */
export type BoardInteraction = UnitClicked | CellClicked;

export interface UnitClicked {
  kind: 'unit-clicked';
  unitId: string;
}

export interface CellClicked {
  kind: 'cell-clicked';
  position: PositionDto;
}
