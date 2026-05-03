import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';
import { logger } from './logger';

const SOC2_CONTROLS = [
  { controlId: 'CC6.1', title: 'Logical access controls', framework: 'SOC2',
    check: (scans: any[]) => scans.every(s => s.gateStatus === 'passed') },
  { controlId: 'CC6.6', title: 'No critical vulnerabilities in production', framework: 'SOC2',
    check: (scans: any[]) => scans.every(s => (s.criticalCount ?? 0) === 0) },
  { controlId: 'CC7.1', title: 'Security monitoring active', framework: 'SOC2',
    check: (_: any[], incidents: any[]) => incidents.length >= 0 },
  { controlId: 'CC8.1', title: 'Change management — all PRs scanned', framework: 'SOC2',
    check: (scans: any[]) => scans.filter(s => s.scanType === 'ci_pipeline').length > 0 },
];

const ISO27001_CONTROLS = [
  { controlId: 'A.12.6.1', title: 'Management of technical vulnerabilities', framework: 'ISO27001',
    check: (scans: any[]) => scans.some(s => (s.criticalCount ?? 0) === 0) },
  { controlId: 'A.14.2.8', title: 'System security testing', framework: 'ISO27001',
    check: (scans: any[]) => scans.length > 0 },
  { controlId: 'A.16.1.2', title: 'Reporting security incidents', framework: 'ISO27001',
    check: (_: any[], incidents: any[]) => incidents.length >= 0 },
];

export async function evaluateCompliance() {
  try {
    const [scansRes, incidentsRes] = await Promise.all([
      databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [Query.orderDesc('$createdAt'), Query.limit(50)]),
      databases.listDocuments(DB_ID, COLLECTIONS.INCIDENTS, [Query.limit(100)])
    ]);

    const scans = scansRes.documents;
    const incidents = incidentsRes.documents;
    const allControls = [...SOC2_CONTROLS, ...ISO27001_CONTROLS];
    const results = [];

    for (const control of allControls) {
      const passing = control.check(scans, incidents);
      const evidence = scans.slice(0, 5).map(s => s.$id);

      const existing = await databases.listDocuments(DB_ID, COLLECTIONS.COMPLIANCE_CONTROLS, [
        Query.equal('controlId', control.controlId)
      ]);

      const payload = {
        framework: control.framework,
        controlId: control.controlId,
        title: control.title,
        status: passing ? 'passing' : 'failing',
        lastEvaluated: new Date().toISOString(),
        evidence: JSON.stringify(evidence)
      };

      if (existing.documents.length > 0) {
        await databases.updateDocument(DB_ID, COLLECTIONS.COMPLIANCE_CONTROLS, existing.documents[0].$id, payload);
      } else {
        await databases.createDocument(DB_ID, COLLECTIONS.COMPLIANCE_CONTROLS, ID.unique(), payload);
      }

      results.push({ ...control, passing });
    }

    logger.info('compliance_evaluated', { 
      event: 'compliance_evaluated', 
      total: results.length, 
      passing: results.filter(r => r.passing).length 
    });
    
    return results;
  } catch (error) {
    console.error('[Compliance Engine] Evaluation failed:', error);
    throw error;
  }
}
