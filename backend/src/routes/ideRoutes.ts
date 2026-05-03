import { Router, Request, Response } from 'express';
import { runScanPipeline } from '../scanners/pipeline';
import { parseSemgrep, parseGitleaks, parseTrivy, Finding as BaseFinding } from '../services/scan/parsers';
import { databases, DB_ID, COLLECTIONS, ID } from '../lib/appwrite';

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
    const results = await runScanPipeline({ localPath });
    
    const findings: IDEFinding[] = [];

    // Normalize Semgrep
    if (results.semgrep && results.semgrep.results) {
      const parsed = parseSemgrep(JSON.stringify(results.semgrep));
      parsed.forEach((f, index) => {
        findings.push({
          id: `semgrep-${index}`,
          type: 'sast',
          severity: f.severity.toUpperCase() as any,
          title: 'SAST Finding',
          file: f.file_path || '',
          line: f.line_number || 0,
          message: f.message
        });
      });
    }

    // Normalize Gitleaks
    if (Array.isArray(results.gitleaks)) {
      const parsed = parseGitleaks(JSON.stringify(results.gitleaks));
      parsed.forEach((f, index) => {
        findings.push({
          id: `gitleaks-${index}`,
          type: 'secret',
          severity: 'CRITICAL',
          title: 'Secret Detected',
          file: f.file_path || '',
          line: f.line_number || 0,
          message: f.message
        });
      });
    }

    // Normalize Trivy
    if (results.trivy && results.trivy.Results) {
      const parsed = parseTrivy(JSON.stringify(results.trivy));
      parsed.forEach((f, index) => {
        findings.push({
          id: `trivy-${index}`,
          type: 'sca',
          severity: f.severity.toUpperCase() as any,
          title: 'Vulnerability Detected',
          file: f.file_path || '',
          line: f.line_number || 0,
          message: f.message
        });
      });
    }

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
  } catch (error: any) {
    console.error('[IDE Route] Scan failed:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
