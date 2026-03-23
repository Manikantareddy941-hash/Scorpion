import { useEffect, useRef, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import {
  Shield, AlertTriangle, Bug, Wind,
  CheckCircle2, ArrowLeft, Clock, Activity, Loader2
} from 'lucide-react';
import { databases, DB_ID, COLLECTIONS } from '../lib/appwrite';
import { Query, Client } from 'appwrite';
import FindingsTable from '../components/FindingsTable';

/* ─── Types ──────────────────────────────────────────── */
interface Scan {
  $id: string;
  repoUrl: string;
  visibility: string;
  status: string;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  timestamp: string;
  scannerVersion: string;
}

export interface AppwriteFinding {
  $id: string;
  $createdAt: string;
  scanId: string;
  title: string;
  severity: string;
  package: string;
  installedVersion: string;
  fixedVersion: string;
  description: string;
  type?: string;
}

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/* ─── Component ──────────────────────────────────────── */
export default function ScanResults() {
  const location = useLocation();
  const scanId: string | undefined = location.state?.scanId;
  const scanTarget: string = location.state?.scanTarget || 'Unknown';

  const [scan, setScan] = useState<Scan | null>(null);
  const [findings, setFindings] = useState<AppwriteFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const unsubRef = useRef<(() => void) | null>(null);

  /* ── Fetch scan + findings ── */
  useEffect(() => {
    if (!scanId) {
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        // 1. Fetch the scan document
        const scanDoc = await databases.getDocument(DB_ID, COLLECTIONS.SCANS, scanId);
        setScan(scanDoc as unknown as Scan);

        // 2. Fetch all findings where scanId == this scan
        const findingsRes = await databases.listDocuments(
          DB_ID,
          COLLECTIONS.FINDINGS,
          [Query.equal('scanId', scanId), Query.limit(500)]
        );
        const sorted = (findingsRes.documents as unknown as AppwriteFinding[]).sort(
          (a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)
        );
        setFindings(sorted);
      } catch (err: any) {
        setError(err?.message || 'Failed to load scan results.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [scanId]);

  /* ── Realtime subscription for scan status ── */
  useEffect(() => {
    if (!scanId) return;

    const client = new Client()
      .setEndpoint(import.meta.env.VITE_APPWRITE_ENDPOINT)
      .setProject(import.meta.env.VITE_APPWRITE_PROJECT_ID);

    const channel = `databases.${DB_ID}.collections.${COLLECTIONS.SCANS}.documents.${scanId}`;

    const unsub = client.subscribe(channel, (response: any) => {
      if (
        response.events?.some((e: string) => e.includes('update')) &&
        response.payload
      ) {
        setScan(prev => ({ ...prev, ...response.payload } as Scan));

        // When scan completes, re-fetch findings in case new ones arrived
        if (response.payload.status === 'completed') {
          databases.listDocuments(
            DB_ID,
            COLLECTIONS.FINDINGS,
            [Query.equal('scanId', scanId!), Query.limit(500)]
          ).then(res => {
            const sorted = (res.documents as unknown as AppwriteFinding[]).sort(
              (a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)
            );
            setFindings(sorted);
          });
        }
      }
    });

    unsubRef.current = unsub;
    return () => unsub();
  }, [scanId]);

  /* ── Loading ── */
  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center p-8">
        <div className="text-center">
          <Shield className="w-12 h-12 text-[var(--accent-primary)] animate-pulse mx-auto mb-4" />
          <h2 className="text-xs font-black text-[var(--text-secondary)] uppercase tracking-widest animate-pulse italic">
            Retrieving Audit Data...
          </h2>
        </div>
      </div>
    );
  }

  /* ── Error ── */
  if (error) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <AlertTriangle className="w-12 h-12 text-[var(--severity-high)] mx-auto mb-4" />
          <p className="text-[var(--text-secondary)] text-sm">{error}</p>
          <Link to="/" className="btn-premium mt-6 inline-flex items-center gap-2"><ArrowLeft className="w-4 h-4" /> Back</Link>
        </div>
      </div>
    );
  }

  /* ── No scanId ── */
  if (!scanId || !scan) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center p-8">
        <div className="text-center">
          <p className="text-[var(--text-secondary)]">No scan selected.</p>
          <Link to="/" className="btn-premium mt-6 inline-flex items-center gap-2"><ArrowLeft className="w-4 h-4" /> Back</Link>
        </div>
      </div>
    );
  }

  const total = findings.length;
  const isRunning = scan.status === 'scanning' || scan.status === 'running';

  const stats = [
    { label: 'CRITICAL', value: scan.criticalCount, color: 'var(--severity-critical)', icon: Shield },
    { label: 'HIGH',     value: scan.highCount,     color: 'var(--severity-high)',     icon: AlertTriangle },
    { label: 'MEDIUM',   value: scan.mediumCount,   color: 'var(--severity-medium)',   icon: Bug },
    { label: 'LOW',      value: scan.lowCount,       color: 'var(--severity-low)',      icon: Wind },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] p-8 text-[var(--text-primary)] transition-colors duration-300">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-12 gap-6">
          <div className="flex items-center gap-5">
            <div className="w-14 h-14 bg-[var(--accent-primary)] rounded-2xl flex items-center justify-center text-white shadow-xl shadow-[var(--accent-primary)]/20">
              <Activity className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tighter italic uppercase leading-none">Scan Results</h1>
              <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] mt-1 italic font-mono truncate max-w-[300px]">
                TARGET: {scan.repoUrl || scanTarget}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Live status badge */}
            <span style={{
              padding: '6px 14px',
              borderRadius: '999px',
              fontSize: '0.7rem',
              fontWeight: 800,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: isRunning ? 'rgba(251,191,36,0.1)' : scan.status === 'completed' ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)',
              color: isRunning ? '#fbbf24' : scan.status === 'completed' ? '#4ade80' : '#f87171',
              border: `1px solid ${isRunning ? '#fbbf24' : scan.status === 'completed' ? '#4ade80' : '#f87171'}44`,
            }}>
              {isRunning ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : null}
              {scan.status.toUpperCase()}
            </span>
            <Link to="/" className="btn-premium flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" /> Back to Control
            </Link>
          </div>
        </div>

        {/* Summary Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {[
            { label: 'Total Findings', value: total, icon: Bug },
            { label: 'Visibility',     value: scan.visibility || 'N/A', icon: Shield },
            { label: 'Scanner',        value: scan.scannerVersion || 'N/A', icon: Activity },
            { label: 'Scanned At',     value: scan.timestamp ? new Date(scan.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A', icon: Clock },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="premium-card p-6 group">
              <div className="flex items-center gap-3 mb-2">
                <Icon className="w-4 h-4 text-[var(--text-secondary)] group-hover:text-[var(--accent-primary)] transition-colors" />
                <span className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic">{label}</span>
              </div>
              <div className="text-2xl font-black italic tracking-tighter truncate">{value}</div>
            </div>
          ))}
        </div>

        {/* Severity Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          {stats.map(({ label, value, color, icon: Icon }) => (
            <div key={label} className="premium-card p-5 text-center group" style={{ borderColor: `${color}33` }}>
              <Icon className="w-6 h-6 mx-auto mb-3 transition-transform group-hover:scale-110" style={{ color }} />
              <div className="text-3xl font-black italic tracking-tighter mb-1" style={{ color }}>{value}</div>
              <div className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic">{label}</div>
            </div>
          ))}
        </div>

        {/* Findings Table */}
        <div className="premium-card overflow-hidden">
          <div className="p-8 border-b border-[var(--border-subtle)] bg-[var(--text-primary)]/5 flex justify-between items-center">
            <h2 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-widest italic">Detected Issues</h2>
            <span className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic bg-[var(--bg-secondary)] px-3 py-1 rounded-full border border-[var(--border-subtle)]">
              {total} Findings
            </span>
          </div>
          {isRunning ? (
            <div className="p-20 text-center flex flex-col items-center justify-center">
              <Loader2 className="w-10 h-10 text-[var(--accent-primary)] mb-4" style={{ animation: 'spin 1s linear infinite' }} />
              <p className="text-[var(--text-secondary)] font-black uppercase tracking-[0.2em] text-xs italic">
                Scan in progress — results will appear automatically...
              </p>
            </div>
          ) : findings.length === 0 ? (
            <div className="p-20 text-center flex flex-col items-center justify-center">
              <CheckCircle2 className="w-12 h-12 text-[var(--status-success)] mb-4 animate-bounce" />
              <p className="text-[var(--text-secondary)] font-black uppercase tracking-[0.2em] text-xs italic">No vulnerabilities identified. Code is secure.</p>
            </div>
          ) : (
            <FindingsTable findings={findings} />
          )}
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
