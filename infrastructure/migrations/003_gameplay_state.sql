-- Gameplay state migration
-- Migration: 003_gameplay_state.sql
-- Purpose: Introduce character profile and action event persistence

CREATE TABLE IF NOT EXISTS character_profiles (
    character_id UUID PRIMARY KEY,
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    position_x INTEGER NOT NULL,
    position_y INTEGER NOT NULL,
    health INTEGER NOT NULL,
    inventory_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    stats_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

LOCK TABLE character_profiles IN ACCESS EXCLUSIVE MODE;

CREATE INDEX IF NOT EXISTS character_profiles_user_id_idx ON character_profiles (user_id);

CREATE TABLE IF NOT EXISTS action_events (
    action_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    character_id UUID NOT NULL,
    sequence_number BIGINT NOT NULL,
    action_type TEXT NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    persisted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

LOCK TABLE action_events IN ACCESS EXCLUSIVE MODE;

-- Backfill / align schema when action_events existed before this migration ran
ALTER TABLE action_events
    ADD COLUMN IF NOT EXISTS session_id UUID;

UPDATE action_events
SET session_id = uuid_generate_v4()
WHERE session_id IS NULL;

ALTER TABLE action_events
    ALTER COLUMN session_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS action_events_session_sequence_idx ON action_events (session_id, sequence_number);
CREATE INDEX IF NOT EXISTS action_events_character_sequence_idx ON action_events (character_id, sequence_number DESC);
CREATE INDEX IF NOT EXISTS action_events_persisted_at_idx ON action_events (persisted_at);

INSERT INTO migration_metadata (key, value)
VALUES ('last_migration', '003_gameplay_state.sql')
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;
