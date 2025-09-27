-- Migration: 001_initial_schema.sql
-- Created: 2025-09-26
-- Description: Initial database schema for TileMUD backend

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Players table
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  display_name VARCHAR(32) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_login_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'banned', 'dormant')),
  block_list_version INTEGER DEFAULT 0
);

CREATE UNIQUE INDEX idx_players_display_name ON players(LOWER(display_name));
CREATE INDEX idx_players_status ON players(status);
CREATE INDEX idx_players_last_login ON players(last_login_at);

-- Guilds table
CREATE TABLE guilds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(32) NOT NULL,
  leader_player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  member_count INTEGER DEFAULT 1 CHECK (member_count >= 0)
);

CREATE UNIQUE INDEX idx_guilds_name_active ON guilds(LOWER(name)) WHERE deleted_at IS NULL;
CREATE INDEX idx_guilds_leader ON guilds(leader_player_id);
CREATE INDEX idx_guilds_created_at ON guilds(created_at);

-- Guild memberships table
CREATE TABLE guild_memberships (
  player_id UUID REFERENCES players(id) ON DELETE CASCADE,
  guild_id UUID REFERENCES guilds(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('leader', 'officer', 'veteran', 'member')),
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (player_id, guild_id)
);

CREATE INDEX idx_guild_memberships_guild ON guild_memberships(guild_id, role);

-- Block list entries table  
CREATE TABLE block_list_entries (
  owner_player_id UUID REFERENCES players(id) ON DELETE CASCADE,
  blocked_player_id UUID REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (owner_player_id, blocked_player_id),
  CHECK (owner_player_id != blocked_player_id)
);

CREATE INDEX idx_block_list_owner ON block_list_entries(owner_player_id);

-- Rule config versions table
CREATE TABLE rule_config_versions (
  version_id VARCHAR(20) PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  checksum VARCHAR(64) NOT NULL,
  config JSONB NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT false
);

CREATE INDEX idx_rule_config_active ON rule_config_versions(is_active);
CREATE INDEX idx_rule_config_created ON rule_config_versions(created_at DESC);

-- Instances table
CREATE TABLE instances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mode VARCHAR(20) NOT NULL DEFAULT 'battle' CHECK (mode IN ('battle', 'arena')),
  state VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'active', 'resolved', 'aborted')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  resolved_at TIMESTAMP WITH TIME ZONE,
  rule_config_version VARCHAR(20) NOT NULL REFERENCES rule_config_versions(version_id),
  replay_id UUID,
  initial_human_count INTEGER NOT NULL CHECK (initial_human_count > 0),
  shard_key VARCHAR(100) NOT NULL
);

CREATE INDEX idx_instances_state ON instances(state);
CREATE INDEX idx_instances_shard ON instances(shard_key);
CREATE INDEX idx_instances_created ON instances(created_at DESC);

-- Arenas table
CREATE TABLE arenas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tier VARCHAR(20) NOT NULL CHECK (tier IN ('small', 'large', 'epic')),
  current_human_count INTEGER DEFAULT 0 CHECK (current_human_count >= 0),
  current_ai_count INTEGER DEFAULT 0 CHECK (current_ai_count >= 0),
  region VARCHAR(50) NOT NULL,
  shard_key VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_arenas_tier_region ON arenas(tier, region);
CREATE INDEX idx_arenas_shard ON arenas(shard_key);
CREATE INDEX idx_arenas_utilization ON arenas(tier, current_human_count);

-- AI entities table
CREATE TABLE ai_entities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  instance_id UUID REFERENCES instances(id) ON DELETE CASCADE,
  arena_id UUID REFERENCES arenas(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  spawned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  despawned_at TIMESTAMP WITH TIME ZONE,
  config JSONB,
  CHECK ((instance_id IS NOT NULL AND arena_id IS NULL) OR (instance_id IS NULL AND arena_id IS NOT NULL))
);

CREATE INDEX idx_ai_entities_instance ON ai_entities(instance_id) WHERE instance_id IS NOT NULL;
CREATE INDEX idx_ai_entities_arena ON ai_entities(arena_id) WHERE arena_id IS NOT NULL;
CREATE INDEX idx_ai_entities_active ON ai_entities(spawned_at) WHERE despawned_at IS NULL;

