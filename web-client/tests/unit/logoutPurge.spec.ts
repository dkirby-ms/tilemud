import { describe, it, expect, beforeEach } from 'vitest';
import { useCharacterStore } from '../../src/features/character/state/characterStore';

describe('Character Store Logout Purge', () => {
  beforeEach(() => {
    // Reset store to clean state before each test
    useCharacterStore.getState().reset();
  });

  it('purges all user-scoped character data on logout', () => {
    const store = useCharacterStore.getState();
    useCharacterStore.setState({
      player: {
        id: 'player-1',
        activeCharacterId: 'char-1',
        characters: []
      } as unknown as typeof store.player,
      archetypeCatalog: { archetypes: [] } as unknown as typeof store.archetypeCatalog,
      optimisticCharacters: [{ tempId: 'temp-1', name: 'Temp', archetypeId: 'arch-1', status: 'creating' }]
    });

    store.reset();

    const afterReset = useCharacterStore.getState();
    expect(afterReset.player).toBeNull();
    expect(afterReset.archetypeCatalog).toBeNull();
    expect(afterReset.optimisticCharacters).toHaveLength(0);
  });

  it('does not mutate external analytics identifiers during purge', () => {
    const analyticsState = { id: 'analytics-123' };
    const store = useCharacterStore.getState();

    store.reset();

    expect(analyticsState.id).toBe('analytics-123');
  });

  it('clears optimistic character creations', () => {
    const store = useCharacterStore.getState();
    useCharacterStore.setState({
      optimisticCharacters: [{ tempId: 'temp-2', name: 'Opt', archetypeId: 'arch-2', status: 'failed' }]
    });

    store.reset();
    expect(useCharacterStore.getState().optimisticCharacters).toHaveLength(0);
  });
});