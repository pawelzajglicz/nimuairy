export interface DomainPosition {
  x: number;
  y: number;
}

export interface GridPosition {
  gridColumn: number;
  gridRow: number;
}

/**
 * Domain coordinates are Cartesian with (0,0) at the board's bottom-left corner
 * and y increasing upward. CSS Grid coordinates start at 1 with row 1 at the
 * top, so the y-axis must be flipped against the board height.
 */
export function toGridPosition(
  position: DomainPosition,
  boardHeight: number,
): GridPosition {
  return {
    gridColumn: position.x + 1,
    gridRow: boardHeight - position.y,
  };
}
