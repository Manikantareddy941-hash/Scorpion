import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { severityVar, type Severity } from './ui/types';
import { INPUT_CLS, LABEL_CLS } from './falco/falcoTypes';

const ESCAPED_PHASES = ['plan', 'code', 'build', 'test', 'release', 'deploy', 'operate', 'monitor'] as const;

interface Incident {
  $id: string;
  title: string;
  severity: Severity;
  source: string;
  status: string;
  $createdAt: string;
  rootCause?: string;
  escapedPhase?: string;
  lessons?: string;
  actionItemIssueId?: string;
}

interface Project { $id: string; name: string }

interface EvidenceRow { actionId: string; playbookName: string; createdAt: string; evidence: unknown }

function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded"
      style={{ color: severityVar(severity), background: `color-mix(in srgb, ${severityVar(severity)} 15%, transparent)` }}
    >
      {severity}
    </span>
  );
}

export default function IncidentsPanel() {
  const { getJWT } = useAuth();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [rootCause, setRootCause] = useState('');
  const [escapedPhase, setEscapedPhase] = useState('');
  const [lessons, setLessons] = useState('');
  const [saving, setSaving] = useState(false);

  const [selectedProjId, setSelectedProjId] = useState('');
  const [converting, setConverting] = useState(false);

  const [evidence, setEvidence] = useState<EvidenceRow[] | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const authFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const token = await getJWT();
      return fetch(path, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
      });
    },
    [getJWT]
  );

  const load = useCallback(async () => {
    try {
      const [incRes, projRes] = await Promise.all([
        authFetch('/api/incidents'),
        authFetch('/api/plan/projects'),
      ]);
      if (!incRes.ok) { setError('Failed to load incidents'); return; }
      const incData = await incRes.json();
      setIncidents(incData.documents || []);
      if (projRes.ok) setProjects(await projRes.json());
      setError(null);
    } catch {
      setError('Failed to load incidents');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = (incident: Incident) => {
    if (expandedId === incident.$id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(incident.$id);
    setRootCause(incident.rootCause || '');
    setEscapedPhase(incident.escapedPhase || '');
    setLessons(incident.lessons || '');
    setSelectedProjId(projects[0]?.$id || '');
    setEvidence(null);
    setEvidenceOpen(false);
  };

  const savePostmortem = async (incidentId: string) => {
    setSaving(true);
    try {
      const res = await authFetch(`/api/incidents/${incidentId}/postmortem`, {
        method: 'PATCH',
        body: JSON.stringify({ rootCause, escapedPhase, lessons }),
      });
      if (!res.ok) throw new Error();
      toast.success('Post-mortem saved');
      await load();
    } catch {
      toast.error('Failed to save post-mortem');
    } finally {
      setSaving(false);
    }
  };

  const convertToIssue = async (incidentId: string) => {
    if (!selectedProjId) { toast.error('Select a project first'); return; }
    setConverting(true);
    try {
      const res = await authFetch(`/api/incidents/${incidentId}/convert-to-issue`, {
        method: 'POST',
        body: JSON.stringify({ projectId: selectedProjId }),
      });
      if (!res.ok) throw new Error();
      toast.success('Plan issue created');
      await load();
    } catch {
      toast.error('Failed to create Plan issue');
    } finally {
      setConverting(false);
    }
  };

  const loadEvidence = async (incidentId: string) => {
    const nextOpen = !evidenceOpen;
    setEvidenceOpen(nextOpen);
    if (!nextOpen || evidence !== null) return;
    setEvidenceLoading(true);
    try {
      const res = await authFetch(`/api/incidents/${incidentId}/evidence`);
      if (!res.ok) throw new Error();
      setEvidence(await res.json());
    } catch {
      toast.error('Failed to load evidence');
    } finally {
      setEvidenceLoading(false);
    }
  };

  return (
    <div className="premium-card p-6 mt-8">
      <div className="flex items-center gap-3 mb-4">
        <AlertTriangle className="w-5 h-5 text-red-400" />
        <div>
          <h2 className="text-sm font-black uppercase italic tracking-wider text-[var(--text-primary)]">Incidents</h2>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider font-mono mt-0.5">
            Post-mortems, Plan-issue conversion, and captured evidence
          </p>
        </div>
      </div>

      {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

      {loading ? (
        <p className="text-xs text-[var(--text-secondary)]">Loading incidents…</p>
      ) : incidents.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)] italic">No incidents recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {incidents.map((incident) => {
            const isExpanded = expandedId === incident.$id;
            const isResolved = incident.status === 'resolved';
            return (
              <div key={incident.$id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleExpand(incident)}
                  disabled={!isResolved}
                  className="w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left disabled:cursor-default"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <SeverityBadge severity={incident.severity} />
                    <span className="text-xs text-[var(--text-primary)] truncate">{incident.title}</span>
                    <span className="text-[10px] font-mono text-[var(--text-secondary)] truncate">{incident.source}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">{incident.status}</span>
                    <span className="text-[10px] font-mono text-[var(--text-secondary)]">{new Date(incident.$createdAt).toLocaleString()}</span>
                    {isResolved && (isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                  </div>
                </button>

                {isExpanded && isResolved && (
                  <div className="px-4 pb-4 pt-1 space-y-4 border-t border-[var(--border-subtle)]">
                    {/* Post-mortem form */}
                    <div className="space-y-3 pt-3">
                      <h3 className="text-[11px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Post-mortem</h3>
                      <div>
                        <label className={LABEL_CLS}>Root cause</label>
                        <textarea className={INPUT_CLS} rows={3} value={rootCause} onChange={(e) => setRootCause(e.target.value)} placeholder="What actually happened?" />
                      </div>
                      <div>
                        <label className={LABEL_CLS}>Escaped phase</label>
                        <select className={INPUT_CLS} value={escapedPhase} onChange={(e) => setEscapedPhase(e.target.value)}>
                          <option value="">Select a phase…</option>
                          {ESCAPED_PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={LABEL_CLS}>Lessons learned</label>
                        <textarea className={INPUT_CLS} rows={3} value={lessons} onChange={(e) => setLessons(e.target.value)} placeholder="One line per action item…" />
                      </div>
                      <button
                        type="button"
                        onClick={() => savePostmortem(incident.$id)}
                        disabled={saving}
                        className="btn-premium py-2 px-4 text-xs disabled:opacity-50"
                      >
                        {saving ? 'Saving…' : 'Save post-mortem'}
                      </button>
                    </div>

                    {/* Convert to Plan issue */}
                    <div className="space-y-2">
                      <h3 className="text-[11px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Plan issue</h3>
                      {incident.actionItemIssueId ? (
                        <p className="text-xs text-[var(--text-primary)]">Linked issue: <span className="font-mono text-[var(--text-secondary)]">{incident.actionItemIssueId}</span></p>
                      ) : (
                        <div className="flex items-end gap-2">
                          <div className="flex-1">
                            <label className={LABEL_CLS}>Project</label>
                            <select className={INPUT_CLS} value={selectedProjId} onChange={(e) => setSelectedProjId(e.target.value)}>
                              {projects.length === 0 && <option value="">No projects available</option>}
                              {projects.map((p) => <option key={p.$id} value={p.$id}>{p.name}</option>)}
                            </select>
                          </div>
                          <button
                            type="button"
                            onClick={() => convertToIssue(incident.$id)}
                            disabled={converting || projects.length === 0}
                            className="btn-premium py-2 px-4 text-xs disabled:opacity-50"
                          >
                            {converting ? 'Creating…' : 'Create Plan Issue'}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Evidence accordion */}
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => loadEvidence(incident.$id)}
                        className="text-[11px] font-black uppercase tracking-widest text-[var(--text-secondary)] flex items-center gap-1.5"
                      >
                        Evidence {evidenceOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                      {evidenceOpen && (
                        evidenceLoading ? (
                          <p className="text-xs text-[var(--text-secondary)]">Loading evidence…</p>
                        ) : !evidence || evidence.length === 0 ? (
                          <p className="text-xs text-[var(--text-secondary)] italic">No evidence captured for this incident.</p>
                        ) : (
                          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                            {evidence.map((row) => (
                              <div key={row.actionId} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-xs font-medium text-[var(--text-primary)]">{row.playbookName}</span>
                                  <span className="text-[10px] font-mono text-[var(--text-secondary)]">{new Date(row.createdAt).toLocaleString()}</span>
                                </div>
                                <pre className="text-[10px] font-mono text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap">
                                  {JSON.stringify(row.evidence, null, 2)}
                                </pre>
                              </div>
                            ))}
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
