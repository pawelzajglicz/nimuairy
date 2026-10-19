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
import { validateNewBattle } from './domain/new-battle';

/**
 * Converts the backend's initial battle state into the domain model.
 * Lives outside `domain/` so the domain never depends on generated API types.
 */
export function toBattleState(response: BattleStateResponse): BattleState {
  const board = required(response.board, 'board');

  const state: BattleState = {
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
    // Nor a result: what it sends is always a new battle.
    result: { status: 'IN_PROGRESS' },
  };

  const validated = validateNewBattle(state);
  if (!validated.ok) {
    const { side, reason } = validated.error;
    throw new Error(
      `Battle state response is not a valid new battle: ${side} orb ${reason}`,
    );
  }
  return validated.value;
}

function toUnit(dto: UnitDto): Unit {
  const actionPointBudget = positiveInteger(
    required(dto.actionPointBudget, 'unit.actionPointBudget'),
    'unit.actionPointBudget',
  );
  const maxHealth = positiveInteger(
    required(dto.maxHealth, 'unit.maxHealth'),
    'unit.maxHealth',
  );

  return {
    id: required(dto.id, 'unit.id'),
    owner: required(dto.owner, 'unit.owner'),
    unitType: required(dto.unitType, 'unit.unitType'),
    position: toPosition(required(dto.position, 'unit.position')),
    footprint: required(dto.footprint, 'unit.footprint').map(toPosition),
    health: healthWithin(
      required(dto.health, 'unit.health'),
      maxHealth,
      'unit.health',
    ),
    maxHealth,
    attack: required(dto.attack, 'unit.attack'),
    defense: required(dto.defense, 'unit.defense'),
    actionPointBudget,
    movementCostFactor: positiveInteger(
      required(dto.movementCostFactor, 'unit.movementCostFactor'),
      'unit.movementCostFactor',
    ),
    attackActionPointCost: positiveInteger(
      required(dto.attackActionPointCost, 'unit.attackActionPointCost'),
      'unit.attackActionPointCost',
    ),
    // The API carries no turn progress, so every unit starts with full AP.
    remainingActionPoints: actionPointBudget,
  };
}

function toWall(dto: WallDto): Wall {
  const maxHealth = positiveInteger(
    required(dto.maxHealth, 'wall.maxHealth'),
    'wall.maxHealth',
  );

  return {
    id: required(dto.id, 'wall.id'),
    owner: required(dto.owner, 'wall.owner'),
    position: toPosition(required(dto.position, 'wall.position')),
    footprint: required(dto.footprint, 'wall.footprint').map(toPosition),
    health: healthWithin(
      required(dto.health, 'wall.health'),
      maxHealth,
      'wall.health',
    ),
    maxHealth,
    defense: required(dto.defense, 'wall.defense'),
  };
}

function toOrb(dto: OrbDto): Orb {
  const maxHealth = positiveInteger(
    required(dto.maxHealth, 'orb.maxHealth'),
    'orb.maxHealth',
  );

  return {
    id: required(dto.id, 'orb.id'),
    owner: required(dto.owner, 'orb.owner'),
    position: toPosition(required(dto.position, 'orb.position')),
    footprint: required(dto.footprint, 'orb.footprint').map(toPosition),
    health: healthWithin(
      required(dto.health, 'orb.health'),
      maxHealth,
      'orb.health',
    ),
    maxHealth,
    defense: required(dto.defense, 'orb.defense'),
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
 * pathfinding's positive-cost assumption; a maximum HP of 0 would mean an
 * object that starts destroyed. The OpenAPI type is only `number`.
 */
function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Battle state response has invalid ${field}: ${value}, expected a positive integer`,
    );
  }
  return value;
}

/**
 * The HP invariant shared by units, walls and orbs. Checked here as well as in
 * the backend records, like the unit statistics, because the engine and the
 * HP labels take `0 <= health <= maxHealth` for granted.
 */
function healthWithin(
  health: number,
  maxHealth: number,
  field: string,
): number {
  if (!Number.isInteger(health) || health < 0 || health > maxHealth) {
    throw new Error(
      `Battle state response has invalid ${field}: ${health}, expected an integer from 0 to maxHealth ${maxHealth}`,
    );
  }
  return health;
}
