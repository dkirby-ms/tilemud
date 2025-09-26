/**
 * Character Roster Component - TileMUD Web Client
 * 
 * This component displays the player's character roster with selection controls,
 * character management actions, and responsive grid layout.
 * 
 * Features:
 * - Responsive grid layout for character cards
 * - Character selection with visual feedback
 * - Character status indicators (active, retired, etc.)
 * - Accessible keyboard navigation
 * - Loading and empty states
 * - Character management actions (retire, restore)
 */

import { useState } from 'react'
import type { Character, CharacterStatus } from '../../../types/domain'
import type { BusinessErrorClass, ServiceErrorClass } from '../../../types/errors'
import './CharacterRoster.css'

// Union type for character roster errors
type CharacterRosterError = BusinessErrorClass | ServiceErrorClass | Error

interface CharacterRosterProps {
  /** List of characters to display */
  characters: Character[]
  
  /** ID of the currently selected character */
  activeCharacterId: string | null
  
  /** Called when a character is selected */
  onSelectCharacter: (characterId: string) => Promise<void>
  
  /** Called when a character is retired */
  onRetireCharacter?: (characterId: string) => Promise<void>
  
  /** Called when a character is restored from retired status */
  onRestoreCharacter?: (characterId: string) => Promise<void>
  
  /** Whether any character operations are in progress */
  isLoading?: boolean
  
  /** Error to display from character operations */
  error?: CharacterRosterError | null
  
  /** Additional CSS classes */
  className?: string
}

interface CharacterCardProps {
  character: Character
  isActive: boolean
  isSelected: boolean
  onSelect: () => Promise<void>
  onRetire?: (() => Promise<void>) | undefined
  onRestore?: (() => Promise<void>) | undefined
  isLoading: boolean
}

/**
 * Individual character card component
 */
