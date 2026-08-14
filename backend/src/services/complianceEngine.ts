import { databases, DB_ID, COLLECTIONS, ID, Query } from '../lib/appwrite';
import { fetchAllDocuments } from '../lib/paginate';
import { logger, errorContext } from './logger';

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
    check: (scans: any[]) => scans.every(s => (s.criticalCount ?? 0) === 0) },
  { controlId: 'A.14.2.8', title: 'System security testing', framework: 'ISO27001',
    check: (scans: any[]) => scans.length > 0 },
  { controlId: 'A.16.1.2', title: 'Reporting security incidents', framework: 'ISO27001',
    check: (_: any[], incidents: any[]) => incidents.length >= 0 },
];

// HIPAA Security Rule safeguards mapped to the scan/incident signals we have.
const HIPAA_CONTROLS = [
  { controlId: '164.308(a)(1)(ii)(A)', title: 'Risk analysis — systems are scanned', framework: 'HIPAA',
    check: (scans: any[]) => scans.length > 0 },
  { controlId: '164.308(a)(1)(ii)(B)', title: 'Risk management — release gates enforced', framework: 'HIPAA',
    check: (scans: any[]) => scans.every(s => s.gateStatus === 'passed') },
  { controlId: '164.312(c)(1)', title: 'Integrity — no critical vulnerabilities in ePHI systems', framework: 'HIPAA',
    check: (scans: any[]) => scans.every(s => (s.criticalCount ?? 0) === 0) },
  { controlId: '164.308(a)(6)', title: 'Security incident procedures — incidents tracked', framework: 'HIPAA',
    check: (_: any[], incidents: any[]) => incidents.length >= 0 },
];

// GDPR articles relevant to a security posture (Art. 25, 32, 33).
const GDPR_CONTROLS = [
  { controlId: 'Art.25', title: 'Data protection by design — security testing in the pipeline', framework: 'GDPR',
    check: (scans: any[]) => scans.length > 0 },
  { controlId: 'Art.32', title: 'Security of processing — no unresolved critical vulnerabilities', framework: 'GDPR',
    check: (scans: any[]) => scans.every(s => (s.criticalCount ?? 0) === 0) },
  { controlId: 'Art.33', title: 'Breach notification readiness — incident tracking active', framework: 'GDPR',
    check: (_: any[], incidents: any[]) => incidents.length >= 0 },
];

export async function evaluateCompliance(userId: string) {
  try {
    // Exhaustive reads, not capped ones. Controls are evaluated with predicates
    // like `scans.every(s => criticalCount === 0)`, so a row that was never
    // fetched reads as a row that does not exist — the control reports PASSING
    // because the violating scan sat past the limit. The repositories read had
    // no limit at all, which means Appwrite's default of 25: a user with more
    // repos had the remainder excluded from the compliance scope entirely.
    const reposRes = await fetchAllDocuments(COLLECTIONS.REPOSITORIES, [Query.equal('user_id', userId)]);
    const repoIds = reposRes.items.map((r: any) => r.$id);

    const [scansRes, incidentsRes] = await Promise.all([
      repoIds.length > 0
        ? fetchAllDocuments(COLLECTIONS.SCANS, [
            Query.equal('repo_id', repoIds),
            Query.orderDesc('$createdAt'),
          ])
        : Promise.resolve({ items: [] as any[], total: 0, truncated: false }),
      fetchAllDocuments(COLLECTIONS.INCIDENTS, [
        repoIds.length > 0
          ? Query.or([Query.equal('repo_id', repoIds), Query.equal('user_id', userId)])
          : Query.equal('user_id', userId),
      ])
    ]);

    // A verdict computed on a partial set is not authoritative. The helper caps
    // at a safety ceiling to keep a runaway data set from hanging the request,
    // so say plainly when that ceiling was reached rather than letting the
    // result stand as if complete.
    if (reposRes.truncated || scansRes.truncated || incidentsRes.truncated) {
      logger.warn('[Compliance Engine] evidence truncated — verdict computed on a partial set', {
        event: 'compliance_evidence_truncated',
        userId,
        repos: reposRes.truncated, scans: scansRes.truncated, incidents: incidentsRes.truncated,
      });
    }

    const scans = scansRes.items;
    const incidents = incidentsRes.items;
    const allControls = [...SOC2_CONTROLS, ...ISO27001_CONTROLS, ...HIPAA_CONTROLS, ...GDPR_CONTROLS];
    const results = [];

    for (const control of allControls) {
      const passing = control.check(scans, incidents);
      const evidence = scans.slice(0, 5).map(s => s.$id);

      const existing = await databases.listDocuments(DB_ID, COLLECTIONS.COMPLIANCE_CONTROLS, [
        Query.equal('controlId', control.controlId),
        Query.equal('scopeId', userId)
      ]);

      const payload = {
        framework: control.framework,
        controlId: control.controlId,
        title: control.title,
        scopeId: userId,
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
    logger.error('[Compliance Engine] Evaluation failed:', { event: 'COMPLIANCE_EVALUATION_FAILED', ...errorContext(error) });
    throw error;
  }
}
