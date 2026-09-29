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
 * One transition between adjacent anchors, as evaluated by the engine.
 * Commands carry positions only; costs always come from the engine, so a step
 * is never built from caller input.
 */
export interface MovementStep {
  readonly from: Position;
  readonly to: Position;
  readonly cost: number;
}

/**
 * What the engine actually executed. `steps` keeps each step's cost so callers
 * can show it (future terrain makes steps differ) without recalculating
 * movement cost themselves; `cost` is the total charged.
 */
export interface MovementResult {
  readonly state: BattleState;
  readonly steps: readonly MovementStep[];
  readonly cost: number;
}

export type StepViolation = 'NOT_ADJACENT' | 'BLOCKED' | 'CORNER_BLOCKED';

export type InvalidPathReason =
  'EMPTY' | 'DESTINATION_MISMATCH' | 'REVISITED' | StepViolation;

export type MovementError =
  | { readonly type: 'UNIT_NOT_FOUND'; readonly unitId: string }
  | { readonly type: 'UNIT_CANNOT_MOVE'; readonly unitId: string }
  | { readonly type: 'INVALID_DESTINATION'; readonly destination: Position }
  | { readonly type: 'INVALID_PATH'; readonly reason: InvalidPathReason }
  | {
      readonly type: 'INSUFFICIENT_MOVEMENT';
      readonly required: number;
      readonly available: number;
    };

export interface ReachableCell {
  readonly position: Position;
  /** Minimum movement cost from the origin. */
  readonly cost: number;
  /** Last step of the canonical minimum-cost path; null for the origin. */
  readonly via: MovementStep | null;
}

/**
 * Minimum-cost paths from a unit's anchor to every anchor within its
 * remaining movement, stored as a shortest-path tree: each cell keeps only
 * its incoming step, and full paths are rebuilt on demand.
 */
export interface Reachability {
  readonly origin: Position;
  /** Keyed by positionKey; includes the origin at cost 0. */
  readonly cells: ReadonlyMap<string, ReachableCell>;
}
