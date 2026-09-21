import { Component, inject } from '@angular/core';
import type { BoardInteraction } from '../../board-interaction';
import { BattleStore } from '../../battle.store';
import { BattleBoardComponent } from '../../components/battle-board/battle-board.component';
import { InteractionModeControlsComponent } from '../../components/interaction-mode-controls/interaction-mode-controls.component';

@Component({
  selector: 'app-battle-demo-page',
  imports: [BattleBoardComponent, InteractionModeControlsComponent],
  providers: [BattleStore],
  templateUrl: './battle-demo-page.html',
  styleUrl: './battle-demo-page.css',
})
export class BattleDemoPage {
  protected readonly store = inject(BattleStore);

  protected onBoardInteraction(interaction: BoardInteraction): void {
    switch (interaction.kind) {
      case 'unit-clicked':
        this.store.selectUnit(interaction.unitId);
        break;
      case 'cell-clicked':
        this.store.clearSelection();
        break;
    }
  }
}
