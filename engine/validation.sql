-- Check status of the 3 scans
SELECT id, status, updated_at 
FROM scans 
WHERE id IN ('ca02c194-8799-43f2-9815-d7df9870a8a0', '86e5ede4-b0a1-44e3-899c-9493ccce6da4', '62319ae4-444e-44e5-8968-3eca05689d71');

-- Check finding counts
SELECT scan_id, tool_source, count(*) 
FROM vulnerabilities 
WHERE scan_id IN ('ca02c194-8799-43f2-9815-d7df9870a8a0', '86e5ede4-b0a1-44e3-899c-9493ccce6da4', '62319ae4-444e-44e5-8968-3eca05689d71') 
GROUP BY scan_id, tool_source;
