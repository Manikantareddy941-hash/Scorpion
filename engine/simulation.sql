-- Simulate 30 mins age for scanning jobs to trigger Zombie Sweeper
UPDATE scans SET updated_at = NOW() - INTERVAL '30 minutes' WHERE status = 'scanning';

-- View current state
SELECT id, status, updated_at FROM scans ORDER BY updated_at DESC;
