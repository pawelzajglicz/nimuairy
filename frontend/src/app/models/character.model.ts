export interface Character {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface CharacterRequest {
  name: string;
  description?: string | null;
}
