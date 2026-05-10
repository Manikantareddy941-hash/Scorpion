import React, { useEffect, useRef, useState } from "react";
import { Shield, CheckCircle, XCircle, Loader2, ExternalLink, Terminal, Clock, FileCode, AlertCircle, Play } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";

interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'progress' | 'error' | 'success';
}

interface UVScanOverlayProps {
  isScanning: boolean;
  progress?: number;
  repoName?: string;
  scanId?: string;
  logs?: LogEntry[];
  stats?: {
    filesScanned: number;
    issuesFound: number;
    duration: string;
    status: string;
  };
  onClose?: () => void;
  onRunInBackground?: () => void;
  onCancel?: () => void;
  resultsSummary?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    score: number;
    policy: string;
  };
}

export default function UVScanOverlay({ 
  isScanning, 
  progress = 0, 
  repoName = "Repository", 
  scanId,
  logs = [],
  stats = { filesScanned: 0, issuesFound: 0, duration: "00:00", status: "RUNNING" },
  onClose,
  onRunInBackground,
  onCancel,
  resultsSummary
}: UVScanOverlayProps) {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  if (!isScanning) return null;

  const isComplete = progress === 100;
  const isFailed = stats.status === 'FAILED';

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className={theme === 'liquid-glass' ? 'liquid-glass' : ''} style={{ 
        position: "relative", 
        width: "560px", 
        background: theme === 'liquid-glass' ? 'transparent' : 'var(--bg-card)', 
        borderRadius: "16px", 
        border: theme === 'liquid-glass' ? 'none' : "1px solid var(--border-subtle)",
        boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column"
      }}>
        
        {/* Top Slim Progress Bar */}
        <div style={{ height: "4px", width: "100%", background: "rgba(0,0,0,0.1)", position: "absolute", top: 0, left: 0, zIndex: 10 }}>
          <div style={{ 
            height: "100%", 
            width: `${progress}%`, 
            background: isComplete ? "#00ff41" : isFailed ? "#ff4444" : "var(--accent-primary)", 
            transition: "width 0.5s ease" 
          }} />
        </div>

        {/* Header */}
        <div style={{ padding: "24px 24px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
            <div style={{ 
              width: "32px", 
              height: "32px", 
              borderRadius: "8px", 
              background: isComplete ? "rgba(0,255,65,0.1)" : "rgba(var(--accent-primary-rgb), 0.1)", 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center",
              color: isComplete ? "#00ff41" : "var(--accent-primary)"
            }}>
              {isComplete ? <CheckCircle size={20} /> : <Shield size={20} />}
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "0.05em" }}>
                {isComplete ? "SCAN COMPLETE" : "SCANNING IN PROGRESS"}
              </h3>
              <p style={{ margin: 0, fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" }}>
                {repoName}
              </p>
            </div>
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
                <span style={{ fontSize: "24px", fontWeight: 900, color: isComplete ? "#00ff41" : "var(--text-primary)" }}>{progress}%</span>
            </div>
          </div>
        </div>

        {/* Terminal Area */}
        <div style={{ 
          padding: "16px", 
          background: "#121212", 
          margin: "16px 24px", 
          borderRadius: "8px", 
          height: "240px", 
          overflowY: "auto",
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: "12px",
          color: "#e0e0e0",
          border: "1px solid rgba(255,255,255,0.05)"
        }}>
          {logs.map((log, i) => (
            <div key={i} style={{ marginBottom: "6px", display: "flex", gap: "10px", lineHeight: 1.4 }}>
              <span style={{ color: "#666", flexShrink: 0 }}>[{log.timestamp}]</span>
              <span style={{ 
                color: log.type === 'success' ? '#00ff41' : log.type === 'progress' ? '#ffd700' : log.type === 'error' ? '#ff4444' : '#e0e0e0',
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}>
                {log.type === 'success' && <span style={{ fontWeight: "bold" }}>✓</span>}
                {log.type === 'progress' && <span style={{ animation: "spin 2s linear infinite", display: "inline-block" }}>⟳</span>}
                {log.type === 'error' && <span style={{ fontWeight: "bold" }}>✗</span>}
                {log.message}
              </span>
            </div>
          ))}
          {isComplete && resultsSummary && (
            <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px dashed rgba(255,255,255,0.1)", color: "#00ff41", fontWeight: "bold" }}>
              <div>[SUMMARY] Critical: {resultsSummary.critical} | High: {resultsSummary.high} | Medium: {resultsSummary.medium} | Low: {resultsSummary.low}</div>
              <div>[POSTURE] Score: {resultsSummary.score}% | Policy: {resultsSummary.policy}</div>
            </div>
          )}
          <div ref={logEndRef} />
        </div>

        {/* Status Indicators */}
        <div style={{ padding: "0 24px 20px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
          {[
            { label: "FILES SCANNED", value: stats.filesScanned, icon: FileCode },
            { label: "ISSUES FOUND", value: stats.issuesFound, icon: AlertCircle, color: stats.issuesFound > 0 ? "#ff4444" : undefined },
            { label: "DURATION", value: stats.duration, icon: Clock },
            { label: "STATUS", value: stats.status, icon: stats.status === 'RUNNING' ? Loader2 : stats.status === 'COMPLETE' ? CheckCircle : XCircle, isPulsing: stats.status === 'RUNNING' }
          ].map((item, i) => (
            <div key={i} style={{ 
              background: "rgba(var(--text-primary-rgb), 0.03)", 
              border: "1px solid var(--border-subtle)", 
              borderRadius: "100px", 
              padding: "6px 12px", 
              display: "flex", 
              alignItems: "center", 
              gap: "8px" 
            }}>
              <item.icon size={12} style={{ color: item.color || "var(--text-secondary)", animation: item.isPulsing ? "spin 2s linear infinite" : "none" }} />
              <span style={{ fontSize: "9px", fontWeight: 800, color: "var(--text-secondary)", letterSpacing: "0.05em" }}>{item.label}:</span>
              <span style={{ fontSize: "10px", fontWeight: 900, color: item.color || "var(--text-primary)" }}>
                {item.label === 'STATUS' && item.isPulsing && (
                  <span style={{ display: "inline-block", width: "6px", height: "6px", background: "#00ff41", borderRadius: "50%", marginRight: "6px", boxShadow: "0 0 8px #00ff41" }}></span>
                )}
                {item.value}
              </span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div style={{ padding: "20px 24px", background: "rgba(var(--text-primary-rgb), 0.02)", borderTop: "1px solid var(--border-subtle)", display: "flex", gap: "12px", justifyContent: "flex-end" }}>
          {!isComplete ? (
            <>
              <button 
                onClick={onCancel}
                style={{ background: "transparent", border: "1px solid #ff4444", color: "#ff4444", borderRadius: "8px", padding: "8px 16px", fontSize: "12px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "8px" }}
              >
                <XCircle size={14} /> Cancel Scan
              </button>
              <button 
                onClick={onRunInBackground}
                style={{ background: "transparent", border: "1px solid var(--border-subtle)", color: "var(--text-primary)", borderRadius: "8px", padding: "8px 16px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}
              >
                Run in Background
              </button>
              <button 
                onClick={() => scanId && navigate(`/scans/${scanId}`)}
                style={{ background: "var(--accent-primary)", border: "none", color: "white", borderRadius: "8px", padding: "8px 16px", fontSize: "12px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "8px" }}
              >
                View Live Results <ExternalLink size={14} />
              </button>
            </>
          ) : (
            <>
               <button 
                onClick={onClose}
                style={{ background: "transparent", border: "1px solid var(--border-subtle)", color: "var(--text-primary)", borderRadius: "8px", padding: "8px 16px", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}
              >
                Close
              </button>
              <button 
                onClick={() => scanId && navigate(`/scans/${scanId}`)}
                style={{ background: "#00ff41", border: "none", color: "white", borderRadius: "8px", padding: "10px 24px", fontSize: "13px", fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", gap: "8px" }}
              >
                View Full Report <CheckCircle size={16} />
              </button>
            </>
          )}
        </div>

      </div>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}