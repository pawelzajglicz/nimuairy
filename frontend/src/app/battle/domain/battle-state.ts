/**
 * Framework-independent battle domain model, mirroring the backend records in
 * com.nimuairy.nimuairy.battle so the engine can later move to Java.
 * Unlike the generated API DTOs, fields are required and readonly, and the
 * model holds battle state that the API does not carry yet
 * (remainingActionPoints, activeUnitId, result).
 */

export interface Position {
  readonly x: number;
  readonly y: number;
}

export type PlayerSide = 'LEFT' | 'RIGHT';

export type UnitType = 'SWORDSMAN';

export type TerrainType = 'PLAIN' | 'ROCK';

export interface TerrainCell {
  readonly position: Position;
  readonly type: TerrainType;
}

export interface Board {
  readonly width: number;
  readonly height: number;
  readonly terrain: readonly TerrainCell[];
}

export interface Unit {
  readonly id: string;
  readonly owner: PlayerSide;
  readonly unitType: UnitType;
  /** Anchor cell; footprint offsets are relative to it. */
  readonly position: Position;
  readonly footprint: readonly Position[];
  readonly health: number;
  /** Kept apart from health, which cannot give it back after damage. Integer > 0. */
  readonly maxHealth: number;
  readonly attack: number;
  readonly defense: number;
  /** AP restored at the start of each of the owner's turns. Integer > 0. */
  readonly actionPointBudget: number;
  /** Multiplies the cost of every movement step. Integer > 0. */
  readonly movementCostFactor: number;
  /** AP an ATTACK by this unit costs. Integer > 0. */
  readonly attackActionPointCost: number;
  /**
   * AP left in the current turn, shared by all unit actions. Stored rather
   * than derived from action history so a turn can contain several actions
   * (MOVE → ATTACK → MOVE). Invariant: integer >= 0.
   */
  readonly remainingActionPoints: number;
}

export interface Wall {
  readonly id: string;
  readonly owner: PlayerSide;
  readonly position: Position;
  readonly footprint: readonly Position[];
  readonly health: number;
  readonly maxHealth: number;
  readonly defense: number;
}

export interface Orb {
  readonly id: string;
  readonly owner: PlayerSide;
  readonly position: Position;
  readonly footprint: readonly Position[];
  /**
   * An orb at 0 HP is destroyed but stays in the battle state, unlike units
   * and walls, so that victory can be determined from it.
   */
  readonly health: number;
  readonly maxHealth: number;
  readonly defense: number;
}

/**
 * DRAW is reserved for future mechanics that could destroy both orbs in one
 * action; no current action produces it.
 */
export type BattleOutcome =
  | { readonly type: 'VICTORY'; readonly winner: PlayerSide }
  | { readonly type: 'DRAW' };

export type BattleResult =
  | { readonly status: 'IN_PROGRESS' }
  | { readonly status: 'FINISHED'; readonly outcome: BattleOutcome };

export interface BattleState {
  readonly board: Board;
  readonly orbs: readonly Orb[];
  readonly walls: readonly Wall[];
  readonly units: readonly Unit[];
  /** The only player whose units may currently act. */
  readonly currentPlayer: PlayerSide;
  /**
   * The unit that has claimed the current turn; once set, no other unit may
   * act until the turn ends. Undefined until the turn's first unit action.
   * Turn state, not the UI's selected unit.
   */
  readonly activeUnitId: string | undefined;
  /** Once FINISHED, no gameplay action can change the state any more. */
  readonly result: BattleResult;
}
