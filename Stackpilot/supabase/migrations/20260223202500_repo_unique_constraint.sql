-- Migration: Add Unique Constraint to Repositories
-- Required for upsert operations on user_id and url.

ALTER TABLE repositories 
ADD CONSTRAINT repositories_user_id_url_key UNIQUE (user_id, url);
