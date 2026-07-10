import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Network, Plus, Trash2, Copy, Download, ExternalLink } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface FlowRow { from: string; to: string; port: string }

interface NetPolPanelProps {
  prefillNamespace?: string;
}

interface GenerateResult {
  yaml: string;
  prUrl?: string;
  prError?: string;
}

const EMPTY_FLOW: FlowRow = { from: '', to: '', port: '' };

const INPUT_CLS =
  'w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-xs text-[var(--text-primary)] outline-none';
const LABEL_CLS = 'block text-[9px] font-black uppercase italic text-[var(--text-secondary)] mb-1';

export default function NetPolPanel({ prefillNamespace }: NetPolPanelProps) {
  const { getJWT } = useAuth();
  const [namespace, setNamespace] = useState('');
  const [flows, setFlows] = useState<FlowRow[]>([{ ...EMPTY_FLOW }]);
  const [createPr, setCreatePr] = useState(false);
  const [repo, setRepo] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (prefillNamespace) setNamespace(prefillNamespace);
  }, [prefillNamespace]);

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

  const updateFlow = (i: number, patch: Partial<FlowRow>) => {
    setFlows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const generate = async () => {
    if (!namespace.trim()) { toast.error('Namespace is required'); return; }
    if (createPr && !repo.trim()) { toast.error('Repo URL is required to create a PR'); return; }
    setGenerating(true);
    setError(null);
    setResult(null);
    try {
      const body = {
        namespace: namespace.trim(),
        flows: flows
          .filter((f) => f.from.trim() && f.to.trim() && f.port.trim())
          .map((f) => ({ from: f.from.trim(), to: f.to.trim(), port: Number(f.port) })),
        ...(createPr ? { createPr: true, repo: repo.trim() } : {}),
      };
      const res = await authFetch('/api/netpol/generate', { method: 'POST', body: JSON.stringify(body) });
      if (res.ok) {
        setResult(await res.json());
      } else {
        setError((await res.json().catch(() => ({}))).error || 'Failed to generate NetworkPolicies');
      }
    } catch {
      setError('Failed to generate NetworkPolicies');
    } finally {
      setGenerating(false);
    }
  };

  const copyYaml = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.yaml);
    toast.success('YAML copied');
  };

  const downloadYaml = () => {
    if (!result) return;
    const blob = new Blob([result.yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `netpol-${namespace || 'namespace'}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="premium-card p-6 mt-8">
      <div className="flex items-center gap-3 mb-4">
        <Network className="w-5 h-5 text-sky-400" />
        <div>
          <h2 className="text-sm font-black uppercase italic tracking-wider text-[var(--text-primary)]">NetworkPolicy Generator</h2>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider font-mono mt-0.5">
            Zero-trust baseline — default-deny + DNS + explicit flows, never applied automatically
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className={LABEL_CLS}>Namespace</label>
          <input className={INPUT_CLS} value={namespace} onChange={(e) => setNamespace(e.target.value)} placeholder="production" />
        </div>
      </div>

      <label className={LABEL_CLS}>Allowed flows</label>
      <div className="space-y-2 mb-3">
        {flows.map((f, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className={INPUT_CLS} value={f.from} onChange={(e) => updateFlow(i, { from: e.target.value })} placeholder="from (app label)" />
            <input className={INPUT_CLS} value={f.to} onChange={(e) => updateFlow(i, { to: e.target.value })} placeholder="to (app label)" />
            <input className={`${INPUT_CLS} max-w-[100px]`} value={f.port} onChange={(e) => updateFlow(i, { port: e.target.value })} placeholder="port" />
            <button
              type="button"
              onClick={() => setFlows((rows) => rows.filter((_, idx) => idx !== i))}
              disabled={flows.length === 1}
              className="text-red-500 hover:text-red-400 disabled:opacity-30 shrink-0"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setFlows((rows) => [...rows, { ...EMPTY_FLOW }])}
        className="text-[10px] font-bold text-[var(--accent-primary)] uppercase tracking-widest flex items-center gap-1 mb-4"
      >
        <Plus size={12} /> Add flow
      </button>

      <div className="flex items-center gap-2 mb-4">
        <input id="netpol-create-pr" type="checkbox" checked={createPr} onChange={(e) => setCreatePr(e.target.checked)} className="accent-[var(--accent-primary)]" />
        <label htmlFor="netpol-create-pr" className="text-xs text-[var(--text-primary)]">Open a GitOps PR with the generated manifests</label>
      </div>
      {createPr && (
        <div className="mb-4">
          <label className={LABEL_CLS}>Repository URL</label>
          <input className={INPUT_CLS} value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/org/deploy-repo" />
        </div>
      )}

      <button type="button" onClick={generate} disabled={generating} className="btn-premium py-2 px-4 disabled:opacity-50">
        {generating ? 'Generating…' : 'Generate'}
      </button>

      {error && <p className="text-xs text-red-500 mt-4">{error}</p>}

      {result && (
        <div className="mt-6">
          {result.prUrl && (
            <a
              href={result.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-emerald-500 hover:text-emerald-400 flex items-center gap-1 mb-2"
            >
              <ExternalLink size={12} /> Pull request opened: {result.prUrl}
            </a>
          )}
          {result.prError && (
            <p className="text-xs text-amber-500 mb-2">PR creation failed: {result.prError}</p>
          )}
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)]">Generated manifests</span>
            <div className="flex gap-2">
              <button type="button" onClick={copyYaml} className="text-[10px] font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] uppercase tracking-widest flex items-center gap-1">
                <Copy size={12} /> Copy
              </button>
              <button type="button" onClick={downloadYaml} className="text-[10px] font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] uppercase tracking-widest flex items-center gap-1">
                <Download size={12} /> Download
              </button>
            </div>
          </div>
          <pre className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl p-4 text-[11px] font-mono text-[var(--text-primary)] overflow-x-auto max-h-[400px] overflow-y-auto">
            {result.yaml}
          </pre>
        </div>
      )}
    </div>
  );
}
