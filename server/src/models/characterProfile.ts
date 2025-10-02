import type { Pool } from "pg";

export interface CharacterProfile {
  characterId: string;
  userId: string;
  displayName: string;
  positionX: number;
  positionY: number;
  health: number;
  inventory: Record<string, unknown>;
  stats: Record<string, unknown>;
  updatedAt: Date;
}

export interface CreateCharacterProfileInput {
  characterId: string;
  userId: string;
  displayName: string;
  positionX: number;
  positionY: number;
  health: number;
  inventory: Record<string, unknown>;
  stats: Record<string, unknown>;
}

export interface UpdateCharacterProfileInput {
  characterId: string;
  userId: string;
  expectedUpdatedAt: Date;
  positionX?: number;
  positionY?: number;
  health?: number;
  inventory?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  displayName?: string;
}

export class CharacterProfileConcurrencyError extends Error {
  constructor(message = "character_profile_concurrency_conflict") {
    super(message);
    this.name = "CharacterProfileConcurrencyError";
  }
}

export interface CharacterProfileRepository {
  createProfile(input: CreateCharacterProfileInput): Promise<CharacterProfile>;
  getProfile(characterId: string, userId: string): Promise<CharacterProfile | null>;
  updateProfile(input: UpdateCharacterProfileInput): Promise<CharacterProfile>;
}

class NotImplementedCharacterProfileRepository implements CharacterProfileRepository {
  constructor(_pool: Pool) {
    // intentionally unused until implementation task T028
  }

  async createProfile(): Promise<CharacterProfile> {
    throw new Error("CharacterProfileRepository.createProfile not implemented");
  }

  async getProfile(): Promise<CharacterProfile | null> {
    throw new Error("CharacterProfileRepository.getProfile not implemented");
  }

  async updateProfile(): Promise<CharacterProfile> {
    throw new Error("CharacterProfileRepository.updateProfile not implemented");
  }
}

export function createCharacterProfileRepository(pool: Pool): CharacterProfileRepository {
  return new NotImplementedCharacterProfileRepository(pool);
}
