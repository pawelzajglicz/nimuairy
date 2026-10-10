import { DecimalPipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import type { Board, Position, Unit } from '../../domain/battle-state';
import {
  occupiedCells,
  positionKey,
  samePosition,
} from '../../domain/geometry';
import type { ReachableCell } from '../../domain/movement';
import type { MovementPreview } from '../../movement-preview';
import { toGridPosition } from '../../utils/coordinate-mapper';

interface RenderedTarget {
  key: string;
  position: Position;
  cost: number;
  gridColumn: number;
  gridRow: number;
}

interface RenderedCell {
  key: string;
  gridColumn: number;
  gridRow: number;
}

/**
 * The selected unit's movement layer, drawn above units and terrain: one target
 * per reachable destination anchor, the hovered path and its cost, and the
 * movement the unit has already spent. Targets live here rather than on terrain
 * cells because a destination can overlap the moving unit's own current cells,
 * where the unit itself is the click target.
 */
@Component({
  selector: 'app-movement-overlay',
  imports: [DecimalPipe],
  templateUrl: './movement-overlay.component.html',
  styleUrl: './movement-overlay.component.css',
})
export class MovementOverlayComponent {
  readonly board = input<Board>();
  readonly destinations = input<readonly ReachableCell[]>([]);
  readonly preview = input<MovementPreview>();
  /** The selected unit: its spent movement is labelled, and its footprint outlined at the previewed destination. */
  readonly unit = input<Unit>();

  readonly destinationHover = output<Position | undefined>();
  readonly destinationClick = output<Position>();

  private readonly height = computed(() => this.board()?.height ?? 0);

  protected readonly targets = computed<RenderedTarget[]>(() =>
    this.destinations().map(({ position, cost }) => ({
      key: positionKey(position),
      position,
      cost,
      ...toGridPosition(position, this.height()),
    })),
  );

  protected readonly footprintCells = computed<RenderedCell[]>(() => {
    const preview = this.preview();
    const unit = this.unit();
    if (!preview || !unit) {
      return [];
    }
    return occupiedCells(preview.destination, unit.footprint).map((cell) => ({
      key: positionKey(cell),
      ...toGridPosition(cell, this.height()),
    }));
  });

  /** Cell centres in board units (one cell = 1), matching the SVG viewBox. */
  protected readonly pathPoints = computed(() => {
    const steps = this.preview()?.steps ?? [];
    if (steps.length === 0) {
      return undefined;
    }
    return [steps[0].from, ...steps.map(({ to }) => to)]
      .map((position) => {
        const { gridColumn, gridRow } = toGridPosition(position, this.height());
        return `${gridColumn - 0.5},${gridRow - 0.5}`;
      })
      .join(' ');
  });

  protected readonly costLabel = computed(() => {
    const preview = this.preview();
    return preview
      ? {
          cost: preview.cost,
          ...toGridPosition(preview.destination, this.height()),
        }
      : undefined;
  });

  /** Shown on the unit's anchor cell; actionPointBudget − remainingActionPoints, both from the domain. */
  protected readonly spentLabel = computed(() => {
    const unit = this.unit();
    return unit
      ? {
          spent: unit.actionPointBudget - unit.remainingActionPoints,
          ...toGridPosition(unit.position, this.height()),
        }
      : undefined;
  });

  protected isPreviewed(target: RenderedTarget): boolean {
    const destination = this.preview()?.destination;
    return (
      destination !== undefined && samePosition(destination, target.position)
    );
  }
}
