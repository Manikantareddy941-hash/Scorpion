import { Registry, Counter, Histogram, Gauge } from 'prom-client';
import os from 'os';

export const register = new Registry();

// --- Existing Metrics ---
export const scansTotal = new Counter({
  name: 'scorpion_scans_total',
  help: 'Total scans run',
  labelNames: ['scan_type', 'status'],
  registers: [register]
});

export const vulnerabilitiesFound = new Counter({
  name: 'scorpion_vulnerabilities_total',
  help: 'Total vulnerabilities detected',
  labelNames: ['severity', 'tool'],
  registers: [register]
});

export const ciGateDecisions = new Counter({
  name: 'scorpion_ci_gate_total',
  help: 'CI gate pass/fail decisions',
  labelNames: ['result'],
  registers: [register]
});

export const buildsTotal = new Counter({
  name: 'scorpion_builds_total',
  help: 'Total CI builds executed',
  labelNames: ['status', 'tool'],
  registers: [register]
});

export const buildDuration = new Histogram({
  name: 'scorpion_build_duration_seconds',
  help: 'Build pipeline duration in seconds',
  labelNames: ['tool'],
  buckets: [10, 30, 60, 120, 300, 600, 1200],
  registers: [register]
});

export const deploymentBlocks = new Counter({
  name: 'scorpion_deployment_blocks_total',
  help: 'Deployments blocked by GitOps gate',
  registers: [register]
});

export const runtimeThreats = new Counter({
  name: 'scorpion_runtime_threats_total',
  help: 'Falco runtime threats received',
  labelNames: ['priority'],
  registers: [register]
});

export const scanDuration = new Histogram({
  name: 'scorpion_scan_duration_seconds',
  help: 'Scan pipeline duration',
  labelNames: ['scan_type'],
  buckets: [5, 10, 30, 60, 120, 300],
  registers: [register]
});

export const activeScans = new Gauge({
  name: 'scorpion_active_scans',
  help: 'Currently running scans',
  registers: [register]
});

// --- New Metrics ---
export const cpuUsage = new Gauge({
  name: 'scorpion_cpu_usage_percent',
  help: 'Current CPU usage in percentage',
  registers: [register]
});

export const memoryUsage = new Gauge({
  name: 'scorpion_memory_usage_bytes',
  help: 'Current memory usage in bytes',
  registers: [register]
});

export const blockedCves = new Counter({
  name: 'scorpion_blocked_cves_total',
  help: 'Total CVEs blocked by policy',
  registers: [register]
});

// --- Rolling Buffer Logic ---
export interface TelemetrySnapshot {
  timestamp: number;
  cpu: number;
  mem: number;
}

const TELEMETRY_BUFFER_SIZE = 100;
export const telemetryBuffer: TelemetrySnapshot[] = [];

const updateMetrics = () => {
  // Memory
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memUsed = totalMem - freeMem;
  const memPercent = (memUsed / totalMem) * 100;
  memoryUsage.set(memUsed);

  // CPU (Simplified using loadavg as a proxy for this environment)
  const load = os.loadavg()[0]; 
  const cpuPercent = Math.min(100, Math.round(load * 10)); // Scale load to percentage
  cpuUsage.set(cpuPercent);

  // Update Buffer
  const snapshot: TelemetrySnapshot = {
    timestamp: Date.now(),
    cpu: cpuPercent,
    mem: Math.round(memPercent)
  };

  telemetryBuffer.push(snapshot);
  if (telemetryBuffer.length > TELEMETRY_BUFFER_SIZE) {
    telemetryBuffer.shift();
  }
};

// Start background task
setInterval(updateMetrics, 15000);
// Initial call
updateMetrics();
