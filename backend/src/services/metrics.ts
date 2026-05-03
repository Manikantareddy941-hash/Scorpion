import { Registry, Counter, Histogram, Gauge } from 'prom-client';

export const register = new Registry();

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
