import type { Position } from './domain/battle-state';
import type { AttackTarget } from './domain/combat';

/**
 * A raw board click, normalized to a domain-meaningful interaction.
 * Frontend-only UI concept; not part of the backend BattleState.
 */
export type BoardInteraction =
  UnitClicked | CellClicked | DestinationClicked | AttackTargetClicked;

export interface UnitClicked {
  kind: 'unit-clicked';
  unitId: string;
}

export interface CellClicked {
  kind: 'cell-clicked';
  position: Position;
}

/** A click on a reachable movement destination of the selected unit. */
export interface DestinationClicked {
  kind: 'destination-clicked';
  position: Position;
}

/** A click on one of the selected unit's legal attack targets. */
export interface AttackTargetClicked {
  kind: 'attack-target-clicked';
  target: AttackTarget;
}
