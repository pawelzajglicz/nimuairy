import { Component, computed, input } from '@angular/core';
import type { ActionType } from '../../domain/actions';
import type { Position, Unit } from '../../domain/battle-state';
import type { AttackError } from '../../domain/combat';
import type { MovementError } from '../../domain/movement';
import type { LastActionOutcome } from '../../action-outcome';
import type { MovementPreview } from '../../movement-preview';

/**
 * Technical movement and combat information for manual testing: the selected
 * unit's HP and AP, the hovered preview, and the last action outcome. Every number
 * comes from the domain; this component only formats it.
 */
@Component({
  selector: 'app-movement-info',
  templateUrl: './movement-info.component.html',
  styleUrl: './movement-info.component.css',
})
export class MovementInfoComponent {
  readonly unit = input<Unit>();
  readonly preview = input<MovementPreview>();
  readonly lastOutcome = input<LastActionOutcome>();

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
        return `${outcome.owner} moved ${outcome.unitId} ${cell(from)} → ${cell(to)} · cost ${cost(outcome.cost)}`;
      }
      case 'ATTACKED': {
        const { kind, id } = outcome.target;
        const destroyed = outcome.remainingHealth === 0 ? ' · destroyed' : '';
        return `${outcome.owner} ${outcome.unitId} attacked ${kind} ${id} · damage ${outcome.damage} · remaining HP ${outcome.remainingHealth} · cost ${cost(outcome.cost)}${destroyed}`;
      }
      case 'REJECTED':
        return `${ACTION_LABEL[outcome.action]} rejected: ${errorText(outcome.error)}`;
    }
  });
}

const ACTION_LABEL: Record<ActionType, string> = {
  MOVE: 'Move',
  ATTACK: 'Attack',
  END_TURN: 'End turn',
};

function cell({ x, y }: Position): string {
  return `(${x},${y})`;
}

function cost(actionPoints: number): string {
  return `${actionPoints} AP`;
}

function errorText(error: MovementError | AttackError): string {
  switch (error.type) {
    case 'INVALID_PATH':
      return `INVALID_PATH (${error.reason})`;
    case 'INSUFFICIENT_ACTION_POINTS':
      return `INSUFFICIENT_ACTION_POINTS (needs ${cost(error.required)}, has ${cost(error.available)})`;
    default:
      return error.type;
  }
}
