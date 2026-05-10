import React, { createContext, useContext, useState, useEffect } from 'react';

interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'progress' | 'error' | 'success';
}

interface ScanState {
  isScanning: boolean;
  progress: number;
  repoName: string;
  scanId: string;
  logs: LogEntry[];
  duration: string;
  stats: {
    filesScanned: number;
    issuesFound: number;
    status: string;
  };
  resultsSummary?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    score: number;
    policy: string;
  };
}

interface ScanContextType {
  activeScan: ScanState | null;
  startScan: (repoName: string, scanId: string) => void;
  updateScan: (updates: Partial<ScanState>) => void;
  addLog: (message: string, type?: 'info' | 'progress' | 'error' | 'success') => void;
  completeScan: (summary: any) => void;
  failScan: (error: string) => void;
  clearScan: () => void;
}

const ScanContext = createContext<ScanContextType | undefined>(undefined);

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const [activeScan, setActiveScan] = useState<ScanState | null>(null);

  const startScan = (repoName: string, scanId: string) => {
    setActiveScan({
      isScanning: true,
      progress: 5,
      repoName,
      scanId,
      logs: [{
        timestamp: new Date().toLocaleTimeString([], { hour12: false }),
        message: 'Initiating scan protocol...',
        type: 'info'
      }],
      duration: "00:00",
      stats: {
        filesScanned: 0,
        issuesFound: 0,
        status: "RUNNING"
      }
    });
  };

  const updateScan = (updates: Partial<ScanState>) => {
    setActiveScan(prev => prev ? { ...prev, ...updates } : null);
  };

  const addLog = (message: string, type: 'info' | 'progress' | 'error' | 'success' = 'info') => {
    const timestamp = new Date().toLocaleTimeString([], { hour12: false });
    setActiveScan(prev => prev ? {
      ...prev,
      logs: [...prev.logs, { timestamp, message, type }]
    } : null);
  };

  const completeScan = (summary: any) => {
    setActiveScan(prev => prev ? {
      ...prev,
      progress: 100,
      stats: { ...prev.stats, status: 'COMPLETE' },
      resultsSummary: summary
    } : null);
  };

  const failScan = (error: string) => {
    addLog(`Scan failed: ${error}`, 'error');
    setActiveScan(prev => prev ? {
      ...prev,
      stats: { ...prev.stats, status: 'FAILED' }
    } : null);
  };

  const clearScan = () => {
    setActiveScan(null);
  };

  return (
    <ScanContext.Provider value={{ activeScan, startScan, updateScan, addLog, completeScan, failScan, clearScan }}>
      {children}
    </ScanContext.Provider>
  );
}

export function useScan() {
  const context = useContext(ScanContext);
  if (context === undefined) {
    throw new Error('useScan must be used within a ScanProvider');
  }
  return context;
}
