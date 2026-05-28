import React, { useEffect, useState } from 'react';
import { Shield, TrendingUp, ChevronRight, CheckCircle2, AlertTriangle, Info, Zap } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { TopVulnerabilities } from './TopVulnerabilities';

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
  const navigate = useNavigate();
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

  const handleRecommendationClick = (rec: string) => {
    const text = rec.toLowerCase();
    if (text.includes('ci gate') || text.includes('gate')) {
      navigate('/release');
    } else if (text.includes('scan') || text.includes('vulnerability')) {
      navigate('/tests');
    } else if (text.includes('task') || text.includes('finding')) {
      navigate('/tasks');
    } else {
      navigate('/tasks');
    }
  };

  if (loading) return <div className="h-64 bg-[var(--bg-card)] animate-pulse rounded-[16px]"></div>;

// Fallback data when API fails
const displayData: PostureData = data ?? {
  score: Math.round(ciGateRate) || 0,
  breakdown: [
    { category: 'Critical Vulnerabilities', impact: 0 },
    { category: 'High Vulnerabilities', impact: 0 },
    { category: 'Medium Vulnerabilities', impact: 0 },
    { category: 'CI Gate Compliance', impact: ciGateRate < 50 ? 30 : ciGateRate < 80 ? 10 : 0 },
  ],
  recommendations: ['Run a scan to populate posture data.']
};

  return (
    <div className={`bg-[var(--bg-card)] rounded-[16px] ${compact ? 'p-4' : 'p-6'} shadow-[0_4px_16px_rgba(0,0,0,0.04)] h-full flex flex-col border border-[var(--border-subtle)]`}>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h3 className="text-xs font-bold tracking-wider text-[#2d3728] uppercase">
            Postural Health Breakdown
          </h3>
          <p className="text-[10px] text-[#7a8275] uppercase font-mono mt-0.5">
            Impact Analysis & Remediation
          </p>
        </div>
        <div className="text-right">
          <span className="text-2xl font-bold text-emerald-600 font-mono tracking-tight">{displayData.score}%</span>
          <div className="text-[9px] text-[#7a8275] font-mono tracking-wider mt-0.5">GLOBAL SCORE</div>
        </div>
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
        <div className="mt-6 p-3 bg-[#fdfbf7] border border-[#e6e2da] rounded-lg flex items-center gap-2">
          <span className="text-emerald-600 text-xs font-mono">→</span>
          <p className="text-[11px] text-[#2d3728] font-mono leading-none">
            CI gate is passing at {ciGateRate}%. Keep maintaining policy compliance.
          </p>
        </div>
    </div>
  );
}
