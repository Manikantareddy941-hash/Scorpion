import { useEffect, useState } from 'react';
import { X, Plus, Trash2, ShieldAlert } from 'lucide-react';

export type GateSeverity = 'critical' | 'high' | 'medium' | 'low';
export type GateAction = 'block' | 'warn';

export interface GateRule {
  id: string;
  severity: GateSeverity;
  threshold: number; // trigger when finding count > threshold
  action: GateAction;
  enabled: boolean;
}

export type GateEnv = 'dev' | 'stage' | 'prod';
export type Reachability = 'reachable' | 'unreachable' | 'unknown';

const SEVERITIES: GateSeverity[] = ['critical', 'high', 'medium', 'low'];
const ENVS: GateEnv[] = ['dev', 'stage', 'prod'];

// Sensible real defaults — not placeholder data. Mirrors the backend's
// DEFAULT_CONFIG and is used as the hook's initial state before the server responds.
export const DEFAULT_RULES: GateRule[] = [
  { id: 'seed-critical', severity: 'critical', threshold: 0, action: 'block', enabled: true },
  { id: 'seed-high', severity: 'high', threshold: 5, action: 'warn', enabled: true },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface PreflightResult {
  status: 'blocked' | 'warning' | 'ready';
  label: string;
  reason: string;
  tone: 'error' | 'warning' | 'success';
}

// Predict the next build outcome. Reachability is the primary gate (an actually
// invoked vulnerable dep blocks); when no reachability verdict is supplied, fall
// back to matching live finding counts against the active gate rules.
// env controls how an UNKNOWN reachability verdict is treated: prod blocks,
// dev/stage warn.
export function evaluatePreflight(
  rules: GateRule[],
  counts: Record<GateSeverity, number>,
  env: GateEnv = 'prod',
  reachability?: Reachability
): PreflightResult {
  if (reachability === 'reachable') {
    return { status: 'blocked', label: 'Blocked', reason: 'Vulnerable dependency is reachable', tone: 'error' };
  }
  if (reachability === 'unreachable') {
    return { status: 'ready', label: 'Ready', reason: 'Vulnerable dependency is unreachable', tone: 'success' };
  }
  if (reachability === 'unknown') {
    return env === 'prod'
      ? { status: 'blocked', label: 'Blocked', reason: `Reachability unknown — blocked in ${env}`, tone: 'error' }
      : { status: 'warning', label: 'Warning', reason: `Reachability unknown — warning in ${env}`, tone: 'warning' };
  }

  const active = rules.filter((r) => r.enabled);
  const hit = (r: GateRule) => (counts[r.severity] ?? 0) > r.threshold;
  const blocked = active.find((r) => r.action === 'block' && hit(r));
  if (blocked) return { status: 'blocked', label: 'Blocked', reason: `Violates rule: ${cap(blocked.severity)} > ${blocked.threshold}`, tone: 'error' };
  const warned = active.find((r) => r.action === 'warn' && hit(r));
  if (warned) return { status: 'warning', label: 'Warning', reason: `Violates rule: ${cap(warned.severity)} > ${warned.threshold}`, tone: 'warning' };
  return { status: 'ready', label: 'Ready', reason: 'Meets all gate rules', tone: 'success' };
}

interface Props {
  onClose: () => void;
  rules: GateRule[];
  env: GateEnv;
  onChange: (rules: GateRule[]) => void;
  onEnvChange: (env: GateEnv) => void;
  counts?: Record<GateSeverity, number>;
}

const EMPTY_COUNTS: Record<GateSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };

/**
 * Pipeline Gate Rules — presentational rule builder. Rules and env are owned by
 * the parent (via useGateRules → /api/v1/rules); this component only renders them
 * and emits changes. Each rule: "if {severity} count > {threshold} then {action}".
 */
