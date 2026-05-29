// backend/src/services/securityScanService.ts
import { dockerRunnerService } from './dockerRunnerService';
import { Databases, ID } from 'node-appwrite';
import fs from 'fs';
import path from 'path';

export class SecurityScanService {
  public async runTrivyScan(runId: string, workspacePath: string, logger: any, databases: Databases): Promise<number> {
    logger.log('[Security] Initializing containerized filesystem vulnerability scan...');
    
    const dbId = process.env.APPWRITE_DATABASE_ID || 'default';
    const reportName = `trivy-report-${runId}.json`;
    const hostReportPath = path.resolve(workspacePath, reportName);

    try {
      const result = await dockerRunnerService.runInContainer({
        image: 'aquasec/trivy:latest',
        cmd: ['fs', '--format', 'json', '--output', `/workspace/${reportName}`, '/workspace'],
        workspacePath,
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

export const securityScanService = new SecurityScanService();
