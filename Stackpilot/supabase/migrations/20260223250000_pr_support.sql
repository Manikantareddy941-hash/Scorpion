-- Migration: Automated PR Support
-- Created: 2026-02-23

-- Add PR-related columns to vulnerability_fixes
ALTER TABLE vulnerability_fixes 
ADD COLUMN IF NOT EXISTS pr_url TEXT,
ADD COLUMN IF NOT EXISTS pr_status TEXT DEFAULT 'pending' CHECK (pr_status IN ('pending', 'opened', 'merged', 'closed', 'failed')),
ADD COLUMN IF NOT EXISTS branch_name TEXT;

-- Create an index on pr_status for filtering
CREATE INDEX IF NOT EXISTS idx_vulnerability_fixes_pr_status ON vulnerability_fixes(pr_status);
