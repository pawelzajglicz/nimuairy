import { Component, inject } from '@angular/core';
import { BattleStore } from '../../battle.store';
import { BattleBoardComponent } from '../../components/battle-board/battle-board.component';

@Component({
  selector: 'app-battle-demo-page',
  imports: [BattleBoardComponent],
  providers: [BattleStore],
  templateUrl: './battle-demo-page.html',
  styleUrl: './battle-demo-page.css',
})
export class BattleDemoPage {
  protected readonly store = inject(BattleStore);
}
