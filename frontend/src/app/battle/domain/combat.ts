import type { BattleFinishedError } from './actions';
import type { BattleState } from './battle-state';

/**
 * The kind type is derived from this list, so the legal-target query, which
 * walks the list, cannot miss a kind.
 */
export const ATTACK_TARGET_KINDS = ['UNIT', 'WALL', 'ORB'] as const;

export type AttackTargetKind = (typeof ATTACK_TARGET_KINDS)[number];

/**
 * Identifies the attacked object. The kind is part of the identity because ids
 * are only unique within their own collection.
 */
export interface AttackTarget {
  readonly kind: AttackTargetKind;
  readonly id: string;
}

/** A melee attack by `unitId` on `target`. */
export interface AttackCommand {
  readonly type: 'ATTACK';
  readonly unitId: string;
  readonly target: AttackTarget;
}

/**
 * What the engine actually executed, so callers can present the outcome
 * without recalculating combat rules.
 */
export interface AttackResult {
  readonly state: BattleState;
  readonly target: AttackTarget;
  /** Damage by formula; it may exceed the HP the target had left. */
  readonly damage: number;
  /**
   * The target's HP after the attack; 0 means destroyed. Reported here because
   * a destroyed unit or wall is no longer in `state`.
   */
  readonly remainingHealth: number;
  /** AP charged to the attacker. */
  readonly cost: number;
}

/**
 * `BATTLE_FINISHED`, `UNIT_NOT_FOUND` and `INSUFFICIENT_ACTION_POINTS` match
 * their MovementError counterparts, so callers can handle them the same way
 * for every action.
 */
export type AttackError =
  | BattleFinishedError
  | { readonly type: 'UNIT_NOT_FOUND'; readonly unitId: string }
  | { readonly type: 'UNIT_CANNOT_ATTACK'; readonly unitId: string }
  | { readonly type: 'TARGET_NOT_FOUND'; readonly target: AttackTarget }
  | { readonly type: 'INVALID_TARGET'; readonly target: AttackTarget }
  | { readonly type: 'TARGET_OUT_OF_RANGE'; readonly target: AttackTarget }
  | {
      readonly type: 'INSUFFICIENT_ACTION_POINTS';
      readonly required: number;
      readonly available: number;
    };
