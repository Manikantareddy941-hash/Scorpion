// src/components/RuntimeThreatStream.tsx
import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";

type RuntimeThreat = {
  id: string;
  timestamp: string;
  rule: string;
  priority: string;
  containerId: string;
};

/**
 * RuntimeThreatStream – glass‑morphic scrolling log of live Falco alerts,
 * backed by GET /api/threats (tenant-scoped runtime threat feed).
 */
export const RuntimeThreatStream: React.FC = () => {
  const { getJWT } = useAuth();
  const [events, setEvents] = useState<RuntimeThreat[]>([]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const token = await getJWT();
        const res = await fetch('/api/threats', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok || !active) return;
        const docs = await res.json();
        if (!active) return;
        setEvents(
          (Array.isArray(docs) ? docs : [])
            .slice(0, 20)
            .map((d: any) => ({
              id: d.$id,
              timestamp: d.timestamp || d.$createdAt,
              rule: d.rule,
              priority: d.priority,
              containerId: d.containerId,
            }))
        );
      } catch {
        // keep showing the last known events on a transient fetch failure
      }
    };

    load();
    const interval = setInterval(load, 15000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [getJWT]);

  const totalAnomalies = events.length;

  return (
    <div className="bg-[var(--bg-card)] rounded-[16px] p-6 shadow-[0_4px_16px_rgba(0,0,0,0.04)] h-full flex flex-col border border-[var(--border-subtle)] group relative z-10 transition-all duration-300 ease-in-out hover:z-50 hover:scale-[1.03] hover:shadow-2xl">
      <div className="mb-4">
        <h3 className="text-[11px] font-black text-[var(--text-primary)] uppercase tracking-wider">Runtime Threat Stream</h3>
        <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase mt-0.5">
          Active anomalies intercepted: <span className="text-[var(--accent-primary)] font-black">{totalAnomalies}</span>
        </p>
      </div>

      {/* Scrollable log container */}
      <div className="max-h-[350px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
        {events.length === 0 ? (
          <div className="text-center py-12 text-[10px] text-[var(--text-secondary)] uppercase tracking-widest italic">
            Scanning kernel events...
          </div>
        ) : (
          events.map((ev) => {
            const isCritical = ev.priority === "Critical" || ev.priority === "Error";
            return (
              <div
                key={ev.id}
                className={`bg-[var(--bg-primary)]/40 rounded-[12px] p-3 border border-[var(--border-subtle)] border-l-4 ${
                  isCritical ? 'border-l-red-500' : ev.priority === 'Warning' ? 'border-l-amber-500' : 'border-l-teal-400'
                } flex flex-col transition-all hover:scale-[1.01]`}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className={`text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${
                    isCritical ? 'bg-red-500/10 text-red-500' : ev.priority === 'Warning' ? 'bg-amber-500/10 text-amber-500' : 'bg-teal-500/10 text-teal-400'
                  }`}>
                    {ev.priority}
                  </span>
                  <span className="text-[8px] font-mono text-[var(--text-secondary)]">
                    {new Date(ev.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-[11px] font-black text-[var(--text-primary)] group-hover:whitespace-normal group-hover:break-words truncate">{ev.rule}</div>
                <div className="text-[9px] text-[var(--text-secondary)] font-mono group-hover:whitespace-normal group-hover:break-words truncate mt-0.5">{ev.containerId}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default RuntimeThreatStream;
