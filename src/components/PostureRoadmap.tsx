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

export default function PostureRoadmap() {
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
    <div className="bg-[var(--bg-card)] rounded-[16px] p-6 shadow-[0_4px_16px_rgba(0,0,0,0.04)] h-full flex flex-col">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h3 className="text-[13px] font-black text-[var(--text-primary)] uppercase tracking-wider">Postural Health Breakdown</h3>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase mt-1">Impact Analysis & Remediation</p>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[24px] font-black text-[var(--status-success)]">{data.score}%</span>
          <span className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-widest">Global Score</span>
        </div>
      </div>

      <div className="space-y-4 mb-8">
        {data.breakdown.map((item, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="flex justify-between text-[11px] font-bold uppercase tracking-tight">
              <span className="text-[var(--text-secondary)]">{item.category}</span>
              <span className={item.impact > 10 ? 'text-[var(--status-error)]' : 'text-[var(--text-primary)]'}>
                -{item.impact}% Impact
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

      <div className="mt-auto pt-6 border-t border-[var(--border-subtle)]">
        <h4 className="text-[10px] font-black text-[var(--text-primary)] uppercase tracking-widest mb-4 flex items-center gap-2">
          <Zap size={12} className="text-yellow-500" /> Remediation Roadmap
        </h4>
        <div className="space-y-3">
          {data.recommendations.map((rec, i) => (
            <div key={i} className="flex gap-3 items-start p-3 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-subtle)] group hover:border-[var(--accent-primary)] transition-all cursor-default">
              <div className="w-5 h-5 rounded-lg bg-green-50 text-green-600 flex items-center justify-center shrink-0 mt-0.5">
                <ChevronRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
              </div>
              <p className="text-[11px] font-medium text-[var(--text-primary)] leading-relaxed">{rec}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