-- Chat channels table
CREATE TABLE chat_channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_type VARCHAR(20) NOT NULL CHECK (channel_type IN ('private', 'guild', 'party', 'arena', 'system')),
  scope_ref UUID, -- References guild_id, arena_id, etc.
  retention_policy VARCHAR(20) NOT NULL CHECK (retention_policy IN ('private7d', 'guild7d', 'party24h', 'public12h', 'system30d')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_active_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_chat_channels_type_scope ON chat_channels(channel_type, scope_ref);

-- Chat messages table
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  sender_player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  seq BIGSERIAL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  content TEXT NOT NULL CHECK (LENGTH(content) <= 512),
  edited_at TIMESTAMP WITH TIME ZONE,
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE UNIQUE INDEX idx_chat_messages_channel_seq ON chat_messages(channel_id, seq);
CREATE INDEX idx_chat_messages_sender ON chat_messages(sender_player_id);
CREATE INDEX idx_chat_messages_created ON chat_messages(created_at);

-- Add partial index for message retention cleanup
CREATE INDEX idx_chat_messages_retention_private ON chat_messages(created_at) 
  WHERE created_at < NOW() - INTERVAL '7 days' 
  AND channel_id IN (SELECT id FROM chat_channels WHERE retention_policy = 'private7d');

CREATE INDEX idx_chat_messages_retention_guild ON chat_messages(created_at) 
  WHERE created_at < NOW() - INTERVAL '7 days' 
  AND channel_id IN (SELECT id FROM chat_channels WHERE retention_policy = 'guild7d');

-- Replay metadata table
CREATE TABLE replay_metadata (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  instance_id UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'recording' CHECK (status IN ('recording', 'completed', 'failed', 'purged')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  size_bytes INTEGER DEFAULT 0 CHECK (size_bytes >= 0),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  storage_ref VARCHAR(500) NOT NULL,
  event_count INTEGER CHECK (event_count >= 0),
  checksum VARCHAR(64)
);

CREATE UNIQUE INDEX idx_replay_metadata_instance ON replay_metadata(instance_id);
CREATE INDEX idx_replay_metadata_expires ON replay_metadata(expires_at) WHERE status = 'completed';
CREATE INDEX idx_replay_metadata_status ON replay_metadata(status);

-- Update instances table to reference replay_metadata
ALTER TABLE instances ADD CONSTRAINT fk_instances_replay 
  FOREIGN KEY (replay_id) REFERENCES replay_metadata(id) ON DELETE SET NULL;

-- Triggers for maintaining guild member count
CREATE OR REPLACE FUNCTION update_guild_member_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE guilds SET member_count = member_count + 1 WHERE id = NEW.guild_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE guilds SET member_count = member_count - 1 WHERE id = OLD.guild_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_guild_member_count
  AFTER INSERT OR DELETE ON guild_memberships
  FOR EACH ROW EXECUTE FUNCTION update_guild_member_count();

-- Function to auto-set retention policy based on channel type
CREATE OR REPLACE FUNCTION set_channel_retention_policy()
RETURNS TRIGGER AS $$
BEGIN
  NEW.retention_policy = CASE NEW.channel_type
    WHEN 'private' THEN 'private7d'
    WHEN 'guild' THEN 'guild7d'
    WHEN 'party' THEN 'party24h'
    WHEN 'arena' THEN 'public12h'
    WHEN 'system' THEN 'system30d'
    ELSE 'private7d'
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_retention_policy
  BEFORE INSERT ON chat_channels
  FOR EACH ROW EXECUTE FUNCTION set_channel_retention_policy();

-- Insert default rule config version
INSERT INTO rule_config_versions (version_id, checksum, config, description, is_active)
VALUES (
  '1.0.0',
  'default_config_checksum_placeholder_64_characters_long_string_here',
  '{
    "tile_tick_interval_ms": 100,
    "max_tiles_per_player": 100,
    "arena_capacity": {"small": 80, "large": 160, "epic": 300},
    "ai_capacity": {"small": 8, "standard": 16, "large": 40, "epic": 100}
  }'::jsonb,
  'Default game rules configuration',
  true
);

-- Create indexes for performance
CREATE INDEX CONCURRENTLY idx_instances_active ON instances(shard_key, state) WHERE state IN ('pending', 'active');
CREATE INDEX CONCURRENTLY idx_arenas_active ON arenas(region, tier, current_human_count);

COMMIT;