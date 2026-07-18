import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const SEVERITY_STYLE: Record<string, { bg: string; border: string }> = {
  critical: { bg: 'bg-red-50', border: 'border-red-100' },
  high: { bg: 'bg-amber-50', border: 'border-amber-100' },
  medium: { bg: 'bg-yellow-50', border: 'border-yellow-100' },
  low: { bg: 'bg-slate-50', border: 'border-slate-100' },
};

interface TopVuln {
  id: string;
  severity: string;
  label: string;
}

export function TopVulnerabilities() {
  const { getJWT } = useAuth();
  const [vulns, setVulns] = useState<TopVuln[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        // The backend scopes this to the caller's repositories. This used to be
        // two direct Appwrite queries from the browser, the second of which
        // relied on repo ids fetched by the first to stand in for a tenant filter.
        const token = await getJWT();
        const res = await fetch('/api/issues?status=open&limit=100', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`issues fetch failed: ${res.status}`);
        const documents: any[] = (await res.json())?.documents ?? [];

        const top = documents
          .slice()
          .sort((a: any, b: any) =>
            (SEVERITY_RANK[(a.severity || '').toLowerCase()] ?? 9) -
            (SEVERITY_RANK[(b.severity || '').toLowerCase()] ?? 9)
          )
          .slice(0, 2)
          .map((v: any) => ({
            id: v.$id,
            severity: (v.severity || 'low').toLowerCase(),
            label: v.title || v.cveId || v.package || 'Untitled finding',
          }));

        if (active) { setVulns(top); setFailed(false); }
      } catch (err) {
        console.warn('Failed to load top vulnerabilities:', err);
        // Rendering nothing would be indistinguishable from "no open findings".
        if (active) { setVulns([]); setFailed(true); }
      }
    };
    load();
    return () => { active = false; };
  }, [getJWT]);

  if (failed) {
    return (
      <div className="mt-5 pt-4 border-t border-[#e6e2da] font-mono">
        <h4 className="text-[10px] font-bold text-[var(--text-primary)] uppercase mb-2">Top Vulnerabilities</h4>
        <p className="text-[9px] text-[#ff8a00]">Couldn't load — not a clean result</p>
      </div>
    );
  }

  if (vulns.length === 0) return null;

  return (
    <div className="mt-5 pt-4 border-t border-[#e6e2da] font-mono">
      <h4 className="text-[10px] font-bold text-[var(--text-primary)] uppercase mb-2 flex items-center gap-2">
        <span className="text-red-600">Top Vulnerabilities</span>
      </h4>
      <ul className="space-y-2">
        {vulns.map((vuln) => {
          const style = SEVERITY_STYLE[vuln.severity] || SEVERITY_STYLE.low;
          return (
            <li key={vuln.id} className="flex items-center gap-2 text-[9px] text-[var(--text-secondary)]">
              <span className={`${style.bg} ${style.border} rounded px-1 py-0.5`}>{vuln.severity.toUpperCase()}</span>
              <span className="truncate">{vuln.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
