import { logger } from './logger';

export const logScanStarted = (repo: string, scanType: string) =>
  logger.info('scan_started', { repo, scanType, event: 'scan_started' });

export const logScanCompleted = (repo: string, criticalCount: number, passed: boolean) =>
  logger.info('scan_completed', { repo, criticalCount, passed, event: 'scan_completed' });

export const logCIGateBlocked = (repo: string, sha: string, reason: string) =>
  logger.warn('ci_gate_blocked', { repo, sha, reason, event: 'ci_gate_blocked' });

export const logRuntimeThreat = (rule: string, priority: string, image: string, correlated: boolean) =>
  logger.error('runtime_threat', { rule, priority, image, correlated, event: 'runtime_threat' });

export const logDeployBlocked = (app: string, image: string, criticalCount: number) =>
  logger.warn('deploy_blocked', { app, image, criticalCount, event: 'deploy_blocked' });

export const logRollbackTriggered = (app: string, revision: string) =>
  logger.warn('rollback_triggered', { app, revision, event: 'rollback_triggered' });
