import { useEffect, useState } from 'react';
import { databases, DB_ID, COLLECTIONS, Query, account } from '../lib/appwrite';

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
  const [vulns, setVulns] = useState<TopVuln[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const user = await account.get();
        const repos = await databases.listDocuments(DB_ID, COLLECTIONS.REPOSITORIES, [
          Query.equal('user_id', user.$id),
          Query.limit(200),
        ]);
        const repoIds = repos.documents.map((r: any) => r.$id);
        if (repoIds.length === 0) {
          if (active) setVulns([]);
          return;
        }

        const res = await databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
          Query.equal('repo_id', repoIds),
          Query.equal('status', 'open'),
          Query.limit(100),
        ]);

        const top = res.documents
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

        if (active) setVulns(top);
      } catch {
        if (active) setVulns([]);
      }
    };
    load();
    return () => { active = false; };
  }, []);

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
