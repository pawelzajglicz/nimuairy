import { DecimalPipe, formatNumber } from '@angular/common';
import {
  Component,
  LOCALE_ID,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import type { PlayerSide, Position, Unit } from '../../domain/battle-state';
import type { MovementError } from '../../domain/movement';
import type { LastMovementOutcome } from '../../movement-outcome';
import type { MovementPreview } from '../../movement-preview';

/**
 * Technical movement information for manual testing: the selected unit's
 * movement, the hovered preview, and the last move or reset outcome. Every
 * number comes from the domain; this component only formats it.
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
  readonly currentPlayer = input<PlayerSide>();
  /** Why the selected unit has no movement range, as reported by the engine. */
  readonly unavailable = input<MovementError>();
  readonly preview = input<MovementPreview>();
  readonly lastOutcome = input<LastMovementOutcome>();

  /** Temporary development control (M4 contract §5), not a gameplay action. */
  readonly resetMovement = output<void>();

  /** Display arithmetic on two domain fields, not a movement-cost calculation. */
  protected readonly spent = computed(() => {
    const unit = this.unit();
    return unit ? unit.moveRange - unit.remainingMovement : 0;
  });

  protected readonly previewPath = computed(() => {
    const steps = this.preview()?.steps ?? [];
    return steps.length > 0
      ? [steps[0].from, ...steps.map(({ to }) => to)].map(cell).join(' → ')
      : '';
  });

  protected readonly unavailableText = computed(() => {
    const error = this.unavailable();
    if (!error) {
      return undefined;
    }
    return error.type === 'UNIT_CANNOT_MOVE'
      ? `Cannot move: ${this.unit()?.owner} is not the current player (${this.currentPlayer()})`
      : `Cannot move: ${errorText(error, this.locale)}`;
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
      case 'MOVEMENT_RESET':
        return `Movement reset for ${outcome.unitId}`;
      case 'REJECTED':
        return `${outcome.action === 'MOVE' ? 'Move' : 'Reset'} rejected: ${errorText(outcome.error, this.locale)}`;
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
    case 'INSUFFICIENT_MOVEMENT':
      return `INSUFFICIENT_MOVEMENT (needs ${cost(error.required, locale)}, has ${cost(error.available, locale)})`;
    default:
      return error.type;
  }
}
