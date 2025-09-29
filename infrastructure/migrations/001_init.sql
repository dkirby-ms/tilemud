-- Initial baseline migration for TileMUD
-- Migration: 001_init.sql
-- Purpose: Establish baseline database structure

-- Enable useful PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create a simple metadata table to track migration system status
CREATE TABLE IF NOT EXISTS migration_metadata (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert baseline metadata
INSERT INTO migration_metadata (key, value) 
VALUES ('database_initialized', 'true')
ON CONFLICT (key) DO UPDATE SET 
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;

-- Log successful initialization
INSERT INTO migration_metadata (key, value) 
VALUES ('last_migration', '001_init.sql')
ON CONFLICT (key) DO UPDATE SET 
    value = EXCLUDED.value,
    updated_at = CURRENT_TIMESTAMP;