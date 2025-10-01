-- Game Backend Migration
-- Migration: 002_game_backend.sql
-- Purpose: Create core backend tables for multiplayer tile game

-- Enable useful PostgreSQL extensions if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Players table
CREATE TABLE IF NOT EXISTS players (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    display_name TEXT NOT NULL,
    initiative_rank INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for player name lookups (case-insensitive)
CREATE INDEX IF NOT EXISTS players_display_name_idx ON players (LOWER(display_name));

-- Rulesets table
CREATE TABLE IF NOT EXISTS rulesets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    version TEXT NOT NULL UNIQUE, -- semantic version MAJOR.MINOR.PATCH
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Battle outcomes table
CREATE TABLE IF NOT EXISTS battle_outcomes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    instance_id UUID NOT NULL,
    ruleset_version TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    duration_ms INTEGER NOT NULL,
    participants_json JSONB NOT NULL, -- array of player stats/roles
    outcome_json JSONB NOT NULL, -- scores, rewards
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for searching outcomes by participant players
CREATE INDEX IF NOT EXISTS battle_outcomes_player_search_idx ON battle_outcomes USING gin ((participants_json -> 'players'));

-- Private messages table
CREATE TABLE IF NOT EXISTS private_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id UUID NOT NULL REFERENCES players(id),
    recipient_id UUID NOT NULL REFERENCES players(id),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for message retrieval
CREATE INDEX IF NOT EXISTS private_messages_recipient_idx ON private_messages (recipient_id, created_at);
CREATE INDEX IF NOT EXISTS private_messages_sender_idx ON private_messages (sender_id, created_at);

-- Update migration metadata
INSERT INTO migration_metadata (key, value) 
VALUES ('last_migration', '002_game_backend.sql')
ON CONFLICT (key) DO UPDATE SET 
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;

-- Log successful migration
INSERT INTO migration_metadata (key, value) 
VALUES ('game_backend_initialized', 'true')
ON CONFLICT (key) DO UPDATE SET 
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;