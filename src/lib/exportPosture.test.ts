import { describe, it, expect } from 'vitest';
import { buildPostureCsv, type PostureSnapshot } from './exportPosture';
import { daysOverdue, slaHoursLeft } from './sla';

const snap: PostureSnapshot = {
  generatedAt: new Date('2026-06-28T00:00:00.000Z'),
  actor: 'a@b.com',
  preflight: { label: 'Blocked', reason: 'Violates rule: Critical > 0', status: 'blocked' },
  riskScore: 42,
  securityDebtHours: 96,
  vulnStats: { critical: 3, high: 5, medium: 2, low: 1, bugs: 0, total: 11 },
  slaStats: { breached: 4, dueSoon: 2, breachedCritical: 1 },
  gateRows: [],
};

describe('buildPostureCsv', () => {
  it('emits breach rows with header when data present', () => {
    const csv = buildPostureCsv(snap, [
      { id: 'f1', severity: 'CRITICAL', asset: 'repo-x', deadline: '2026-06-20T00:00:00.000Z', daysOverdue: 8, status: 'open' },
    ]);
    expect(csv).toContain('Finding ID,Severity,Asset/Repo,SLA Deadline,Days Overdue,Status');
    expect(csv).toContain('f1,CRITICAL,repo-x,2026-06-20T00:00:00.000Z,8,open');
  });

  it('degrades to summary with note when slaRows is null (fetch failed)', () => {
    const csv = buildPostureCsv(snap, null);
    expect(csv).toContain('Detailed breakdown could not be fetched; summary provided.');
    expect(csv).toContain('SLA Breached,4');
  });

  it('degrades to summary when there are zero breaches', () => {
    const csv = buildPostureCsv(snap, []);
    expect(csv).toContain('No SLA breaches found; summary provided.');
  });

  it('escapes commas and quotes per RFC 4180', () => {
    const csv = buildPostureCsv(snap, [
      { id: 'f2', severity: 'HIGH', asset: 'repo, "prod"', deadline: 'd', daysOverdue: 1, status: 'open' },
    ]);
    expect(csv).toContain('"repo, ""prod"""');
  });
});

describe('sla.daysOverdue', () => {
  it('is 0 within window, whole days past deadline when breached', () => {
    const now = Date.parse('2026-06-28T00:00:00.000Z');
    // critical window = 24h; created 72h ago => 48h past deadline => 2 days overdue
    const breached = new Date(now - 72 * 3600_000).toISOString();
    expect(daysOverdue(breached, 'critical', now)).toBe(2);
    expect(slaHoursLeft(breached, 'critical', now)).toBeLessThan(0);
    // fresh finding still inside the window
    const fresh = new Date(now - 1 * 3600_000).toISOString();
    expect(daysOverdue(fresh, 'critical', now)).toBe(0);
  });
});
