import { Component, inject } from '@angular/core';
import { BattleStore } from '../../battle.store';

@Component({
  selector: 'app-battle-demo-page',
  imports: [],
  providers: [BattleStore],
  templateUrl: './battle-demo-page.html',
  styleUrl: './battle-demo-page.css',
})
export class BattleDemoPage {
  protected readonly store = inject(BattleStore);
}
