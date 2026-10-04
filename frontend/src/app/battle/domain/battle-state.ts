/**
 * Framework-independent battle domain model, mirroring the backend records in
 * com.nimuairy.nimuairy.battle so the engine can later move to Java.
 * Unlike the generated API DTOs, fields are required and readonly, and the
 * model holds battle state that the API does not carry yet
 * (remainingMovement).
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
  readonly attack: number;
  readonly defense: number;
  /** Initial movement allowance; never consumed by movement. */
  readonly moveRange: number;
  /**
   * Current allowance, stored rather than derived from movement history so a
   * turn can contain several moves (MOVE → ATTACK → MOVE).
   * Invariant: 0 <= remainingMovement <= moveRange.
   */
  readonly remainingMovement: number;
}

export interface Wall {
  readonly id: string;
  readonly owner: PlayerSide;
  readonly position: Position;
  readonly footprint: readonly Position[];
  readonly health: number;
}

export interface Orb {
  readonly id: string;
  readonly owner: PlayerSide;
  readonly position: Position;
  readonly footprint: readonly Position[];
  readonly health: number;
}

export interface BattleState {
  readonly board: Board;
  readonly orbs: readonly Orb[];
  readonly walls: readonly Wall[];
  readonly units: readonly Unit[];
  /** The only player whose units may currently act. */
  readonly currentPlayer: PlayerSide;
}
