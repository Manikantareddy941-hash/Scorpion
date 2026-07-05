import {
  Activity,
  AlertTriangle,
  Box,
  CheckCircle2,
  FileCode2,
  MinusCircle,
  ShieldCheck,
} from 'lucide-react';

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
type StageStatus = 'pass' | 'warn' | 'fail' | 'running';

type FalcoEvent = {
  id: string;
  rule: string;
  severity: Severity;
  pod: string;
  namespace: string;
  output: string;
  time: string;
  suppressed?: boolean;
  overridden?: boolean;
};

type Scan = {
  id: string;
  type: 'DAST' | 'SBOM' | 'Docker';
  target: string;
  status: 'running' | 'queued' | 'done';
  progress: number;
  findings?: { critical: number; high: number };
};

type Gate = {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'pending';
  detail: string;
};

/* Mock data shaped like the backend (falcoRoutes, dastRoutes, sbomRoutes,
   dockerScanRoutes, gateRoutes) so this page can be wired to real APIs later. */

const KPIS = [
  { label: 'Open critical findings', value: '3', delta: '-2 since yesterday', tone: 'critical' as const },
  { label: 'Runtime events · 24h', value: '128', delta: '14 suppressed by rules', tone: 'neutral' as const },
  { label: 'Gate pass rate · 7d', value: '94.2%', delta: '+1.8% week over week', tone: 'good' as const },
  { label: 'Active scans', value: '4', delta: '2 queued', tone: 'neutral' as const },
];

const STAGES: { name: string; status: StageStatus; meta: string }[] = [
  { name: 'Plan', status: 'pass', meta: '12 threats modeled' },
  { name: 'Code', status: 'pass', meta: '0 secrets found' },
  { name: 'Build', status: 'pass', meta: 'SBOM generated' },
  { name: 'Test', status: 'warn', meta: 'DAST: 2 high' },
  { name: 'Release', status: 'pass', meta: 'Gate approved' },
  { name: 'Deploy', status: 'running', meta: 'canary 40%' },
  { name: 'Operate', status: 'pass', meta: 'Falco healthy' },
  { name: 'Monitor', status: 'fail', meta: '3 critical events' },
];

const FALCO_EVENTS: FalcoEvent[] = [
  {
    id: 'evt-1042',
    rule: 'Terminal shell in container',
    severity: 'critical',
    pod: 'payments-api-7d9f',
    namespace: 'prod',
    output: 'Shell spawned in container (user=root shell=bash)',
    time: '2 min ago',
  },
  {
    id: 'evt-1041',
    rule: 'Write below /etc',
    severity: 'critical',
    pod: 'auth-svc-2b41',
    namespace: 'prod',
    output: 'File written below /etc (file=/etc/passwd)',
    time: '9 min ago',
  },
  {
    id: 'evt-1040',
    rule: 'Outbound connection to C2 list',
    severity: 'high',
    pod: 'worker-queue-9c1a',
    namespace: 'prod',
    output: 'Outbound TCP to flagged address 185.220.x.x:443',
    time: '24 min ago',
  },
  {
    id: 'evt-1039',
    rule: 'Package management in container',
    severity: 'medium',
    pod: 'ci-runner-44af',
    namespace: 'ci',
    output: 'apt-get install executed (image=node:20)',
    time: '31 min ago',
    overridden: true,
  },
  {
    id: 'evt-1038',
    rule: 'Read sensitive file untrusted',
    severity: 'low',
    pod: 'log-shipper-11e2',
    namespace: 'observability',
    output: 'Sensitive file opened for reading (/var/run/secrets)',
    time: '48 min ago',
    suppressed: true,
  },
  {
    id: 'evt-1037',
    rule: 'Unexpected UDP traffic',
    severity: 'info',
    pod: 'dns-cache-8b02',
    namespace: 'kube-system',
    output: 'UDP burst on port 5353 (mDNS)',
    time: '1 h ago',
    suppressed: true,
  },
];

