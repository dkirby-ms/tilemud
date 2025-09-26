/**
 * Character Components Unit Tests
 * 
 * Tests for character creation form and roster components covering:
 * - Form validation and submission
 * - Accessibility compliance
 * - User interaction handling
 * - Loading and error states
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CharacterCreationForm } from '../../src/features/character/components/CharacterCreationForm';
import { CharacterRoster } from '../../src/features/character/components/CharacterRoster';
import { OutageBanner } from '../../src/features/character/components/OutageBanner';
import type { Character, ServiceOutage, ServiceHealth } from '../../src/types/domain';

describe('CharacterCreationForm', () => {
  const mockArchetypes = [
    {
      id: 'warrior',
      name: 'Warrior',
      description: 'A brave fighter with strength and valor'
    },
    {
      id: 'mage',
      name: 'Mage',
      description: 'A wise spellcaster wielding arcane magic'
    }
  ];

  const mockOnSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Accessibility', () => {
    it('should have proper form structure with labels', () => {
      render(
        <CharacterCreationForm 
          onSubmit={mockOnSubmit} 
          archetypes={mockArchetypes} 
        />
      );
      
      // Name input should be labeled
      const nameInput = screen.getByLabelText(/character name/i);
      expect(nameInput).toBeInTheDocument();
      
      // Submit button should be accessible
      const submitButton = screen.getByRole('button', { name: /create character/i });
      expect(submitButton).toBeInTheDocument();
    });
  });

  describe('Form Validation', () => {
    it('should validate required character name', async () => {
      const user = userEvent.setup();
      render(
        <CharacterCreationForm 
          onSubmit={mockOnSubmit} 
          archetypes={mockArchetypes} 
        />
      );
      
      const submitButton = screen.getByRole('button', { name: /create character/i });
      await user.click(submitButton);
      
      // Should show validation help message
      await waitFor(() => {
        expect(screen.getByText(/please enter a character name/i)).toBeInTheDocument();
      });
      
      expect(mockOnSubmit).not.toHaveBeenCalled();
    });

    it('should require archetype selection', async () => {
      const user = userEvent.setup();
      render(
        <CharacterCreationForm 
          onSubmit={mockOnSubmit} 
          archetypes={mockArchetypes} 
        />
      );
      
      const nameInput = screen.getByLabelText(/character name/i);
      await user.type(nameInput, 'ValidName');
      
      const submitButton = screen.getByRole('button', { name: /create character/i });
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(screen.getByText(/please select.*archetype/i)).toBeInTheDocument();
      });
    });
  });

  describe('Form Submission', () => {
    it('should submit form with valid data', async () => {
      const user = userEvent.setup();
      mockOnSubmit.mockResolvedValue(undefined);
      
      render(
        <CharacterCreationForm 
          onSubmit={mockOnSubmit} 
          archetypes={mockArchetypes} 
        />
      );
      
      // Fill out form
      const nameInput = screen.getByLabelText(/character name/i);
      await user.type(nameInput, 'Test Character');
      
      // Select archetype from dropdown
      const archetypeSelect = screen.getByLabelText(/character archetype/i);
      await user.selectOptions(archetypeSelect, 'warrior');
      
      // Submit form
      const submitButton = screen.getByRole('button', { name: /create character/i });
      await user.click(submitButton);
      
      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalled();
      });
    });
  });

  describe('Archetype Selection', () => {
    it('should display archetype options', () => {
      render(
        <CharacterCreationForm 
          onSubmit={mockOnSubmit} 
          archetypes={mockArchetypes} 
        />
      );
      
      // Should show warrior archetype option
      expect(screen.getByText('Warrior')).toBeInTheDocument();
      // Should show mage archetype option
      expect(screen.getByText('Mage')).toBeInTheDocument();
    });
  });

  describe('Loading States', () => {
    it('should show loading state during submission', () => {
      render(
        <CharacterCreationForm 
          onSubmit={mockOnSubmit} 
          archetypes={mockArchetypes}
          isSubmitting={true}
        />
      );
      
      const submitButton = screen.getByRole('button');
      expect(submitButton).toBeDisabled();
    });
  });
});

describe('CharacterRoster', () => {
  const mockCharacters: Character[] = [
    {
      id: 'char1',
      name: 'Aragorn',
      archetypeId: 'warrior',
      status: 'active',
      createdAt: '2023-01-01T00:00:00.000Z'
    },
    {
      id: 'char2',
      name: 'Gandalf',
      archetypeId: 'mage',
      status: 'active',
      createdAt: '2023-01-02T00:00:00.000Z'
    }
  ];

  const mockOnSelectCharacter = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Character Display', () => {
    it('should display character information', () => {
      render(
        <CharacterRoster 
          characters={mockCharacters} 
          activeCharacterId="char1"
          onSelectCharacter={mockOnSelectCharacter}
        />
      );
      
      // Should show character names (using getAllByText since names appear multiple times)
      expect(screen.getAllByText('Aragorn')[0]).toBeInTheDocument();
      expect(screen.getAllByText('Gandalf')[0]).toBeInTheDocument();
    });

    it('should handle empty character list', () => {
      render(
        <CharacterRoster 
          characters={[]} 
          activeCharacterId={null}
          onSelectCharacter={mockOnSelectCharacter}
        />
      );
      
      expect(screen.getByText(/no characters/i)).toBeInTheDocument();
    });
  });

  describe('Character Selection', () => {
    it('should handle character selection', async () => {
      const user = userEvent.setup();
      mockOnSelectCharacter.mockResolvedValue(undefined);
      
      render(
        <CharacterRoster 
          characters={mockCharacters} 
          activeCharacterId="char1"
          onSelectCharacter={mockOnSelectCharacter}
        />
      );
      
      const selectButton = screen.getByRole('button', { name: /select character/i });
      await user.click(selectButton);
      
      expect(mockOnSelectCharacter).toHaveBeenCalledWith('char2');
    });
  });
});

describe('OutageBanner', () => {
  const mockServiceHealth: ServiceHealth = {
    service: 'character-service',
    status: 'unavailable',
    outage: {
      service: 'character-service',
      message: 'Service temporarily unavailable',
      retryAfterSeconds: 30
    }
  };

  const mockOutage: ServiceOutage = {
    service: 'character-service',
    message: 'Service temporarily unavailable',
    retryAfterSeconds: 30
  };

  const mockOnRefresh = vi.fn();

  describe('Accessibility', () => {
    it('should have proper banner role when showing outage', () => {
      render(
        <OutageBanner 
          serviceHealth={mockServiceHealth}
          outage={mockOutage}
          onRefresh={mockOnRefresh}
        />
      );
      
      const banner = screen.getByRole('banner');
      expect(banner).toBeInTheDocument();
    });
  });

  describe('Outage Display', () => {
    it('should display outage information', () => {
      render(
        <OutageBanner 
          serviceHealth={mockServiceHealth}
          outage={mockOutage}
          onRefresh={mockOnRefresh}
        />
      );
      
      expect(screen.getByText(/service temporarily unavailable/i)).toBeInTheDocument();
    });

    it('should not render when service is healthy', () => {
      render(
        <OutageBanner 
          serviceHealth={{ service: 'character-service', status: 'healthy', outage: null }}
          outage={null}
          onRefresh={mockOnRefresh}
        />
      );
      
      // Component should not render outage banner when service is healthy
      const banner = screen.queryByRole('banner');
      expect(banner).not.toBeInTheDocument();
    });
  });

  describe('Retry Functionality', () => {
    it('should call onRefresh when check status button is clicked', async () => {
      const user = userEvent.setup();
      mockOnRefresh.mockResolvedValue(undefined);
      
      render(
        <OutageBanner 
          serviceHealth={mockServiceHealth}
          outage={mockOutage}
          onRefresh={mockOnRefresh}
        />
      );
      
      const checkButton = screen.getByRole('button', { name: /check status/i });
      await user.click(checkButton);
      
      expect(mockOnRefresh).toHaveBeenCalled();
    });
  });
});