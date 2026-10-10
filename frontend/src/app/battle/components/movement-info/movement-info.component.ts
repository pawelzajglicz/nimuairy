import { DecimalPipe, formatNumber } from '@angular/common';
import { Component, LOCALE_ID, computed, inject, input } from '@angular/core';
import type { Position, Unit } from '../../domain/battle-state';
import type { MovementError } from '../../domain/movement';
import type { LastMovementOutcome } from '../../movement-outcome';
import type { MovementPreview } from '../../movement-preview';

/**
 * Technical movement information for manual testing: the selected unit's
 * movement, the hovered preview, and the last move outcome. Every number
 * comes from the domain; this component only formats it.
 */
@Component({
  selector: 'app-movement-info',
  imports: [DecimalPipe],
  templateUrl: './movement-info.component.html',
  styleUrl: './movement-info.component.css',
})
export class MovementInfoComponent {
  private readonly locale = inject(LOCALE_ID);

  readonly unit = input<Unit>();
  readonly preview = input<MovementPreview>();
  readonly lastOutcome = input<LastMovementOutcome>();

  /** Display arithmetic on two domain fields, not a movement-cost calculation. */
  protected readonly spent = computed(() => {
    const unit = this.unit();
    return unit ? unit.actionPointBudget - unit.remainingActionPoints : 0;
  });

  protected readonly previewPath = computed(() => {
    const steps = this.preview()?.steps ?? [];
    return steps.length > 0
      ? [steps[0].from, ...steps.map(({ to }) => to)].map(cell).join(' → ')
      : '';
  });

  protected readonly lastOutcomeText = computed(() => {
    const outcome = this.lastOutcome();
    switch (outcome?.kind) {
      case undefined:
        return '';
      case 'MOVED': {
        const from = outcome.steps[0].from;
        const to = outcome.steps[outcome.steps.length - 1].to;
        return `${outcome.owner} moved ${outcome.unitId} ${cell(from)} → ${cell(to)} · cost ${cost(outcome.cost, this.locale)}`;
      }
      case 'REJECTED':
        return `Move rejected: ${errorText(outcome.error, this.locale)}`;
    }
  });
}

function cell({ x, y }: Position): string {
  return `(${x},${y})`;
}

function cost(value: number, locale: string): string {
  return formatNumber(value, locale, '1.0-2');
}

function errorText(error: MovementError, locale: string): string {
  switch (error.type) {
    case 'INVALID_PATH':
      return `INVALID_PATH (${error.reason})`;
    case 'INSUFFICIENT_ACTION_POINTS':
      return `INSUFFICIENT_ACTION_POINTS (needs ${cost(error.required, locale)}, has ${cost(error.available, locale)})`;
    default:
      return error.type;
  }
}