const SCANS: Scan[] = [
  { id: 'scan-311', type: 'DAST', target: 'https://staging.scorpion.dev', status: 'running', progress: 62 },
  { id: 'scan-310', type: 'Docker', target: 'scorpion/backend:fec1e45', status: 'running', progress: 38 },
  {
    id: 'scan-309',
    type: 'SBOM',
    target: 'backend · 214 packages',
    status: 'done',
    progress: 100,
    findings: { critical: 0, high: 1 },
  },
  { id: 'scan-308', type: 'DAST', target: 'https://api.scorpion.dev', status: 'queued', progress: 0 },
];

const GATES: Gate[] = [
  { id: 'g1', name: 'No critical CVEs', status: 'pass', detail: '0 found' },
  { id: 'g2', name: 'DAST high ≤ 2', status: 'pass', detail: '2 of 2 allowed' },
  { id: 'g3', name: 'Runtime criticals', status: 'fail', detail: '3 unresolved' },
  { id: 'g4', name: 'License policy', status: 'pending', detail: 'awaiting SBOM' },
];

const SEVERITY: Record<Severity, { dot: string; text: string; bg: string }> = {
  critical: { dot: 'bg-red-600', text: 'text-red-700 dark:text-red-400', bg: 'bg-red-600/10' },
  high: { dot: 'bg-orange-600', text: 'text-orange-700 dark:text-orange-400', bg: 'bg-orange-600/10' },
  medium: { dot: 'bg-amber-600', text: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-600/10' },
  low: { dot: 'bg-green-600', text: 'text-green-700 dark:text-green-400', bg: 'bg-green-600/10' },
  info: { dot: 'bg-blue-600', text: 'text-blue-700 dark:text-blue-400', bg: 'bg-blue-600/10' },
};

const STAGE_STATUS: Record<StageStatus, { dot: string; label: string }> = {
  pass: { dot: 'bg-green-600', label: 'Healthy' },
  warn: { dot: 'bg-amber-500', label: 'Attention' },
  fail: { dot: 'bg-red-600', label: 'Failing' },
  running: { dot: 'bg-[var(--accent-primary)] animate-pulse', label: 'Running' },
};

const CARD =
  'rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-[0_1px_2px_rgb(0_0_0/0.04),0_4px_16px_rgb(0_0_0/0.04)]';
const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]';

function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${s.bg} ${s.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />
      {severity}
    </span>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
      {children}
    </h2>
  );
}

function KpiCard({ kpi }: { kpi: (typeof KPIS)[number] }) {
  const valueColor =
    kpi.tone === 'critical'
      ? 'text-[var(--danger)]'
      : kpi.tone === 'good'
        ? 'text-green-700 dark:text-green-400'
        : 'text-[var(--text-primary)]';
  return (
    <div className={`${CARD} p-5`}>
      <p className="text-[13px] font-medium text-[var(--text-secondary)]">{kpi.label}</p>
      <p className={`mt-2 text-3xl font-semibold tracking-tight tabular-nums ${valueColor}`}>{kpi.value}</p>
      <p className="mt-1 text-[13px] text-[var(--text-muted)]">{kpi.delta}</p>
    </div>
  );
}

