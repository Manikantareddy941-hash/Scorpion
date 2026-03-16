-- Add unique constraint to vulnerabilities to prevent duplicates during retries
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_vuln 
ON vulnerabilities (scan_id, tool_source, title, file_path, line_number);
