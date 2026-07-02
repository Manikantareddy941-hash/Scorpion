import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { TopVulnerabilities } from './TopVulnerabilities';
import { SecurityPostureDonut } from './ui';

interface PostureData {
  score: number;
  breakdown: {
    category: string;
    impact: number;
    count?: number;
    rate?: string;
  }[];
  recommendations: string[];
}

interface VulnCounts {
  critical: number;
  high: number;
  medium: number;
  score?: number;
}

export default function PostureRoadmap({ compact, ciGateRate = 0, vulnStats }: { compact?: boolean; ciGateRate?: number; vulnStats?: VulnCounts }) {
  const { getJWT } = useAuth();
  const [data, setData] = useState<PostureData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPosture = async () => {
      try {
        const token = await getJWT();
        const res = await fetch('/api/dashboard/posture-breakdown', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error('Failed to fetch posture:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchPosture();
  }, []);

  if (loading) return <div className="h-64 plate animate-pulse"></div>;

// Fallback data when API fails
const displayData: PostureData = data ?? {
  score: Math.round(ciGateRate) || 0,
  breakdown: [
    { category: 'Critical Vulns', impact: 0 },
    { category: 'High Vulns', impact: 0 },
    { category: 'Medium Vulns', impact: 0 },
    { category: 'CI Gate', impact: ciGateRate < 50 ? 30 : ciGateRate < 80 ? 10 : 0 },
  ],
  recommendations: ['Run a scan to populate posture data.']
};

  const donutScore = vulnStats?.score ?? displayData.score;

  if (compact) {
    const compactMetrics = displayData.breakdown.slice(0, 3);
    return (
      <div className="flex flex-col items-center h-full">
        <SecurityPostureDonut
          score={donutScore}
          critical={vulnStats?.critical ?? 0}
          high={vulnStats?.high ?? 0}
          medium={vulnStats?.medium ?? 0}
          size={220}
        />
        <div className="w-full mt-4 space-y-2.5">
          {compactMetrics.map((item, i) => (
            <div key={i} className="flex flex-col gap-1 min-w-0">
              <div className="flex justify-between text-[9px] font-bold uppercase tracking-tight gap-2">
                <span className="text-[var(--text-secondary)] truncate">{item.category}</span>
                <span className={item.impact > 10 ? 'text-[var(--status-error)]' : 'text-[var(--text-primary)]'}>
                  {item.impact > 0 ? `-${item.impact}%` : '0%'}
                </span>
              </div>
              <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full transition-all duration-1000"
                  style={{
                    width: `${Math.max(5, 100 - (item.impact * 2))}%`,
                    backgroundColor: item.impact > 15 ? 'var(--status-error)' : item.impact > 5 ? 'var(--status-warning)' : 'var(--status-success)'
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-[var(--bg-card)] rounded-[16px] ${compact ? 'p-4' : 'p-6'} shadow-[0_4px_16px_rgba(0,0,0,0.04)] h-full flex flex-col border border-[var(--border-subtle)]`}>
      <div className="flex justify-between items-start mb-6 gap-3">
        <div>
          <h3 className="text-xs font-bold tracking-wider text-[var(--text-primary)] uppercase">
            Security Posture
          </h3>
          <p className="text-[10px] text-[var(--text-secondary)] uppercase font-mono mt-0.5">
            Overall score across all scans
          </p>
        </div>
        <SecurityPostureDonut
          score={donutScore}
          critical={vulnStats?.critical ?? 0}
          high={vulnStats?.high ?? 0}
          medium={vulnStats?.medium ?? 0}
          size={88}
        />
      </div>

      <div className={`${compact ? 'space-y-3 mb-4' : 'space-y-4 mb-8'}`}>
        {displayData.breakdown.map((item, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="flex justify-between text-[10px] font-bold uppercase tracking-tight">
              <span className="text-[var(--text-secondary)]">{item.category}</span>
              <span className={item.impact > 10 ? 'text-[var(--status-error)]' : 'text-[var(--text-primary)]'}>
                {item.impact > 0 ? `-${item.impact}%` : '0%'}
              </span>
            </div>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-[var(--accent-primary)] transition-all duration-1000" 
                style={{ 
                  width: `${Math.max(5, 100 - (item.impact * 2))}%`,
                  backgroundColor: item.impact > 15 ? 'var(--status-error)' : item.impact > 5 ? 'var(--status-warning)' : 'var(--status-success)'
                }}
              />
            </div>
          </div>
        ))}
      </div>
        {/* Action Panel: Top Vulnerabilities */}
        <TopVulnerabilities />

        {/* Footer Banner */}
        <div className="mt-6 p-3 bg-[var(--bg-primary)]/40 border border-[var(--border-subtle)] rounded-lg flex items-center gap-2">
          <span className="text-[var(--accent-primary)] text-xs font-mono">→</span>
          <p className="text-[11px] text-[var(--text-primary)] font-mono leading-none">
            CI gate passing at {ciGateRate}%. Keep it up.
          </p>
        </div>
    </div>
  );
}
