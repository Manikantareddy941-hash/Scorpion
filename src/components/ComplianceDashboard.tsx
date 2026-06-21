// src/components/ComplianceDashboard.tsx
import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";

type MetricResponse = {
  noiseReductionPercentage: number; // e.g. 33.3
  complianceMapping: Record<string, number>; // key -> count
  averageMTTRMinutes: number; // e.g. 45
};

const ComplianceDashboard: React.FC = () => {
  const { getJWT } = useAuth();
  const [metrics, setMetrics] = useState<MetricResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const token = await getJWT();
        const res = await fetch("/api/dashboard/metrics", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (active) setMetrics(data);
      } catch (err: any) {
        console.error("Failed to load dashboard metrics", err);
        if (active) setError("Failed to load dashboard metrics");
      }
    };
    load();
    return () => { active = false; };
  }, [getJWT]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-red-400">
        {error}
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="flex items-center justify-center h-64 text-teal-400">
        Loading dashboard metrics…
      </div>
    );
  }

  // Helper to render compliance rows
  const renderComplianceRows = () => {
    const mapping = metrics.complianceMapping;
    const rows = Object.entries(mapping).map(([key, count]) => {
      let label = key;
      if (key.toLowerCase().includes("secret")) {
        label = "SOC 2 Trust Criteria CC6.1 (Credential Management)";
      } else if (key.toLowerCase().includes("sast")) {
        label = "ISO 27001 A.14.2.1 (Secure Development Policy)";
      }
      return (
        <tr key={key} className="border-b border-white/10">
          <td className="py-2 px-4 text-white/80">{label}</td>
          <td className="py-2 px-4 text-teal-400 font-medium">{count}</td>
        </tr>
      );
    });
    return rows;
  };

  return (
    <section className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6">
      {/* Card 1 – Noise Reduction */}
      <div className="bg-slate-950/40 backdrop-blur-xl border border-white/10 rounded-xl p-6 shadow-[0_0_20px_rgba(0,242,254,0.15)]">
        <h2 className="text-xl font-semibold text-white mb-4">Noise Reduction</h2>
        <div className="flex items-center justify-center">
          <span className="text-4xl font-extrabold text-teal-400 drop-shadow-[0_0_8px_rgba(0,242,254,0.6)]">
            {metrics.noiseReductionPercentage}%
          </span>
        </div>
        <p className="mt-2 text-sm text-white/70 text-center">
          Filtered out {metrics.noiseReductionPercentage}% of tool duplication noise
        </p>
      </div>

      {/* Card 2 – Compliance Matrix */}
      <div className="bg-slate-950/40 backdrop-blur-xl border border-white/10 rounded-xl p-6 shadow-[0_0_20px_rgba(0,242,254,0.15)] overflow-auto">
        <h2 className="text-xl font-semibold text-white mb-4">Compliance Matrix</h2>
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/20">
              <th className="text-left text-white/60">Standard</th>
              <th className="text-right text-white/60">Findings</th>
            </tr>
          </thead>
          <tbody>{renderComplianceRows()}</tbody>
        </table>
      </div>

      {/* Card 3 – MTTR Velocity */}
      <div className="bg-slate-950/40 backdrop-blur-xl border border-white/10 rounded-xl p-6 shadow-[0_0_20px_rgba(0,242,254,0.15)] flex flex-col justify-between">
        <h2 className="text-xl font-semibold text-white mb-4">Mean Time to Remediation</h2>
        <div className="flex items-center justify-center">
          <span className="text-5xl font-bold text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.8)]">
            {metrics.averageMTTRMinutes} min
          </span>
        </div>
        <p className="mt-2 text-sm text-white/70 text-center">
          Faster than legacy tools by a large margin
        </p>
      </div>
    </section>
  );
};

export default ComplianceDashboard;
