import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';

/**
 * Members & Access for a Plan project.
 *
 * Assigns built-in roles only — v1 has no way to create a role, which is what
 * keeps the policy table free of a write path. Every action here is authorized
 * server-side against `access:write`; this component just makes the calls
 * legible and surfaces the refusals.
 */

interface Grant {
  $id: string;
  subject_type: 'user' | 'team';
  subject_id: string;
  role_key: string;
  granted_by: string;
  granted_at: string;
}

const ROLES = [
  { key: 'project_admin', label: 'Admin', blurb: 'Full control, including access' },
  { key: 'project_editor', label: 'Editor', blurb: 'Create and edit work items' },
  { key: 'project_viewer', label: 'Viewer', blurb: 'Read-only' },
];

const roleLabel = (key: string) => ROLES.find((r) => r.key === key)?.label ?? key;

interface Props {
  projectId: string;
  /** False while RBAC is in shadow mode — roles are recorded but not applied yet. */
  enforcing: boolean;
}

export function MembersAccessPanel({ projectId, enforcing }: Props) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newSubjectId, setNewSubjectId] = useState('');
  const [newSubjectType, setNewSubjectType] = useState<'user' | 'team'>('user');
  const [newRole, setNewRole] = useState('project_viewer');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/plan/projects/${projectId}/access`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Failed (${res.status})`);
      setGrants(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load members');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  /** Surfaces the server's refusal verbatim — "only admin left" is the message that matters. */
  const mutate = useCallback(async (key: string, path: string, init: RequestInit) => {
    setBusy(key);
    setError(null);
    try {
      const res = await apiFetch(path, init);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Failed (${res.status})`);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
      return false;
    } finally {
      setBusy(null);
    }
  }, [load]);

  const addMember = async () => {
    const id = newSubjectId.trim();
    if (!id) return;
    const ok = await mutate('add', `/api/plan/projects/${projectId}/access`, {
      method: 'POST',
      body: JSON.stringify({ subjectType: newSubjectType, subjectId: id, roleKey: newRole }),
    });
    if (ok) setNewSubjectId('');
  };

  const changeRole = (g: Grant, roleKey: string) =>
    mutate(g.$id, `/api/plan/projects/${projectId}/access/${g.subject_id}`, {
      method: 'PATCH', body: JSON.stringify({ roleKey }),
    });

  const revoke = (g: Grant) =>
    mutate(g.$id, `/api/plan/projects/${projectId}/access/${g.subject_id}`, { method: 'DELETE' });

  const adminCount = grants.filter((g) => g.role_key === 'project_admin').length;

  return (
    <section className="space-y-5" aria-labelledby="members-heading">
      <header className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
        <div>
          <h2 id="members-heading" className="flex items-center gap-2 text-[15px] font-semibold text-[var(--text-primary)]">
            <Users className="w-4 h-4 text-[var(--accent-primary)]" aria-hidden="true" />
            Members &amp; Access
          </h2>
          <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
            {grants.length} {grants.length === 1 ? 'grant' : 'grants'} · {adminCount} admin{adminCount === 1 ? '' : 's'}
          </p>
        </div>
      </header>

      {!enforcing && (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-[2px] w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Roles are being recorded but not yet applied. Everyone here keeps their current access until enforcement is switched on.</span>
        </p>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 py-6 text-[13px] text-[var(--text-secondary)]">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading members…
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {grants.map((g) => {
            const isOnlyAdmin = g.role_key === 'project_admin' && adminCount === 1;
            return (
              <li key={g.$id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-[11px] font-semibold uppercase text-[var(--text-secondary)]">
                  {g.subject_type === 'team' ? 'T' : 'U'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[12px] text-[var(--text-primary)]">{g.subject_id}</p>
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    {g.subject_type === 'team' ? 'Team' : 'User'} · {roleLabel(g.role_key)}
                    {g.granted_by ? ` · granted by ${g.granted_by}` : ''}
                  </p>
                </div>

                <label className="sr-only" htmlFor={`role-${g.$id}`}>Role for {g.subject_id}</label>
                <select
                  id={`role-${g.$id}`}
                  value={g.role_key}
                  disabled={busy === g.$id}
                  onChange={(e) => void changeRole(g, e.target.value)}
                  className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] transition-colors hover:border-[var(--accent-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] disabled:opacity-50"
                >
                  {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>

                <button
                  type="button"
                  onClick={() => void revoke(g)}
                  disabled={busy === g.$id || isOnlyAdmin}
                  title={isOnlyAdmin ? 'The only admin cannot be removed — promote someone else first' : 'Revoke access'}
                  aria-label={`Revoke access for ${g.subject_id}`}
                  className="rounded-md p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-red-500/10 hover:text-red-500 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  {busy === g.$id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </li>
            );
          })}
          {grants.length === 0 && (
            <li className="py-6 text-[13px] text-[var(--text-secondary)]">
              No grants yet. Anyone added here gets the role you pick.
            </li>
          )}
        </ul>
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); void addMember(); }}
        className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3"
      >
        <div className="min-w-[200px] flex-1">
          <label htmlFor="new-subject" className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
            User or team ID
          </label>
          <input
            id="new-subject"
            value={newSubjectId}
            onChange={(e) => setNewSubjectId(e.target.value)}
            placeholder="e.g. 68f1a2b3c4d5e6f70819"
            className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1.5 font-mono text-[12px] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
          />
        </div>

        <div>
          <label htmlFor="new-type" className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">Type</label>
          <select
            id="new-type" value={newSubjectType}
            onChange={(e) => setNewSubjectType(e.target.value as 'user' | 'team')}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
          >
            <option value="user">User</option>
            <option value="team">Team</option>
          </select>
        </div>

        <div>
          <label htmlFor="new-role" className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">Role</label>
          <select
            id="new-role" value={newRole} onChange={(e) => setNewRole(e.target.value)}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
          >
            {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label} — {r.blurb}</option>)}
          </select>
        </div>

        <button
          type="submit"
          disabled={busy === 'add' || !newSubjectId.trim()}
          className="flex items-center gap-1.5 rounded-md bg-[var(--accent-primary)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === 'add' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
          Add
        </button>
      </form>

      <p className="flex items-start gap-2 text-[11px] text-[var(--text-secondary)]">
        <ShieldCheck className="mt-[1px] w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Only admins can change access. Every grant records who made it and when.</span>
      </p>
    </section>
  );
}