function CharacterCard({
  character,
  isActive,
  isSelected,
  onSelect,
  onRetire,
  onRestore,
  isLoading
}: CharacterCardProps) {
  const [isOperationLoading, setIsOperationLoading] = useState(false)
  
  /**
   * Handle character selection
   */
  const handleSelect = async () => {
    if (isLoading || isOperationLoading || isActive) {
      return
    }
    
    try {
      setIsOperationLoading(true)
      await onSelect()
    } catch (error) {
      // Error handling is managed by parent component
      console.error('Failed to select character:', error)
    } finally {
      setIsOperationLoading(false)
    }
  }
  
  /**
   * Handle character retirement
   */
  const handleRetire = async () => {
    if (!onRetire || isLoading || isOperationLoading) {
      return
    }
    
    if (!window.confirm(`Are you sure you want to retire ${character.name}? This action can be undone later.`)) {
      return
    }
    
    try {
      setIsOperationLoading(true)
      await onRetire()
    } catch (error) {
      console.error('Failed to retire character:', error)
    } finally {
      setIsOperationLoading(false)
    }
  }
  
  /**
   * Handle character restoration
   */
  const handleRestore = async () => {
    if (!onRestore || isLoading || isOperationLoading) {
      return
    }
    
    try {
      setIsOperationLoading(true)
      await onRestore()
    } catch (error) {
      console.error('Failed to restore character:', error)
    } finally {
      setIsOperationLoading(false)
    }
  }
  
  /**
   * Format character creation date
   */
  const formatCreatedDate = (createdAt: string): string => {
    try {
      const date = new Date(createdAt)
      return date.toLocaleDateString(undefined, { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      })
    } catch {
      return 'Unknown'
    }
  }
  
  /**
   * Get status display information
   */
  const getStatusInfo = (status: CharacterStatus) => {
    switch (status) {
      case 'active':
        return { label: 'Active', className: 'character-status--active' }
      case 'retired':
        return { label: 'Retired', className: 'character-status--retired' }
      case 'suspended':
        return { label: 'Suspended', className: 'character-status--suspended' }
      default:
        return { label: 'Unknown', className: 'character-status--unknown' }
    }
  }
  
  const statusInfo = getStatusInfo(character.status)
  const canSelect = character.status === 'active' && !isActive
  const canRetire = character.status === 'active' && onRetire
  const canRestore = character.status === 'retired' && onRestore
  const isCardLoading = isLoading || isOperationLoading
  
  return (
    <div
      className={`character-card ${
        isActive ? 'character-card--active' : ''
      } ${
        isSelected ? 'character-card--selected' : ''
      } ${
        character.status !== 'active' ? 'character-card--inactive' : ''
      } ${
        isCardLoading ? 'character-card--loading' : ''
      }`}
      role="article"
      aria-label={`Character: ${character.name}`}
    >
      {/* Character Header */}
      <div className="character-card__header">
        <h3 className="character-card__name">{character.name}</h3>
        <div className={`character-status ${statusInfo.className}`}>
          {statusInfo.label}
        </div>
      </div>
      
      {/* Character Info */}
      <div className="character-card__info">
        <div className="character-card__detail">
          <span className="character-card__label">Class:</span>
          <span className="character-card__value">{character.archetypeId}</span>
        </div>
        <div className="character-card__detail">
          <span className="character-card__label">Created:</span>
          <span className="character-card__value">{formatCreatedDate(character.createdAt)}</span>
        </div>
      </div>
      
      {/* Character Actions */}
      <div className="character-card__actions">
        {/* Select Character Button */}
        {canSelect && (
          <button
            type="button"
            onClick={handleSelect}
            disabled={isCardLoading}
            className="character-action character-action--primary"
            aria-describedby={`select-help-${character.id}`}
          >
            {isOperationLoading ? (
              <>
                <span className="action-spinner" aria-hidden="true" />
                Selecting...
              </>
            ) : (
              'Select Character'
            )}
          </button>
        )}
        
        {/* Active Character Indicator */}
        {isActive && (
          <div className="character-indicator" aria-label="Currently active character">
            <span className="character-indicator__icon" aria-hidden="true">★</span>
            Active Character
          </div>
        )}
        
        {/* Secondary Actions */}
        <div className="character-card__secondary-actions">
          {canRetire && (
            <button
              type="button"
              onClick={handleRetire}
              disabled={isCardLoading}
              className="character-action character-action--secondary"
              title="Retire this character"
            >
              Retire
            </button>
          )}
          
          {canRestore && (
            <button
              type="button"
              onClick={handleRestore}
              disabled={isCardLoading}
              className="character-action character-action--secondary"
              title="Restore this character to active status"
            >
              Restore
            </button>
          )}
        </div>
      </div>
      
      {/* Loading Overlay */}
      {isCardLoading && (
        <div className="character-card__overlay" aria-hidden="true">
          <div className="character-card__spinner" />
        </div>
      )}
      
      {/* Assistive Text */}
      <div className="sr-only">
        {canSelect && (
          <div id={`select-help-${character.id}`}>
            Click to make {character.name} your active character for gameplay.
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Main character roster component
 */
export function CharacterRoster({
  characters,
  activeCharacterId,
  onSelectCharacter,
  onRetireCharacter,
  onRestoreCharacter,
  isLoading = false,
  error = null,
  className = ''
}: CharacterRosterProps) {
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)
  
  /**
   * Handle character selection with optimistic UI updates
   */
  const handleSelectCharacter = async (characterId: string) => {
    try {
      // Optimistic UI update
      setSelectedCharacterId(characterId)
      await onSelectCharacter(characterId)
    } catch (error) {
      // Revert optimistic update on error
      setSelectedCharacterId(null)
      throw error
    }
  }
  
  /**
   * Filter characters by status
   */
  const activeCharacters = characters.filter(char => char.status === 'active')
  const retiredCharacters = characters.filter(char => char.status === 'retired')
  const suspendedCharacters = characters.filter(char => char.status === 'suspended')
  
  const hasCharacters = characters.length > 0
  const hasActiveCharacters = activeCharacters.length > 0
  const hasRetiredCharacters = retiredCharacters.length > 0
  const hasSuspendedCharacters = suspendedCharacters.length > 0
  
  return (
    <div className={`character-roster ${className}`}>
      {/* Roster Header */}
      <div className="roster-header">
        <h2>Your Characters</h2>
        <p className="roster-description">
          Select a character to play, or manage your character roster.
        </p>
      </div>
      
      {/* Error Display */}
      {error && (
        <div className="error-banner" role="alert" aria-live="polite">
          <strong>Error:</strong> {error.message}
        </div>
      )}
      
      {/* Empty State */}
      {!hasCharacters && !isLoading && (
        <div className="empty-state">
          <div className="empty-state__icon" aria-hidden="true">👥</div>
          <h3>No Characters Yet</h3>
          <p>Create your first character to start your adventure in TileMUD!</p>
        </div>
      )}
      
      {/* Loading State */}
      {isLoading && !hasCharacters && (
        <div className="loading-state">
          <div className="loading-spinner" />
          <p>Loading your characters...</p>
        </div>
      )}
      
      {/* Active Characters Section */}
      {hasActiveCharacters && (
        <section className="character-section">
          <h3 className="section-title">
            Active Characters ({activeCharacters.length})
          </h3>
          <div className="character-grid">
            {activeCharacters.map((character) => {
              const cardProps: CharacterCardProps = {
                character,
                isActive: character.id === activeCharacterId,
                isSelected: character.id === selectedCharacterId,
                onSelect: () => handleSelectCharacter(character.id),
                isLoading
              }
              
              if (onRetireCharacter) {
                cardProps.onRetire = () => onRetireCharacter(character.id)
              }
              
              return <CharacterCard key={character.id} {...cardProps} />
            })}
          </div>
        </section>
      )}
      
      {/* Retired Characters Section */}
      {hasRetiredCharacters && (
        <section className="character-section">
          <h3 className="section-title">
            Retired Characters ({retiredCharacters.length})
          </h3>
          <div className="character-grid">
            {retiredCharacters.map((character) => {
              const cardProps: CharacterCardProps = {
                character,
                isActive: false,
                isSelected: false,
                onSelect: () => handleSelectCharacter(character.id),
                isLoading
              }
              
              if (onRestoreCharacter) {
                cardProps.onRestore = () => onRestoreCharacter(character.id)
              }
              
              return <CharacterCard key={character.id} {...cardProps} />
            })}
          </div>
        </section>
      )}
      
      {/* Suspended Characters Section */}
      {hasSuspendedCharacters && (
        <section className="character-section">
          <h3 className="section-title">
            Suspended Characters ({suspendedCharacters.length})
          </h3>
          <div className="character-grid">
            {suspendedCharacters.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                isActive={false}
                isSelected={false}
                onSelect={() => handleSelectCharacter(character.id)}
                isLoading={isLoading}
              />
            ))}
          </div>
          <div className="section-note">
            <p>Suspended characters cannot be selected or managed at this time.</p>
          </div>
        </section>
      )}
      
      {/* Roster Summary */}
      {hasCharacters && (
        <div className="roster-summary">
          <p>
            You have {characters.length} character{characters.length !== 1 ? 's' : ''} total.
            {activeCharacterId && (
              <span> Currently playing as <strong>{
                characters.find(c => c.id === activeCharacterId)?.name || 'Unknown'
              }</strong>.</span>
            )}
          </p>
        </div>
      )}
    </div>
  )
}

export default CharacterRoster