import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { CharacterService } from '../../services/character.service';
import { Character } from '../../models/character.model';

@Component({
  selector: 'app-character-list',
  imports: [RouterLink, DatePipe],
  templateUrl: './character-list.component.html',
  styleUrl: './character-list.component.css',
})
export class CharacterListComponent implements OnInit {
  private readonly characterService = inject(CharacterService);
  private readonly destroyRef = inject(DestroyRef);

  readonly characters = signal<Character[]>([]);
  readonly errorMessage = signal('');

  ngOnInit(): void {
    this.loadCharacters();
  }

  deleteCharacter(id: number): void {
    if (!confirm('Delete this character?')) {
      return;
    }

    this.characterService
      .delete(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.loadCharacters(),
        error: () => {
          this.errorMessage.set('Failed to delete character');
        },
      });
  }

  private loadCharacters(): void {
    this.characterService
      .getAll()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (characters) => {
          this.characters.set(characters);
        },
        error: () => {
          this.errorMessage.set('Failed to load characters');
        },
      });
  }
}
