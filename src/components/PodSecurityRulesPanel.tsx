import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Save, ShieldAlert } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

type PodSecurityMode = 'enforce' | 'audit' | 'off';

type PodSecurityRuleId =
  | 'registry-allowlist'
  | 'no-privileged'
  | 'run-as-non-root'
  | 'drop-dangerous-capabilities'
  | 'read-only-root-fs'
  | 'no-host-namespaces'
  | 'required-labels';

interface PodSecurityConfig {
  modes: Record<PodSecurityRuleId, PodSecurityMode>;
  allowedRegistries: string[];
  requiredLabels: string[];
}

const RULES: { id: PodSecurityRuleId; label: string; hint: string }[] = [
  { id: 'registry-allowlist', label: 'Registry allowlist', hint: 'Images must come from an approved registry' },
  { id: 'no-privileged', label: 'No privileged containers', hint: 'Blocks securityContext.privileged' },
  { id: 'run-as-non-root', label: 'Run as non-root', hint: 'Pod or container must assert runAsNonRoot' },
  { id: 'drop-dangerous-capabilities', label: 'No dangerous capabilities', hint: 'SYS_ADMIN, NET_ADMIN, SYS_PTRACE, ALL' },
  { id: 'read-only-root-fs', label: 'Read-only root filesystem', hint: 'readOnlyRootFilesystem must be true' },
  { id: 'no-host-namespaces', label: 'No host namespaces', hint: 'hostNetwork / hostPID / hostIPC / hostPath' },
  { id: 'required-labels', label: 'Required labels', hint: 'Pods must carry the listed label keys' },
];

const MODES: PodSecurityMode[] = ['enforce', 'audit', 'off'];

const MODE_STYLES: Record<PodSecurityMode, string> = {
  enforce: 'bg-red-500/15 text-red-400',
  audit: 'bg-amber-500/15 text-amber-400',
  off: 'bg-[var(--bg-primary)] text-[var(--text-secondary)]',
};

export default function PodSecurityRulesPanel() {
  const { getJWT } = useAuth();
  const [config, setConfig] = useState<PodSecurityConfig | null>(null);
  const [registriesText, setRegistriesText] = useState('');
  const [labelsText, setLabelsText] = useState('');
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    authFetch('/api/v1/rules/pod-security')
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: PodSecurityConfig | null) => {
        if (!cfg) return;
        setConfig(cfg);
        setRegistriesText(cfg.allowedRegistries.join('\n'));
        setLabelsText(cfg.requiredLabels.join('\n'));
      })
      .catch(() => toast.error('Failed to load pod-security rules'));
  }, [authFetch]);

  const setMode = (rule: PodSecurityRuleId, mode: PodSecurityMode) => {
    if (!config) return;
    setConfig({ ...config, modes: { ...config.modes, [rule]: mode } });
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const body: PodSecurityConfig = {
        modes: config.modes,
        allowedRegistries: registriesText.split('\n').map((l) => l.trim()).filter(Boolean),
        requiredLabels: labelsText.split('\n').map((l) => l.trim()).filter(Boolean),
      };
      const res = await authFetch('/api/v1/rules/pod-security', { method: 'PUT', body: JSON.stringify(body) });
      if (res.ok) {
        toast.success('Pod-security rules saved');
      } else {
        toast.error('Failed to save pod-security rules');
      }
    } catch {
      toast.error('Failed to save pod-security rules');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="premium-card p-6 mt-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-red-400" />
          <div>
            <h2 className="text-sm font-black uppercase italic tracking-wider text-[var(--text-primary)]">
              Pod Security Policies
            </h2>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider font-mono mt-0.5">
              Kyverno-style admission rules — enforced by the k8s webhook before pods schedule
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving || !config}
          className="btn-premium flex items-center gap-2 py-2 px-4 disabled:opacity-50"
        >
          <Save size={14} /> {saving ? 'Saving…' : 'Save Rules'}
        </button>
      </div>

      {!config ? (
        <p className="text-xs text-[var(--text-secondary)]">Loading rules…</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-2">
            {RULES.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3"
              >
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{rule.label}</p>
                  <p className="text-[10px] text-[var(--text-secondary)] font-mono">{rule.hint}</p>
                </div>
                <div className="flex gap-1">
                  {MODES.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setMode(rule.id, mode)}
                      className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full transition-colors ${
                        config.modes[rule.id] === mode
                          ? MODE_STYLES[mode]
                          : 'text-[var(--text-secondary)] opacity-40 hover:opacity-80'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)] mb-1.5">
                Allowed registries (prefix, one per line)
              </label>
              <textarea
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-xs font-mono text-[var(--text-primary)] outline-none"
                rows={4}
                value={registriesText}
                onChange={(e) => setRegistriesText(e.target.value)}
                placeholder={'registry.company.com/\nghcr.io/my-org/'}
              />
            </div>
            <div>
              <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)] mb-1.5">
                Required labels (key, one per line)
              </label>
              <textarea
                className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-xs font-mono text-[var(--text-primary)] outline-none"
                rows={4}
                value={labelsText}
                onChange={(e) => setLabelsText(e.target.value)}
                placeholder={'team\napp'}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
