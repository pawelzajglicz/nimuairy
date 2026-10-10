import type {
  BattleStateResponse,
  OrbDto,
  PositionDto,
  TerrainCellDto,
  UnitDto,
  WallDto,
} from '../api/generated/model';
import type {
  BattleState,
  Orb,
  Position,
  TerrainCell,
  Unit,
  Wall,
} from './domain/battle-state';

/**
 * Converts the backend's initial battle state into the domain model.
 * Lives outside `domain/` so the domain never depends on generated API types.
 */
export function toBattleState(response: BattleStateResponse): BattleState {
  const board = required(response.board, 'board');

  return {
    board: {
      width: required(board.width, 'board.width'),
      height: required(board.height, 'board.height'),
      terrain: required(board.terrain, 'board.terrain').map(toTerrainCell),
    },
    orbs: required(response.orbs, 'orbs').map(toOrb),
    walls: required(response.walls, 'walls').map(toWall),
    units: required(response.units, 'units').map(toUnit),
    currentPlayer: required(response.currentPlayer, 'currentPlayer'),
    // The API carries no turn progress, so a loaded battle starts with the
    // current turn unclaimed.
    activeUnitId: undefined,
  };
}

function toUnit(dto: UnitDto): Unit {
  const actionPointBudget = positiveInteger(
    required(dto.actionPointBudget, 'unit.actionPointBudget'),
    'unit.actionPointBudget',
  );

  return {
    id: required(dto.id, 'unit.id'),
    owner: required(dto.owner, 'unit.owner'),
    unitType: required(dto.unitType, 'unit.unitType'),
    position: toPosition(required(dto.position, 'unit.position')),
    footprint: required(dto.footprint, 'unit.footprint').map(toPosition),
    health: required(dto.health, 'unit.health'),
    attack: required(dto.attack, 'unit.attack'),
    defense: required(dto.defense, 'unit.defense'),
    actionPointBudget,
    movementCostFactor: positiveInteger(
      required(dto.movementCostFactor, 'unit.movementCostFactor'),
      'unit.movementCostFactor',
    ),
    // The API carries no turn progress, so every unit starts with full AP.
    remainingActionPoints: actionPointBudget,
  };
}

function toWall(dto: WallDto): Wall {
  return {
    id: required(dto.id, 'wall.id'),
    owner: required(dto.owner, 'wall.owner'),
    position: toPosition(required(dto.position, 'wall.position')),
    footprint: required(dto.footprint, 'wall.footprint').map(toPosition),
    health: required(dto.health, 'wall.health'),
  };
}

function toOrb(dto: OrbDto): Orb {
  return {
    id: required(dto.id, 'orb.id'),
    owner: required(dto.owner, 'orb.owner'),
    position: toPosition(required(dto.position, 'orb.position')),
    footprint: required(dto.footprint, 'orb.footprint').map(toPosition),
    health: required(dto.health, 'orb.health'),
  };
}

function toTerrainCell(dto: TerrainCellDto): TerrainCell {
  return {
    position: toPosition(required(dto.position, 'terrain.position')),
    type: required(dto.type, 'terrain.type'),
  };
}

function toPosition(dto: PositionDto): Position {
  return {
    x: required(dto.x, 'position.x'),
    y: required(dto.y, 'position.y'),
  };
}

/**
 * The generated OpenAPI types mark every field optional, but the backend
 * always populates them. Failing fast here beats silently defaulting, e.g.
 * placing a unit with a missing anchor at (0,0).
 */
function required<T>(value: T | null | undefined, field: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Battle state response is missing ${field}`);
  }
  return value;
}

/**
 * The engine relies on these statistics being positive integers: AP are
 * integers, and a zero cost factor would make steps free, breaking
 * pathfinding's positive-cost assumption. The OpenAPI type is only `number`.
 */
function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Battle state response has invalid ${field}: ${value}, expected a positive integer`,
    );
  }
  return value;
}
