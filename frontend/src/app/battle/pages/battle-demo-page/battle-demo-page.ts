import { Component, ElementRef, inject, viewChild } from '@angular/core';
import type { BoardInteraction } from '../../board-interaction';
import { BattleStore } from '../../battle.store';
import { BattleBoardComponent } from '../../components/battle-board/battle-board.component';
import { InteractionModeControlsComponent } from '../../components/interaction-mode-controls/interaction-mode-controls.component';
import { MovementInfoComponent } from '../../components/movement-info/movement-info.component';

@Component({
  selector: 'app-battle-demo-page',
  imports: [
    BattleBoardComponent,
    InteractionModeControlsComponent,
    MovementInfoComponent,
  ],
  providers: [BattleStore],
  templateUrl: './battle-demo-page.html',
  styleUrl: './battle-demo-page.css',
})
export class BattleDemoPage {
  protected readonly store = inject(BattleStore);

  private readonly loadStatus =
    viewChild.required<ElementRef<HTMLElement>>('loadStatus');

  /**
   * The clicked button is removed while the battle reloads, which would drop
   * keyboard focus to the page body; the load status stays and says what is
   * happening.
   */
  protected startNewBattle(): void {
    this.store.restart();
    this.loadStatus().nativeElement.focus();
  }

  protected onBoardInteraction(interaction: BoardInteraction): void {
    switch (interaction.kind) {
      case 'unit-clicked':
        this.store.selectUnit(interaction.unitId);
        break;
      case 'cell-clicked':
        this.store.clearSelection();
        break;
      case 'destination-clicked':
        this.store.moveSelectedUnit(interaction.position);
        break;
      case 'attack-target-clicked':
        this.store.attackTarget(interaction.target);
        break;
    }
  }
}
