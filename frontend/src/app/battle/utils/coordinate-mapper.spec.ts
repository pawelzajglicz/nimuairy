import { toGridPosition } from './coordinate-mapper';

describe('toGridPosition', () => {
  const boardHeight = 11;

  it('maps the bottom-left corner (0,0) to column 1, row 11', () => {
    expect(toGridPosition({ x: 0, y: 0 }, boardHeight)).toEqual({
      gridColumn: 1,
      gridRow: 11,
    });
  });

  it('maps the bottom-right corner (20,0) to column 21, row 11', () => {
    expect(toGridPosition({ x: 20, y: 0 }, boardHeight)).toEqual({
      gridColumn: 21,
      gridRow: 11,
    });
  });

  it('maps the top-left corner (0,10) to column 1, row 1', () => {
    expect(toGridPosition({ x: 0, y: 10 }, boardHeight)).toEqual({
      gridColumn: 1,
      gridRow: 1,
    });
  });

  it('maps the top-right corner (20,10) to column 21, row 1', () => {
    expect(toGridPosition({ x: 20, y: 10 }, boardHeight)).toEqual({
      gridColumn: 21,
      gridRow: 1,
    });
  });

  it('inverts the y-axis: increasing y decreases the grid row', () => {
    const lower = toGridPosition({ x: 5, y: 2 }, boardHeight);
    const higher = toGridPosition({ x: 5, y: 8 }, boardHeight);

    expect(higher.gridRow).toBeLessThan(lower.gridRow);
    expect(lower.gridColumn).toBe(higher.gridColumn);
  });
});
