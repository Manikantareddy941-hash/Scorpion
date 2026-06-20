import { Router, Request, Response } from 'express';
import { runScanPipeline } from '../scanners/pipeline';
import { parseSemgrep, parseGitleaks, parseTrivy, Finding as BaseFinding } from '../services/scan/parsers';
import { databases, DB_ID, COLLECTIONS, ID } from '../lib/appwrite';
import { deduplicateFindings } from '../deduplication';
import { logger } from '../services/logger';

const router = Router();

export interface IDEFinding {
  id: string;
  type: 'sast' | 'sca' | 'secret';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  file: string;
  line: number;
  message: string;
}

/**
 * Map NormalizedVulnerability to the shape expected by the VS Code extension.
 */
const mapToIDEFinding = (vuln: any): IDEFinding => {
  // Determine type based on source scanner(s)
  const source = (vuln.scanner?.toLowerCase() || (Array.isArray(vuln.sources) && vuln.sources[0]?.toLowerCase())) ?? '';
  let type: 'sast' | 'sca' | 'secret' = 'sast';
  if (source.includes('gitleaks') || source.includes('secret')) type = 'secret';
  else if (source.includes('trivy') || source.includes('sca')) type = 'sca';

  return {
    id: vuln.hash,
    type,
    severity: vuln.severity as any,
    title: vuln.title,
    file: vuln.filePath,
    line: vuln.line,
    message: vuln.description || vuln.title,
  };
};;

router.post('/scan', async (req: Request, res: Response) => {
  const { path: localPath, repoId, repoUrl } = req.body;

  // Security Gate: Localhost only for filesystem access
  const isLocal = req.ip === '::1' || req.ip === '127.0.0.1' || req.hostname === 'localhost';
  if (!isLocal) {
    return res.status(403).json({ error: 'Access denied: IDE integration must be local.' });
  }

  if (!localPath) {
    return res.status(400).json({ error: 'Path is required' });
  }

  try {
    // Run the scanners inside a Docker container (or local pipeline)
    const results = await runScanPipeline({ localPath });

    // Collect raw findings in a normalized shape
    const rawFindings: any[] = [];

    // Normalize Semgrep findings
    if (results.semgrep && results.semgrep.results) {
      const parsed = parseSemgrep(JSON.stringify(results.semgrep));
      parsed.forEach((f, index) => {
        rawFindings.push({
          filePath: f.file_path || '',
          line: f.line_number || 0,
          severity: f.severity?.toUpperCase() ?? 'INFO',
          scanner: 'semgrep',
          ruleId: f.tool ?? `semgrep-${index}`,
          title: f.message ?? f.message ?? '',
          description: f.message ?? ''
        });
      });
    }

    // Normalize Gitleaks findings
    if (Array.isArray(results.gitleaks)) {
      const parsed = parseGitleaks(JSON.stringify(results.gitleaks));
      parsed.forEach((f, index) => {
        rawFindings.push({
          filePath: f.file_path || '',
          line: f.line_number || 0,
          severity: 'CRITICAL',
          scanner: 'gitleaks',
          ruleId: f.tool ?? `gitleaks-${index}`,
          title: f.message ?? f.message ?? '',
          description: f.message ?? ''
        });
      });
    }

    // Normalize Trivy findings
    if (results.trivy && results.trivy.Results) {
      const parsed = parseTrivy(JSON.stringify(results.trivy));
      parsed.forEach((f, index) => {
        rawFindings.push({
          filePath: f.file_path || '',
          line: f.line_number || 0,
          severity: f.severity?.toUpperCase() ?? 'INFO',
          scanner: 'trivy',
          ruleId: f.tool ?? `trivy-${index}`,
          title: f.message ?? f.message ?? '',
          description: f.message ?? ''
        });
      });
    }

    // Deduplicate and map to IDE finding format
    const deduped = deduplicateFindings(rawFindings);
    const findings: IDEFinding[] = deduped.map(mapToIDEFinding);

    const criticalCount = findings.filter(f => f.severity === 'CRITICAL').length;
    const highCount = findings.filter(f => f.severity === 'HIGH').length;
    const mediumCount = findings.filter(f => f.severity === 'MEDIUM').length;
    const lowCount = findings.filter(f => f.severity === 'LOW').length;

    // Store results in Appwrite
    await databases.createDocument(DB_ID, COLLECTIONS.SCANS, ID.unique(), {
      repo_id: repoId || 'local_workspace',
      repoUrl: repoUrl || localPath,
      status: 'completed',
      scan_type: 'ide',
      scanType: 'ide',
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      details: JSON.stringify({
        path: localPath,
        vulnerability_count: findings.length,
        tools: ['semgrep', 'gitleaks', 'trivy']
      }),
      timestamp: new Date().toISOString()
    });

    res.json({ findings });
    
// Duplicate processing block removed – deduplication already performed above

  } catch (error: any) {
    logger.error('[IDE Route] Scan failed:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
