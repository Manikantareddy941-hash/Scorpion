import { jsPDF } from 'jspdf';

// ── Types ─────────────────────────────────────────────────────────────────────
// A snapshot of the dashboard's current aggregate state. Built from live React
// state at click time — the PDF/CSV reflect exactly what the user sees.

export type PreflightStatus = 'blocked' | 'warning' | 'ready';

export interface PostureSnapshot {
  generatedAt: Date;
  actor: string;
  preflight: { label: string; reason: string; status: PreflightStatus };
  riskScore: number;
  securityDebtHours: number;
  vulnStats: { critical: number; high: number; medium: number; low: number; bugs: number; total: number };
  slaStats: { breached: number; dueSoon: number; breachedCritical: number };
  gateRows: { label: string; value: string; sub: string }[];
}

// One overdue finding for the SecOps CSV. null slaRows => fetch failed (degrade).
export interface SlaBreachRow {
  id: string;
  severity: string;
  asset: string;
  deadline: string;
  daysOverdue: number;
  status: string;
}

// Status → RGB for PDF accents. Mirrors --status-error / --status-warning / --status-success.
const STATUS_RGB: Record<PreflightStatus, [number, number, number]> = {
  blocked: [225, 29, 72],
  warning: [234, 88, 12],
  ready: [21, 163, 74],
};

const fileStamp = (d: Date) => d.toISOString().slice(0, 19).replace(/[:T]/g, '-');

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── PDF — executive A4 posture snapshot ─────────────────────────────────────────

