import React from 'react';

export function TopVulnerabilities() {
  // Static mock targets - these will connect to your Appwrite vulnerabilities collection later
  const issues = [
    { id: 'CVE-2024-22195', severity: 'CRITICAL', label: 'jsonwebtoken flaw', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-100' },
    { id: 'SEC-KEYS-09', severity: 'HIGH', label: 'Exposed Appwrite API Key', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-100' }
  ];

  return (
    <div className="mt-5 pt-4 border-t border-[#e6e2da] font-mono">
      <h4 className="text-[10px] font-bold text-[var(--text-primary)] uppercase mb-2 flex items-center gap-2">
        <span className="text-red-600">Top Vulnerabilities</span>
      </h4>
      <ul className="space-y-2">
        {issues.map((vuln) => (
          <li key={vuln.id} className="flex items-center gap-2 text-[9px] text-[var(--text-secondary)]">
            <span className={`${vuln.bg} ${vuln.border} rounded px-1 py-0.5`}>{vuln.severity}</span>
            <span>{vuln.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
