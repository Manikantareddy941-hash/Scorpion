// backend/src/services/containerizedTrivyService.ts
//
// Distinct from scanService.ts: that runs the main Semgrep/Trivy/Gitleaks pass
// directly via execFile. This runs a separate, Docker-sandboxed Trivy deep-scan
// step as one stage inside pipelineService.ts's orchestration.
import { dockerRunnerService } from './dockerRunnerService';
import { Databases, ID } from 'node-appwrite';
import fs from 'fs';
import path from 'path';

export class ContainerizedTrivyService {
  public async runTrivyScan(runId: string, workspacePath: string, logger: any, databases: Databases): Promise<number> {
    logger.log('[Security] Initializing containerized filesystem vulnerability scan...');
    
    const dbId = process.env.APPWRITE_DATABASE_ID || 'default';
    const reportName = `trivy-report-${runId}.json`;
    const hostReportPath = path.resolve(workspacePath, reportName);

    try {
      // Trivy needs its vulnerability database. With a warmed cache mounted it
      // runs fully offline, which is the goal: a scanner analysing hostile code
      // has no business holding an outbound socket. Without one it must reach
      // the registry, so the network is granted and the gap is stated loudly
      // rather than left as a silent exception to the deny-by-default rule.
      const dbCache = process.env.TRIVY_DB_CACHE;
      if (!dbCache) {
        logger.log(
          '[Security Warning] TRIVY_DB_CACHE is not set, so this scan container runs WITH network access. '
          + 'Point it at a warmed Trivy cache directory to run the scanner offline.',
        );
      }

      const result = await dockerRunnerService.runInContainer({
        image: 'aquasec/trivy:latest',
        cmd: [
          'fs', '--format', 'json', '--output', `/workspace/${reportName}`,
          ...(dbCache ? ['--skip-db-update', '--skip-java-db-update', '--cache-dir', '/trivy-cache'] : []),
          '/workspace',
        ],
        workspacePath,
        allowEgress: !dbCache,
        // Read-only: the scanner reads the database, it never updates it here.
        extraBinds: dbCache ? [`${dbCache}:/trivy-cache:ro`] : [],
        logger
      });

      if (!fs.existsSync(hostReportPath)) {
        logger.log('[Security Warning] Scanner did not output raw report context.');
        return 0;
      }

      const rawReport = fs.readFileSync(hostReportPath, 'utf8');
      const parsed = JSON.parse(rawReport);
      let issueCount = 0;

      if (parsed.Results) {
        for (const res of parsed.Results) {
          if (!res.Vulnerabilities) continue;
          for (const vul of res.Vulnerabilities) {
            if (['CRITICAL', 'HIGH'].includes(vul.Severity)) {
              issueCount++;
              await databases.createDocument(dbId, 'vulnerabilities', ID.unique(), {
                runId,
                source: 'trivy',
                severity: vul.Severity,
                title: `${vul.VulnerabilityID}: ${vul.Title || 'Unknown Threat'}`,
                package: vul.PkgName || 'N/A',
                description: (vul.Description || 'No metadata description provided.').substring(0, 4000)
              });
            }
          }
        }
      }

      logger.log(`[Security] Scan resolved. Found ${issueCount} CRITICAL/HIGH vulnerabilities saved to dashboard.`);
      return issueCount;
    } catch (err: any) {
      logger.log(`[Security Error] Scanner runtime failed: ${err.message}`);
      return 0;
    } finally {
      if (fs.existsSync(hostReportPath)) fs.unlinkSync(hostReportPath);
    }
  }
}

export const containerizedTrivyService = new ContainerizedTrivyService();
