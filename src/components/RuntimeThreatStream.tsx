// src/components/RuntimeThreatStream.tsx
import React, { useEffect, useState } from "react";

/**
 * Mock Falco event schema – mirrors the real Falco JSON payload.
 */
type FalcoEvent = {
  timestamp: string; // ISO string
  rule: string; // description of the triggered rule
  priority: "Critical" | "Warning" | "Notice"; // severity levels we care about
  container: string; // container/pod identifier
};

/** Utility to pick a random item from an array */
const sample = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

/** Generate a random mock Falco event */
const generateMockEvent = (): FalcoEvent => {
  const rules = [
    "Terminal shell spawned in container",
    "Unexpected outbound network connection",
    "Privileged container started",
    "File opened for write in read‑only filesystem",
    "Process executed with sudo inside container",
  ];
  const priorities: FalcoEvent["priority"][] = ["Critical", "Warning", "Notice"];
  const containers = [
    "scorpion-backend-pod-7f",
    "scorpion-frontend-pod-2a",
    "scorpion-worker-pod-9c",
    "scorpion-db-pod-1d",
  ];

  return {
    timestamp: new Date().toISOString(),
    rule: sample(rules),
    priority: sample(priorities),
    container: sample(containers),
  };
};

/**
 * RuntimeThreatStream – glass‑morphic scrolling log of live Falco alerts.
 */
export const RuntimeThreatStream: React.FC = () => {
  const [events, setEvents] = useState<FalcoEvent[]>([]);

  /** Add a new mock event every 5 seconds */
  useEffect(() => {
    const interval = setInterval(() => {
      setEvents((prev) => {
        const next = [generateMockEvent(), ...prev]; // newest on top
        // Keep at most 20 entries to avoid DOM bloat
        return next.slice(0, 20);
      });
    }, 5000);

    // Cleanup on unmount
    return () => clearInterval(interval);
  }, []);

  /** Optional auto‑expire after 5 minutes – uncomment if desired */
  // useEffect(() => {
  //   const timer = setInterval(() => {
  //     const cutoff = Date.now() - 5 * 60 * 1000; // 5 min ago
  //     setEvents((prev) => prev.filter((e) => new Date(e.timestamp).getTime() > cutoff));
  //   }, 60000);
  //   return () => clearInterval(timer);
  // }, []);

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
            const isCritical = ev.priority === "Critical";
            return (
              <div
                key={ev.timestamp}
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
                <div className="text-[9px] text-[var(--text-secondary)] font-mono group-hover:whitespace-normal group-hover:break-words truncate mt-0.5">{ev.container}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default RuntimeThreatStream;
