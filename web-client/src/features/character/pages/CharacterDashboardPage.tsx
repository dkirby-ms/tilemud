/**
 * Character Dashboard Page
 * 
 * Main dashboard page that composes the character creation form, character roster,
 * outage banner, and diagnostics into a cohesive user experience. This page serves
 * as the primary interface for character management after authentication.
 */

import React from 'react';
import { useCharacterStore } from '../state/characterStore';
import { CharacterCreationForm } from '../components/CharacterCreationForm';
import { CharacterRoster } from '../components/CharacterRoster';
import { OutageBanner } from '../components/OutageBanner';
import { DiagnosticsOverlay } from '../../diagnostics/DiagnosticsOverlay';
import type { CreateCharacterRequest } from '../../../types/domain';
import './CharacterDashboardPage.css';

interface CharacterDashboardPageProps {
  /** Optional className for custom styling */
  className?: string;
}

export const CharacterDashboardPage: React.FC<CharacterDashboardPageProps> = ({
  className = '',
}) => {
  const {
    player,
    archetypeCatalog,
    serviceHealth,
    playerLoading,
    createCharacterLoading,
    loadPlayer,
    loadArchetypeCatalog,
    loadServiceHealth,
    createCharacter,
    selectCharacter,
  } = useCharacterStore();

  const [showCreateForm, setShowCreateForm] = React.useState<boolean>(false);
  const [showDiagnostics, setShowDiagnostics] = React.useState<boolean>(false);
  const diagnosticsOverlayEnabled = false; // Disabled temporarily until infinite loop issue is resolved

  // Load data on mount
  React.useEffect(() => {
    const loadData = async () => {
      try {
        await Promise.all([
          loadPlayer(),
          loadArchetypeCatalog(),
          loadServiceHealth(),
        ]);
      } catch (err) {
        console.error('Failed to load data on dashboard mount:', err);
      }
    };
    loadData();
  }, [loadPlayer, loadArchetypeCatalog, loadServiceHealth]);

  // Determine if we should auto-show creation form for first-time users
  const characters = player?.characters || [];
  const shouldShowCreateForm = React.useMemo(() => {
    return showCreateForm || (characters.length === 0 && !playerLoading.isLoading && !playerLoading.error);
  }, [showCreateForm, characters.length, playerLoading.isLoading, playerLoading.error]);

  // Handle creation form completion
  const handleCharacterCreated = React.useCallback(() => {
    setShowCreateForm(false);
  }, []);

  // Handle create new character button
  const handleCreateNewCharacter = React.useCallback(() => {
    setShowCreateForm(true);
  }, []);

  // Handle character creation form submission
  const handleCreateCharacterSubmit = React.useCallback(async (
    characterData: CreateCharacterRequest & { description?: string }
  ) => {
    const result = await createCharacter(characterData);
    if (result) {
      handleCharacterCreated();
    }
  }, [createCharacter, handleCharacterCreated]);

  // Handle character selection
  const handleSelectCharacter = React.useCallback(async (characterId: string) => {
    await selectCharacter(characterId);
  }, [selectCharacter]);

  // Handle service health refresh
  const handleRefreshServiceHealth = React.useCallback(async () => {
    await loadServiceHealth();
  }, [loadServiceHealth]);

  // Handle diagnostics toggle
  const handleToggleDiagnostics = React.useCallback((visible: boolean) => {
    setShowDiagnostics(visible);
  }, []);

  // Check if service is experiencing outages
  const hasOutage = serviceHealth?.status !== 'healthy';
  const activeCharacterId = player?.activeCharacterId || null;

  return (
    <div className={`dashboard-page ${className}`.trim()}>
      {/* Service Status Banner */}
      {hasOutage && serviceHealth && (
        <div className="dashboard-page__banner">
          <OutageBanner
            serviceHealth={serviceHealth}
            outage={serviceHealth.outage}
            onRefresh={handleRefreshServiceHealth}
            isRefreshing={false}
          />
        </div>
      )}

      {/* Main Content */}
      <main className="dashboard-page__main" role="main">
        <div className="dashboard-page__container">
          {/* Page Header */}
          <header className="dashboard-page__header">
            <h1 className="dashboard-page__title">Character Dashboard</h1>
            <p className="dashboard-page__subtitle">
              Manage your characters and start your adventure
            </p>
          </header>

          {/* Error Display */}
          {playerLoading.error && (
            <div className="dashboard-page__error" role="alert">
              <div className="error-banner">
                <div className="error-banner__content">
                  <h2 className="error-banner__title">Something went wrong</h2>
                  <p className="error-banner__message">
                    {playerLoading.error}
                  </p>
                </div>
                <button 
                  className="error-banner__dismiss"
                  onClick={() => {/* TODO: Add clear error functionality */}}
                  aria-label="Dismiss error"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Character Creation Form */}
          {shouldShowCreateForm && (
            <section 
              className="dashboard-page__creation"
              aria-labelledby="creation-heading"
            >
              <h2 id="creation-heading" className="sr-only">
                Create New Character
              </h2>
              <CharacterCreationForm
                onSubmit={handleCreateCharacterSubmit}
                archetypes={archetypeCatalog?.archetypes || []}
                isSubmitting={createCharacterLoading.isLoading}
                error={createCharacterLoading.error ? new Error(createCharacterLoading.error) : null}
                className={hasOutage ? 'form--disabled' : ''}
              />
              {characters.length > 0 && (
                <button
                  className="dashboard-page__cancel-create"
                  onClick={() => setShowCreateForm(false)}
                  type="button"
                >
                  Cancel
                </button>
              )}
            </section>
          )}

          {/* Character Roster */}
          {!shouldShowCreateForm && (
            <section 
              className="dashboard-page__roster"
              aria-labelledby="roster-heading"
            >
              <div className="dashboard-page__roster-header">
                <h2 id="roster-heading" className="dashboard-page__section-title">
                  Your Characters
                </h2>
                <button
                  className="dashboard-page__create-button"
                  onClick={handleCreateNewCharacter}
                  disabled={hasOutage}
                  type="button"
                >
                  Create New Character
                </button>
              </div>
              
              <CharacterRoster
                characters={characters}
                activeCharacterId={activeCharacterId}
                onSelectCharacter={handleSelectCharacter}
                isLoading={playerLoading.isLoading}
                error={playerLoading.error ? new Error(playerLoading.error) : null}
              />
            </section>
          )}

          {/* Loading State */}
          {playerLoading.isLoading && !playerLoading.error && (
            <div className="dashboard-page__loading" role="status" aria-label="Loading characters">
              <div className="loading-spinner">
                <div className="loading-spinner__icon" aria-hidden="true"></div>
                <span className="loading-spinner__text">Loading characters...</span>
              </div>
            </div>
          )}

          {/* Empty State for Users with Characters but None Visible */}
          {!playerLoading.isLoading && !playerLoading.error && !shouldShowCreateForm && characters.length === 0 && (
            <div className="dashboard-page__empty">
              <div className="empty-state">
                <div className="empty-state__icon" aria-hidden="true">🎭</div>
                <h2 className="empty-state__title">No Characters Yet</h2>
                <p className="empty-state__description">
                  Create your first character to begin your adventure in TileMUD.
                </p>
                <button
                  className="empty-state__action"
                  onClick={handleCreateNewCharacter}
                  disabled={hasOutage}
                  type="button"
                >
                  Create Your First Character
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Diagnostics Panel - Development Only */}
      {showDiagnostics && typeof window !== 'undefined' && (
        <aside className="dashboard-page__diagnostics" aria-label="Development diagnostics">
          <div className="diagnostics-panel">
            <h3 className="diagnostics-panel__title">Diagnostics</h3>
            <dl className="diagnostics-panel__stats">
              <dt>Characters Loaded:</dt>
              <dd>{characters.length}</dd>
              <dt>Loading:</dt>
              <dd>{playerLoading.isLoading ? 'Yes' : 'No'}</dd>
              <dt>Error:</dt>
              <dd>{playerLoading.error ? 'Yes' : 'No'}</dd>
              <dt>Service Health:</dt>
              <dd>{serviceHealth?.status || 'Unknown'}</dd>
              <dt>Render Time:</dt>
              <dd id="render-timestamp">{new Date().toLocaleTimeString()}</dd>
            </dl>
          </div>
        </aside>
      )}

      {/* Diagnostics Overlay - Disabled due to infinite loop issue */}
      {diagnosticsOverlayEnabled ? (
        <DiagnosticsOverlay
          isVisible={showDiagnostics}
          onToggle={handleToggleDiagnostics}
          position="top-right"
        />
      ) : null}
    </div>
  );
};

export default CharacterDashboardPage;