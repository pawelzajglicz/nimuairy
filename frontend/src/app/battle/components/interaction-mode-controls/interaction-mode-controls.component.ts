import { Component, input, output } from '@angular/core';
import { InteractionMode } from '../../interaction-mode';

@Component({
  selector: 'app-interaction-mode-controls',
  imports: [],
  templateUrl: './interaction-mode-controls.component.html',
  styleUrl: './interaction-mode-controls.component.css',
})
export class InteractionModeControlsComponent {
  readonly mode = input.required<InteractionMode>();

  readonly modeChange = output<InteractionMode>();

  protected readonly modes = [InteractionMode.MOVE, InteractionMode.ATTACK];
}