export default function GateRulesDrawer({ onClose, rules, env, onChange, onEnvChange, counts }: Props) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const preflight = evaluatePreflight(rules, counts ?? EMPTY_COUNTS, env);

  const handleClose = () => {
    setShown(false);
    setTimeout(onClose, 280);
  };

  const addRule = () =>
    onChange([
      ...rules,
      { id: crypto.randomUUID(), severity: 'critical', threshold: 0, action: 'block', enabled: true },
    ]);
  const updateRule = (id: string, patch: Partial<GateRule>) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRule = (id: string) => onChange(rules.filter((r) => r.id !== id));

  const selectCls = 'text-xs font-semibold rounded border px-2 py-1 bg-transparent';
  const selectStyle = { borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' } as const;

  return (
    <div className="fixed inset-0 z-[10000] flex justify-end">
      <div
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${shown ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleClose}
      />

      <div
        className={`relative w-full max-w-xl h-full bg-[var(--bg-primary)] border-l border-[var(--border-subtle)] shadow-2xl flex flex-col transform transition-transform duration-300 ease-out ${shown ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex items-center gap-3">
            <ShieldAlert size={18} style={{ color: 'var(--accent-primary)' }} />
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>Pipeline Gate Rules</h2>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Block or warn builds by finding severity</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={env}
              onChange={(e) => onEnvChange(e.target.value as GateEnv)}
              className={selectCls}
              style={selectStyle}
              aria-label="Target environment"
            >
              {ENVS.map((e) => (
                <option key={e} value={e}>{cap(e)}</option>
              ))}
            </select>
            <button type="button" onClick={handleClose} aria-label="Close" title="Close" className="p-2 rounded transition-colors hover:opacity-70" style={{ color: 'var(--text-secondary)' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Rules */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {rules.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>No gate rules</p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>Builds pass by default. Add a rule to start gating.</p>
            </div>
          ) : (
            rules.map((rule) => (
              <div
                key={rule.id}
                className="p-3 rounded border"
                style={{ borderColor: 'var(--border-subtle)', background: rule.enabled ? 'var(--bg-card)' : 'var(--bg-secondary)', opacity: rule.enabled ? 1 : 0.65 }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>If</span>
                  <select
                    value={rule.severity}
                    onChange={(e) => updateRule(rule.id, { severity: e.target.value as GateSeverity })}
                    className={selectCls}
                    style={selectStyle}
                    aria-label="Severity"
                  >
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>{cap(s)}</option>
                    ))}
                  </select>
                  <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>count &gt;</span>
                  <input
                    type="number"
                    min={0}
                    value={rule.threshold}
                    onChange={(e) => updateRule(rule.id, { threshold: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-16 text-xs font-semibold rounded border px-2 py-1 bg-transparent tabular-nums"
                    style={selectStyle}
                    aria-label="Threshold count"
                  />
                  <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>then</span>
                  <select
                    value={rule.action}
                    onChange={(e) => updateRule(rule.id, { action: e.target.value as GateAction })}
                    className={selectCls}
                    style={{ borderColor: 'var(--border-subtle)', color: rule.action === 'block' ? 'var(--status-error)' : 'var(--status-warning)' }}
                    aria-label="Action"
                  >
                    <option value="block">Block Build</option>
                    <option value="warn">Warn Only</option>
                  </select>

                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateRule(rule.id, { enabled: !rule.enabled })}
                      className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider"
                      style={{ background: rule.enabled ? 'color-mix(in srgb, var(--status-success) 14%, transparent)' : 'var(--bg-secondary)', color: rule.enabled ? 'var(--status-success)' : 'var(--text-muted)' }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: rule.enabled ? 'var(--status-success)' : 'var(--text-muted)' }} />
                      {rule.enabled ? 'Active' : 'Disabled'}
                    </button>
                    <button type="button" onClick={() => removeRule(rule.id)} aria-label="Delete rule" title="Delete rule" className="p-1.5 rounded transition-colors hover:opacity-70" style={{ color: 'var(--text-muted)' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t space-y-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <div
            className="flex items-center justify-between px-3 py-2 rounded border text-[11px]"
            style={{
              borderColor: 'var(--border-subtle)',
              background: 'var(--bg-secondary)',
              color: preflight.tone === 'error' ? 'var(--status-error)' : preflight.tone === 'warning' ? 'var(--status-warning)' : 'var(--status-success)',
            }}
          >
            <span className="font-bold uppercase tracking-wider">{cap(env)} · {preflight.label}</span>
            <span style={{ color: 'var(--text-muted)' }}>{preflight.reason}</span>
          </div>
          <button
            type="button"
            onClick={addRule}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded text-xs font-bold uppercase tracking-wider transition-all hover:brightness-110"
            style={{ background: 'var(--accent-primary)', color: 'var(--text-on-accent)' }}
          >
            <Plus size={14} /> Add Gate Rule
          </button>
        </div>
      </div>
    </div>
  );
}
