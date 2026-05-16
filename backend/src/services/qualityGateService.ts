import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { ID, Query } from 'node-appwrite';
import { logger } from './logger';

export interface GateResult {
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  score: number; // 0-100
  security: 'A'|'B'|'C'|'D'|'F';
  reliability: 'A'|'B'|'C'|'D'|'F';
  maintainability: 'A'|'B'|'C'|'D'|'F';
  passed: boolean;
  breakdown: {
    critical: number; high: number;
    medium: number; low: number;
    secrets: number; codeSmells: number;
  };
}

export function calculateGrade(count: number, type: 'security'|'reliability'|'maintainability'): 'A'|'B'|'C'|'D'|'F' {
  if (type === 'security') {
    if (count === 0) return 'A';
    if (count <= 2) return 'B';
    if (count <= 5) return 'C';
    if (count <= 10) return 'D';
    return 'F';
  }
  if (type === 'reliability') {
    if (count === 0) return 'A';
    if (count <= 3) return 'B';
    if (count <= 8) return 'C';
    if (count <= 15) return 'D';
    return 'F';
  }
  // maintainability
  if (count === 0) return 'A';
  if (count <= 10) return 'B';
  if (count <= 25) return 'C';
  if (count <= 50) return 'D';
  return 'F';
}

export function gradeToScore(g: string): number {
  const scores: Record<string, number> = { A: 95, B: 80, C: 65, D: 45, F: 20 };
  return scores[g] ?? 0;
}

export async function evaluateQualityGate(scanId: string): Promise<GateResult> {
  const vulns = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
    Query.equal('scanId', scanId),
    Query.limit(1000)
  ]);

  const issues = vulns.documents;

  const breakdown = {
    critical: issues.filter(i => i.severity === 'CRITICAL').length,
    high:     issues.filter(i => i.severity === 'HIGH').length,
    medium:   issues.filter(i => i.severity === 'MEDIUM').length,
    low:      issues.filter(i => i.severity === 'LOW').length,
    secrets:  issues.filter(i => i.tool === 'gitleaks').length,
    codeSmells: issues.filter(i => i.type === 'maintainability').length
  };

  const securityIssues = issues.filter(i => i.type === 'security').length;
  const reliabilityIssues = issues.filter(i => i.type === 'reliability').length;
  const maintainabilityIssues = issues.filter(i => i.type === 'maintainability').length;

  const security       = calculateGrade(securityIssues, 'security');
  const reliability    = calculateGrade(reliabilityIssues, 'reliability');
  const maintainability = calculateGrade(maintainabilityIssues, 'maintainability');

  // Overall grade = worst of the three, with secrets always = F
  const grades = breakdown.secrets > 0
    ? ['F']
    : [security, reliability, maintainability];

  const gradeOrder = ['A','B','C','D','F'];
  const worst = grades.reduce((a, b) =>
    gradeOrder.indexOf(a) > gradeOrder.indexOf(b) ? a : b
  ) as GateResult['grade'];

  const score = Math.round(
    (gradeToScore(security) + gradeToScore(reliability) + gradeToScore(maintainability)) / 3
  );

  const result: GateResult = {
    grade: worst, score,
    security, reliability, maintainability,
    passed: worst !== 'F' && worst !== 'D',
    breakdown
  };

  // Persist to scan document
  await databases.updateDocument(DB_ID, COLLECTIONS.SCANS, scanId, {
    qualityGrade: worst,
    qualityScore: score,
    gradeSecuity: security,
    gradeReliability: reliability,
    gradeMaintainability: maintainability
  });

  logger.info('quality_gate_evaluated', { event: 'quality_gate_evaluated', scanId, grade: worst, score });

  return result;
}
