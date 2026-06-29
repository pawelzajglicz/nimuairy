import { Component, inject, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CharacterService } from '../../services/character.service';

@Component({
  selector: 'app-character-form',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './character-form.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './character-form.component.css'
})
export class CharacterFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly characterService = inject(CharacterService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  isEditMode = false;
  characterId: number | null = null;
  errorMessage = '';

  form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
    description: ['', Validators.maxLength(2000)]
  });

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      this.isEditMode = true;
      this.characterId = Number(idParam);
      this.loadCharacter(this.characterId);
    }
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const payload = {
      name: this.form.controls.name.value,
      description: this.form.controls.description.value || null
    };

    const request$ = this.isEditMode && this.characterId != null
      ? this.characterService.update(this.characterId, payload)
      : this.characterService.create(payload);

    request$.subscribe({
      next: () => this.router.navigate(['/characters']),
      error: () => {
        this.errorMessage = this.isEditMode ? 'Failed to update character' : 'Failed to create character';
      }
    });
  }

  private loadCharacter(id: number): void {
    this.characterService.get(id).subscribe({
      next: (character) => {
        this.form.patchValue({
          name: character.name,
          description: character.description ?? ''
        });
      },
      error: () => {
        this.errorMessage = 'Character not found';
      }
    });
  }
}