function PipelineStrip() {
  return (
    <div className={`${CARD} overflow-x-auto`}>
      <ol className="flex min-w-[720px]" aria-label="DevSecOps pipeline health">
        {STAGES.map((stage, i) => {
          const s = STAGE_STATUS[stage.status];
          return (
            <li
              key={stage.name}
              className={`flex-1 px-4 py-3.5 ${i > 0 ? 'border-l border-[var(--border)]' : ''}`}
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
                <span className="text-[13px] font-semibold text-[var(--text-primary)]">{stage.name}</span>
                <span className="sr-only">{s.label}</span>
              </div>
              <p className="mt-1 truncate text-[12px] text-[var(--text-muted)]">{stage.meta}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function FalcoFeed() {
  return (
    <section className={`${CARD} flex flex-col`} aria-label="Runtime events">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--text-muted)]" aria-hidden />
          <h2 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
            Runtime events
          </h2>
          <span className="rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
            Falco · live
          </span>
        </div>
        <button
          type="button"
          className={`rounded-md px-2.5 py-1.5 text-[13px] font-medium text-[var(--accent-primary)] hover:bg-[var(--bg-secondary)] ${FOCUS}`}
        >
          View all
        </button>
      </header>
      <ul className="divide-y divide-[var(--border)]">
        {FALCO_EVENTS.map((evt) => (
          <li
            key={evt.id}
            className={`flex items-start gap-4 px-5 py-3.5 hover:bg-[var(--bg-secondary)] ${
              evt.suppressed ? 'opacity-55' : ''
            }`}
          >
            <div className="pt-0.5">
              <SeverityBadge severity={evt.severity} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-[14px] font-medium text-[var(--text-primary)]">{evt.rule}</p>
                {evt.suppressed && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">
                    <MinusCircle className="h-3 w-3" aria-hidden />
                    Suppressed
                  </span>
                )}
                {evt.overridden && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-primary)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--accent-primary)]">
                    Severity overridden
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-[13px] text-[var(--text-secondary)]">{evt.output}</p>
              <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                <span className="font-mono">{evt.pod}</span>
                {' · '}
                {evt.namespace}
                {' · '}
                {evt.time}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ScanQueue() {
  return (
    <section className={CARD} aria-label="Scan queue">
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-4">
        <Box className="h-4 w-4 text-[var(--text-muted)]" aria-hidden />
        <h2 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">Scan queue</h2>
      </header>
      <ul className="divide-y divide-[var(--border)]">
        {SCANS.map((scan) => (
          <li key={scan.id} className="px-5 py-3.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="rounded-md bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)]">
                  {scan.type}
                </span>
                <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">{scan.target}</p>
              </div>
              <span className="shrink-0 text-[12px] capitalize text-[var(--text-muted)]">
                {scan.status === 'done' && scan.findings
                  ? `${scan.findings.critical} crit · ${scan.findings.high} high`
                  : scan.status}
              </span>
            </div>
            {scan.status === 'running' && (
              <div
                className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--bg-secondary)]"
                role="progressbar"
                aria-valuenow={scan.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${scan.type} scan progress`}
              >
                <div
                  className="h-full rounded-full bg-[var(--accent-primary)] transition-[width]"
                  style={{ width: `${scan.progress}%` }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function GatesCard() {
  return (
    <section className={CARD} aria-label="Compliance gates">
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-4">
        <ShieldCheck className="h-4 w-4 text-[var(--text-muted)]" aria-hidden />
        <h2 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
          Compliance gates
        </h2>
      </header>
      <ul className="divide-y divide-[var(--border)]">
        {GATES.map((gate) => (
          <li key={gate.id} className="flex items-center justify-between px-5 py-3">
            <div className="flex items-center gap-2.5">
              {gate.status === 'pass' ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden />
              ) : gate.status === 'fail' ? (
                <AlertTriangle className="h-4 w-4 text-[var(--danger)]" aria-hidden />
              ) : (
                <MinusCircle className="h-4 w-4 text-[var(--text-muted)]" aria-hidden />
              )}
              <span className="text-[13px] font-medium text-[var(--text-primary)]">{gate.name}</span>
              <span className="sr-only">{gate.status}</span>
            </div>
            <span className="text-[12px] text-[var(--text-muted)]">{gate.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function SecurityOverview() {
  return (
    <div className="mx-auto w-full max-w-6xl px-1 py-4 lg:px-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text-primary)]">
            Security overview
          </h1>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            3 critical runtime events need triage · release gate blocked on Monitor stage
          </p>
        </div>
        <button
          type="button"
          className={`inline-flex items-center gap-2 rounded-md bg-[var(--accent-primary)] px-3.5 py-2 text-[13px] font-semibold text-[var(--text-on-accent)] shadow-sm hover:opacity-90 ${FOCUS}`}
        >
          <FileCode2 className="h-4 w-4" aria-hidden />
          New scan
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((kpi) => (
          <KpiCard key={kpi.label} kpi={kpi} />
        ))}
      </div>

      <div className="mt-8 space-y-3">
        <SectionLabel>Pipeline</SectionLabel>
        <PipelineStrip />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          <SectionLabel>Live activity</SectionLabel>
          <FalcoFeed />
        </div>
        <div className="space-y-3">
          <SectionLabel>Verification</SectionLabel>
          <ScanQueue />
          <GatesCard />
        </div>
      </div>
    </div>
  );
}
