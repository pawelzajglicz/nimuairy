import type { BattleState, Position } from './battle-state';

/**
 * Move a unit to `destination` along the exact `path` chosen by the caller.
 * `path` lists the cells entered, excluding the unit's starting position, and
 * ends at `destination`. The engine never trusts the path without validating it.
 */
export interface MoveUnitCommand {
  readonly type: 'MOVE_UNIT';
  readonly unitId: string;
  readonly destination: Position;
  readonly path: readonly Position[];
}

/**
 * What the engine actually executed. Callers display `cost` from here instead
 * of recalculating movement cost themselves.
 */
export interface MovementResult {
  readonly state: BattleState;
  readonly path: readonly Position[];
  readonly cost: number;
}

export type MovementError =
  | { readonly type: 'UNIT_NOT_FOUND'; readonly unitId: string }
  | { readonly type: 'UNIT_CANNOT_MOVE'; readonly unitId: string }
  | { readonly type: 'INVALID_DESTINATION'; readonly destination: Position }
  | { readonly type: 'INVALID_PATH'; readonly reason: string }
  | {
      readonly type: 'INSUFFICIENT_MOVEMENT';
      readonly required: number;
      readonly available: number;
    };