export function exportPosturePdf(s: PostureSnapshot): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 16;
  const [r, g, b] = STATUS_RGB[s.preflight.status];
  let y = M;

  // Header
  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(20, 20, 20);
  doc.text('Security Posture Snapshot', M, y);
  y += 6;
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(120, 120, 120);
  doc.text(`Generated ${s.generatedAt.toLocaleString()}  ·  ${s.actor}`, M, y);
  y += 4;
  doc.setDrawColor(225, 225, 225).line(M, y, W - M, y);
  y += 10;

  // (1) Executive verdict
  doc.setFillColor(r, g, b).rect(M, y - 4, 3, 16, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(22).setTextColor(r, g, b);
  doc.text(s.preflight.label.toUpperCase(), M + 7, y + 6);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(90, 90, 90);
  doc.text(s.preflight.reason, M + 7, y + 11);
  y += 22;

  // (2) Command bar — 2x2 metrics
  const cardW = (W - M * 2 - 6) / 2;
  const metrics: [string, string, string][] = [
    ['Pre-flight', s.preflight.label, s.preflight.reason],
    ['Risk Score', `${s.riskScore}/100`, s.riskScore >= 85 ? 'Healthy' : s.riskScore >= 65 ? 'Needs attention' : 'High risk'],
    ['SLA Status', s.slaStats.breached > 0 ? `${s.slaStats.breached} breached` : s.slaStats.dueSoon > 0 ? `${s.slaStats.dueSoon} due <24h` : 'On track', `${s.slaStats.breachedCritical} critical overdue`],
    ['Security Debt', `${s.securityDebtHours} hrs`, `est. fix for ${s.vulnStats.total} items`],
  ];
  metrics.forEach((mtr, i) => {
    const cx = M + (i % 2) * (cardW + 6);
    const cy = y + Math.floor(i / 2) * 24;
    doc.setDrawColor(225, 225, 225).setFillColor(250, 250, 250).roundedRect(cx, cy, cardW, 20, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(130, 130, 130);
    doc.text(mtr[0].toUpperCase(), cx + 4, cy + 6);
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(30, 30, 30);
    doc.text(mtr[1], cx + 4, cy + 13);
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(140, 140, 140);
    doc.text(mtr[2].slice(0, 60), cx + 4, cy + 17);
  });
  y += 24 * 2 + 8;

  // (3) Threat overview
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(20, 20, 20);
  doc.text('Threat Overview', M, y);
  y += 6;
  const threats: [string, number][] = [
    ['Critical', s.vulnStats.critical], ['High', s.vulnStats.high], ['Medium', s.vulnStats.medium],
    ['Low', s.vulnStats.low], ['Bugs', s.vulnStats.bugs], ['Open', s.vulnStats.total],
  ];
  const tW = (W - M * 2) / threats.length;
  threats.forEach(([label, val], i) => {
    const cx = M + i * tW;
    doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(30, 30, 30);
    doc.text(String(val), cx, y + 6);
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(140, 140, 140);
    doc.text(label.toUpperCase(), cx, y + 11);
  });
  y += 18;

  // (4) Pipeline gates table
  doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(20, 20, 20);
  doc.text('Pipeline Gates', M, y);
  y += 6;
  doc.setDrawColor(235, 235, 235);
  s.gateRows.forEach((row) => {
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(80, 80, 80);
    doc.text(row.label, M, y);
    doc.setFont('helvetica', 'bold').setTextColor(30, 30, 30);
    doc.text(row.value, M + 60, y);
    doc.setFont('helvetica', 'normal').setTextColor(140, 140, 140).setFontSize(8);
    doc.text(row.sub.slice(0, 50), M + 95, y);
    doc.line(M, y + 2, W - M, y + 2);
    y += 7;
  });
  y += 6;

  // (5) Recommendation
  doc.setFillColor(r, g, b).rect(M, y - 4, 3, 12, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(r, g, b);
  doc.text('RECOMMENDED ACTION', M + 7, y);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(70, 70, 70);
  doc.text(doc.splitTextToSize(recommendation(s), W - M * 2 - 7), M + 7, y + 5);

  // Footer
  const H = doc.internal.pageSize.getHeight();
  doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(160, 160, 160);
  doc.text('Generated by Scorpion · auditable posture snapshot', M, H - 8);
  doc.text(`${s.generatedAt.toISOString()}`, W - M, H - 8, { align: 'right' });

  doc.save(`scorpion-posture-${fileStamp(s.generatedAt)}.pdf`);
}

// One-line executive steer derived from the live verdict + score.
function recommendation(s: PostureSnapshot): string {
  if (s.preflight.status === 'blocked')
    return `Release is blocked. ${s.preflight.reason}. Remediate blocking findings before deploying.`;
  if (s.slaStats.breached > 0)
    return `${s.slaStats.breached} finding(s) past SLA (${s.slaStats.breachedCritical} critical). Prioritize overdue items this cycle.`;
  if (s.preflight.status === 'warning')
    return `Release allowed with warnings. ${s.preflight.reason}. Schedule remediation to avoid escalation.`;
  return `Posture is healthy (score ${s.riskScore}/100). Maintain current controls and monitoring.`;
}

// ── CSV — SecOps SLA breach list ────────────────────────────────────────────────

function csvCell(v: unknown): string {
  const str = String(v ?? '');
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

const toCsv = (rows: string[][]): string => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

// Builds the CSV body. slaRows === null => fetch failed, degrade to summary + note.
export function buildPostureCsv(s: PostureSnapshot, slaRows: SlaBreachRow[] | null): string {
  const rows: string[][] = [
    ['Scorpion Security Posture — SLA Breach Report'],
    ['Generated', s.generatedAt.toISOString(), 'By', s.actor],
    [],
  ];

  if (slaRows && slaRows.length > 0) {
    rows.push(['Finding ID', 'Severity', 'Asset/Repo', 'SLA Deadline', 'Days Overdue', 'Status']);
    for (const row of slaRows) {
      rows.push([row.id, row.severity, row.asset, row.deadline, String(row.daysOverdue), row.status]);
    }
  } else {
    rows.push(['Note', slaRows === null
      ? 'Detailed breakdown could not be fetched; summary provided.'
      : 'No SLA breaches found; summary provided.']);
    rows.push([]);
    rows.push(['Metric', 'Value']);
    rows.push(['SLA Breached', String(s.slaStats.breached)]);
    rows.push(['Breached Critical', String(s.slaStats.breachedCritical)]);
    rows.push(['Due < 24h', String(s.slaStats.dueSoon)]);
    rows.push(['Open Findings (total)', String(s.vulnStats.total)]);
  }

  return toCsv(rows);
}

export function exportPostureCsv(s: PostureSnapshot, slaRows: SlaBreachRow[] | null): void {
  const csv = buildPostureCsv(s, slaRows);
  triggerDownload(`scorpion-posture-${fileStamp(s.generatedAt)}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}
