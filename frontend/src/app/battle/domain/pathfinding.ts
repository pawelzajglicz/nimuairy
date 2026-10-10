import type { Position } from './battle-state';
import { positionKey } from './geometry';
import type { MovementStep, Reachability, ReachableCell } from './movement';
import { actionPointCost, isCheaper, isWithinBudget } from './movement-cost';
import type { MovementRules } from './movement-rules';

/**
 * Fixed exploration order (E, N, W, S, then diagonals). Among equal-cost
 * paths it decides which one is canonical, so it must stay stable for
 * deterministic previews and a reproducible future Java port.
 */
const NEIGHBOUR_OFFSETS: readonly Position[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
  { x: 1, y: -1 },
];

/**
 * Dijkstra from `origin` over the anchors the unit can occupy, never
 * recording a cell whose cost exceeds `budget` (integer AP). For an integer
 * budget, `isWithinBudget` on the fractional cost is equivalent to the cell's
 * AP cost fitting the budget, so the search never rounds a prefix.
 */
export function findReachable(
  rules: MovementRules,
  origin: Position,
  budget: number,
): Reachability {
  // Map iteration follows insertion order and re-setting a key keeps its
  // place, so equal costs are settled in discovery order.
  const cells = new Map<string, ReachableCell>([
    [
      positionKey(origin),
      { position: origin, cost: 0, actionPointCost: 0, via: null },
    ],
  ]);
  const settled = new Set<string>();

  for (
    let current = nextToSettle(cells, settled);
    current;
    current = nextToSettle(cells, settled)
  ) {
    settled.add(positionKey(current.position));

    for (const offset of NEIGHBOUR_OFFSETS) {
      const to = {
        x: current.position.x + offset.x,
        y: current.position.y + offset.y,
      };
      const key = positionKey(to);
      if (settled.has(key)) {
        continue;
      }
      const step = rules.step(current.position, to);
      if (!step.ok) {
        continue;
      }
      const cost = current.cost + step.value.cost;
      if (!isWithinBudget(cost, budget)) {
        continue;
      }
      const known = cells.get(key);
      // Only a strictly cheaper path replaces a known one: among equal-cost
      // paths the first one found stays canonical.
      if (!known || isCheaper(cost, known.cost)) {
        cells.set(key, {
          position: to,
          cost,
          actionPointCost: actionPointCost(cost),
          via: step.value,
        });
      }
    }
  }

  return { origin, cells };
}

/** The canonical minimum-cost path to `destination`; undefined if unreachable. */
export function pathTo(
  reachability: Reachability,
  destination: Position,
): readonly MovementStep[] | undefined {
  const target = reachability.cells.get(positionKey(destination));
  if (!target) {
    return undefined;
  }

  const steps: MovementStep[] = [];
  for (
    let via = target.via;
    via;
    via = reachability.cells.get(positionKey(via.from))?.via ?? null
  ) {
    steps.push(via);
  }
  return steps.reverse();
}

/**
 * Linear scan instead of a priority queue: the board has at most a few
 * hundred anchors, so a heap would add code without a measurable benefit.
 */
function nextToSettle(
  cells: ReadonlyMap<string, ReachableCell>,
  settled: ReadonlySet<string>,
): ReachableCell | undefined {
  let next: ReachableCell | undefined;
  for (const [key, cell] of cells) {
    if (!settled.has(key) && (!next || isCheaper(cell.cost, next.cost))) {
      next = cell;
    }
  }
  return next;
}
