-- Add local_path to repositories to track extracted code for ingestion
ALTER TABLE repositories 
ADD COLUMN IF NOT EXISTS local_path TEXT;

COMMENT ON COLUMN repositories.local_path IS 'Local filesystem path to extracted code for uploaded repositories';
