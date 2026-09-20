import { Component, input } from '@angular/core';
import type { BattleStateResponse } from '../../../api/generated/model';
import { BoardGridComponent } from '../board-grid/board-grid.component';

@Component({
  selector: 'app-battle-board',
  imports: [BoardGridComponent],
  templateUrl: './battle-board.component.html',
  styleUrl: './battle-board.component.css',
})
export class BattleBoardComponent {
  readonly battleState = input<BattleStateResponse>();
}
