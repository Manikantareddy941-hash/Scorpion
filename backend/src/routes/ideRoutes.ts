import { Router, Request, Response, NextFunction } from 'express';
import { runScanPipeline } from '../scanners/pipeline';
import { secretMatches } from '../utils/constantTimeCompare';
import { parseSemgrep, parseGitleaks, parseTrivy } from '../services/scan/parsers';
import { databases, DB_ID, COLLECTIONS, ID } from '../lib/appwrite';
import { deduplicateFindings, NormalizedVulnerability } from '../deduplication';
import { logger, errorContext } from '../services/logger';

const IDE_SEVERITIES: IDEFinding['severity'][] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
function toIDESeverity(severity: string): IDEFinding['severity'] {
  const upper = severity.toUpperCase();
  return (IDE_SEVERITIES as string[]).includes(upper) ? (upper as IDEFinding['severity']) : 'LOW';
}

const router = Router();

const LOOPBACK = new Set(['::1', '127.0.0.1', '::ffff:127.0.0.1']);

/**
 * Guards the IDE scan endpoint, which reads an arbitrary filesystem path off the
 * request body and returns what it finds there.
 *
 * The previous gate checked `req.ip` and `req.hostname`. Both are derived from
 * attacker-controlled headers: `req.hostname` is the Host header, and `req.ip`
 * honours X-Forwarded-For because index.ts sets `trust proxy`. Either one alone
 * turned this into unauthenticated local file disclosure. The TCP peer address
 * cannot be forged, so that is what the loopback check now uses.
 *
 * Behind a reverse proxy every request arrives *from* loopback, so in production
 * the peer check proves nothing and a shared secret is the only real control —
 * hence production refuses to serve this route until IDE_SCAN_SECRET is set.
 * Local development keeps working with no configuration.
 */
export function verifyIdeAccess(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.IDE_SCAN_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction || secret) {
    if (!secret) {
      logger.error('[IDE] IDE_SCAN_SECRET is not configured — refusing IDE scan requests in production');
      return res.status(503).json({ error: 'IDE integration is not configured on this server' });
    }
    if (!secretMatches(req.headers['x-ide-secret'], secret)) {
      return res.status(401).json({ error: 'Unauthorized IDE client' });
    }
    return next();
  }

  if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) {
    return res.status(403).json({ error: 'Access denied: IDE integration must be local.' });
  }
  next();
}

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
const mapToIDEFinding = (vuln: NormalizedVulnerability): IDEFinding => {
  // Determine type based on source scanner(s)
  const source = vuln.scanner?.toLowerCase() ?? '';
  let type: 'sast' | 'sca' | 'secret' = 'sast';
  if (source.includes('gitleaks') || source.includes('secret')) type = 'secret';
  else if (source.includes('trivy') || source.includes('sca')) type = 'sca';

  return {
    id: vuln.hash,
    type,
    severity: toIDESeverity(vuln.severity),
    title: vuln.title,
    file: vuln.filePath,
    line: vuln.line,
    message: vuln.description || vuln.title,
  };
};

router.post('/scan', verifyIdeAccess, async (req: Request, res: Response) => {
  const { path: localPath, repoId, repoUrl } = req.body;

  if (!localPath) {
    return res.status(400).json({ error: 'Path is required' });
  }

  try {
    // Run the scanners inside a Docker container (or local pipeline)
    const results = await runScanPipeline({ localPath });

    // Collect raw findings in a normalized shape
    interface RawFinding {
      filePath: string;
      line: number;
      severity: string;
      scanner: string;
      ruleId: string;
      title: string;
      description: string;
    }
    const rawFindings: RawFinding[] = [];

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

  } catch (error: unknown) {
    logger.error('[IDE Route] Scan failed:', {
      event: 'IDE_SCAN_FAILED',
      repoId: repoId || 'local_workspace',
      ...errorContext(error),
    });
    res.status(500).json({ error: 'Scan failed' });
  }
});

export default router;
