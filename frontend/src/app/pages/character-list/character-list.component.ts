import { Component, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { CharacterService } from '../../services/character.service';
import { Character } from '../../models/character.model';

@Component({
  selector: 'app-character-list',
  imports: [RouterLink, DatePipe],
  templateUrl: './character-list.component.html',
  styleUrl: './character-list.component.css'
})
export class CharacterListComponent implements OnInit {
  private readonly characterService = inject(CharacterService);

  characters: Character[] = [];
  errorMessage = '';

  ngOnInit(): void {
    this.loadCharacters();
  }

  deleteCharacter(id: number): void {
    if (!confirm('Delete this character?')) {
      return;
    }

    this.characterService.delete(id).subscribe({
      next: () => this.loadCharacters(),
      error: () => {
        this.errorMessage = 'Failed to delete character';
      }
    });
  }

  private loadCharacters(): void {
    this.characterService.getAll().subscribe({
      next: (characters) => {
        this.characters = characters;
      },
      error: () => {
        this.errorMessage = 'Failed to load characters';
      }
    });
  }
}
