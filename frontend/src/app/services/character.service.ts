import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Character, CharacterRequest } from '../models/character.model';

@Injectable({ providedIn: 'root' })
export class CharacterService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/characters`;

  getAll(): Observable<Character[]> {
    return this.http.get<Character[]>(this.baseUrl);
  }

  get(id: number): Observable<Character> {
    return this.http.get<Character>(`${this.baseUrl}/${id}`);
  }

  create(request: CharacterRequest): Observable<Character> {
    return this.http.post<Character>(this.baseUrl, request);
  }

  update(id: number, request: CharacterRequest): Observable<Character> {
    return this.http.put<Character>(`${this.baseUrl}/${id}`, request);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}
