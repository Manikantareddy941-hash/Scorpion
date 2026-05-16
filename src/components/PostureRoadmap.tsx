import React, { useEffect, useState } from 'react';
import { Shield, TrendingUp, ChevronRight, CheckCircle2, AlertTriangle, Info, Zap } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

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

export default function PostureRoadmap({ compact, ciGateRate = 0, hasScans = false }: { compact?: boolean; ciGateRate?: number; hasScans?: boolean }) {
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

  if (loading) return <div className="h-64 bg-[var(--bg-card)] animate-pulse rounded-[16px]"></div>;
  if (!data) return null;

  return (
    <div className={`bg-[var(--bg-card)] rounded-[16px] ${compact ? 'p-4' : 'p-6'} shadow-[0_4px_16px_rgba(0,0,0,0.04)] h-full flex flex-col border border-[var(--border-subtle)]`}>
      <div className={`flex justify-between items-start ${compact ? 'mb-4' : 'mb-6'}`}>
        <div>
          <h3 className="text-[11px] font-black text-[var(--text-primary)] uppercase tracking-wider">Postural Health Breakdown</h3>
          <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase mt-0.5">Impact Analysis & Remediation</p>
        </div>
        <div className="flex flex-col items-end">
          <span className={`${compact ? 'text-[18px]' : 'text-[22px]'} font-black text-[var(--status-success)]`}>{data.score}%</span>
          <span className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Global Score</span>
        </div>
      </div>

      <div className={`${compact ? 'space-y-3 mb-4' : 'space-y-4 mb-8'}`}>
        {data.breakdown.map((item, i) => (
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

      <div className={`mt-auto ${compact ? 'pt-4' : 'pt-6'} border-t border-[var(--border-subtle)]`}>
        <h4 className="text-[10px] font-black text-[var(--text-primary)] uppercase tracking-widest mb-4 flex items-center gap-2">
          <Zap size={12} className="text-yellow-500" /> Remediation Roadmap
        </h4>
        <div className={`${compact ? 'space-y-2' : 'space-y-3'}`}>
          {(() => {
            const recs = [...(data.recommendations || [])].filter(r => !r.toLowerCase().includes('ci gate'));
            if (ciGateRate > 0) {
              recs.unshift(`CI gate is passing at ${ciGateRate}%. Keep maintaining policy compliance.`);
            } else if (!hasScans) {
              recs.unshift(`No scans have been run yet. Add a repository and trigger a scan to see recommendations.`);
            } else {
              recs.unshift(`Improve CI gate pass rate (currently 0%) by fixing policy blockers.`);
            }
            return recs.map((rec, i) => (
              <div key={i} className={`flex gap-2 items-start ${compact ? 'p-1.5' : 'p-3'} rounded-xl bg-[var(--bg-primary)] border border-[var(--border-subtle)] group hover:border-[var(--accent-primary)] transition-all cursor-default`}>
                <div className="w-4 h-4 rounded-lg bg-green-50 text-green-600 flex items-center justify-center shrink-0 mt-0.5">
                  <ChevronRight size={10} className="group-hover:translate-x-0.5 transition-transform" />
                </div>
                <p className="text-[10px] font-medium text-[var(--text-primary)] leading-snug">{rec}</p>
              </div>
            ));
          })()}
        </div>
      </div>
    </div>
  );
}
