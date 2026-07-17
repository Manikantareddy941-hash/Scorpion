// backend/src/services/iacService.ts
// IaC engine: runs OpenTofu (Terraform-compatible, MPL-licensed) in an isolated
// container per workspace. Plan → human approval → apply, with the saved binary
// plan file guaranteeing what was approved is exactly what gets applied.
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { dockerRunnerService } from './dockerRunnerService';
import { parseCheckov } from './scan/parsers';
import { getProfileEnv } from './iacCredentials';
import { logger } from './logger';
import { acquireLock, releaseLock } from '../utils/redisLock';

const TOFU_IMAGE = process.env.IAC_TOFU_IMAGE || 'ghcr.io/opentofu/opentofu:1.12';
const CHECKOV_IMAGE = process.env.IAC_CHECKOV_IMAGE || 'bridgecrew/checkov:latest';
// ponytail: filesystem store (workspace.json / runs/*.json / tfstate on disk).
// Move to Appwrite collections when the UI needs cross-workspace queries.
const DATA_DIR = process.env.IAC_DATA_DIR || path.join(process.cwd(), 'data', 'iac');
const MAX_LOG_LINES = 2000;

export type IacRunStatus = 'running' | 'blocked' | 'planned' | 'applying' | 'applied' | 'failed';

export interface IacWorkspace {
    id: string;
    name: string;
    credentialProfileId?: string | null;
    createdAt: string;
}

export interface PlanSummary {
    create: number;
    update: number;
    delete: number;
    replace: number;
    changes: { address: string; actions: string[] }[];
}

export interface GateResult {
    passed: boolean;
    overridden: boolean;
    findings: { message: string; severity: string; file_path?: string; line_number?: number }[];
}

export interface IacRun {
    id: string;
    workspaceId: string;
    destroy: boolean;
    status: IacRunStatus;
    gate?: GateResult;
    summary?: PlanSummary;
    logs: string[];
    createdAt: string;
    updatedAt: string;
}

// Distributed per-workspace lease (Redis-backed, in-process fallback in dev)
// so concurrent plans/applies stay exclusive across backend replicas.
// ponytail: 30-min lease with no renewal — an apply that outlives it loses
// exclusivity; add lease renewal if applies ever run that long.
const IAC_LOCK_TTL_MS = 30 * 60 * 1000;
const wsLockKey = (wsId: string) => `iac:ws-lock:${wsId}`;

const wsDir = (id: string) => path.join(DATA_DIR, id);
const runPath = (wsId: string, runId: string) => path.join(wsDir(wsId), 'runs', `${runId}.json`);

async function saveRun(run: IacRun): Promise<void> {
    await fs.writeFile(runPath(run.workspaceId, run.id), JSON.stringify(run, null, 2));
}

/** Parses `tofu show -json tfplan` output into create/update/delete/replace counts. */
export function summarizePlan(planJson: { resource_changes?: { address: string; change?: { actions?: string[] } }[] }): PlanSummary {
    const summary: PlanSummary = { create: 0, update: 0, delete: 0, replace: 0, changes: [] };
    for (const rc of planJson.resource_changes ?? []) {
        const actions = rc.change?.actions ?? [];
        if (actions.length === 1 && actions[0] === 'no-op') continue;
        if (actions.includes('create') && actions.includes('delete')) summary.replace++;
        else if (actions.includes('create')) summary.create++;
        else if (actions.includes('delete')) summary.delete++;
        else if (actions.includes('update')) summary.update++;
        summary.changes.push({ address: rc.address, actions });
    }
    return summary;
}

// Fallback when a workspace has no credential profile: pass through the
// backend's own AWS env vars (the original phase-1 behavior).
function cloudEnv(): string[] {
    const keys = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_DEFAULT_REGION', 'AWS_REGION'];
    return keys.filter(k => process.env[k]).map(k => `${k}=${process.env[k]}`);
}

/** Linked credential profile env (decrypted at launch only), else backend env fallback. */
async function resolveEnv(workspaceId: string): Promise<string[]> {
    const workspace = await getWorkspace(workspaceId);
    if (workspace?.credentialProfileId) return getProfileEnv(workspace.credentialProfileId);
    return cloudEnv();
}

async function runTofu(workspaceId: string, shellCmd: string, sink: (line: string) => void): Promise<number> {
    const { exitCode } = await dockerRunnerService.runInContainer({
        image: TOFU_IMAGE,
        entrypoint: ['/bin/sh', '-c'],
        cmd: [shellCmd],
        workspacePath: wsDir(workspaceId),
        env: await resolveEnv(workspaceId),
        logger: { log: sink },
    });
    return exitCode;
}

/**
 * Security gate: scans the workspace config with Checkov before planning.
 * Checkov exits non-zero when checks fail, so `|| true` keeps the container
 * exit clean and the JSON report is the source of truth.
 */
async function runCheckovGate(wsId: string, force: boolean, sink: (line: string) => void): Promise<GateResult> {
    sink('[IaC Gate] Running Checkov IaC security scan...');
    await dockerRunnerService.runInContainer({
        image: CHECKOV_IMAGE,
        entrypoint: ['/bin/sh', '-c'],
        cmd: ['checkov -d /workspace -o json --quiet > /workspace/checkov.json || true'],
        workspacePath: wsDir(wsId),
        logger: { log: sink },
    });
    const raw = await fs.readFile(path.join(wsDir(wsId), 'checkov.json'), 'utf8');
    const findings = parseCheckov(raw).map(f => ({
        message: f.message,
        severity: f.severity,
        file_path: f.file_path,
        line_number: f.line_number,
    }));
    const passed = findings.length === 0;
    sink(`[IaC Gate] ${passed ? 'PASSED — no failed checks' : `${findings.length} failed check(s)${force ? ' — OVERRIDDEN by force flag' : ''}`}`);
    return { passed, overridden: !passed && force, findings };
}

export async function createWorkspace(name: string, config: string, credentialProfileId?: string | null): Promise<IacWorkspace> {
    const workspace: IacWorkspace = {
        id: crypto.randomUUID(),
        name,
        credentialProfileId: credentialProfileId ?? null,
        createdAt: new Date().toISOString(),
    };
    await fs.mkdir(path.join(wsDir(workspace.id), 'runs'), { recursive: true });
    await fs.writeFile(path.join(wsDir(workspace.id), 'workspace.json'), JSON.stringify(workspace, null, 2));
    await fs.writeFile(path.join(wsDir(workspace.id), 'main.tf'), config);
    return workspace;
}

export async function listWorkspaces(): Promise<IacWorkspace[]> {
    let ids: string[] = [];
    try {
        ids = await fs.readdir(DATA_DIR);
    } catch {
        return []; // data dir not created yet
    }
    const workspaces: IacWorkspace[] = [];
    for (const id of ids) {
        try {
            workspaces.push(JSON.parse(await fs.readFile(path.join(wsDir(id), 'workspace.json'), 'utf8')));
        } catch { /* not a workspace dir */ }
    }
    return workspaces;
}

export async function getWorkspace(id: string): Promise<IacWorkspace | null> {
    try {
        return JSON.parse(await fs.readFile(path.join(wsDir(id), 'workspace.json'), 'utf8'));
    } catch {
        return null;
    }
}

export async function getConfig(id: string): Promise<string> {
    return fs.readFile(path.join(wsDir(id), 'main.tf'), 'utf8');
}

export async function updateConfig(id: string, config: string): Promise<void> {
    await fs.writeFile(path.join(wsDir(id), 'main.tf'), config);
}

export async function setWorkspaceCredential(id: string, credentialProfileId: string | null): Promise<IacWorkspace> {
    const workspace = await getWorkspace(id);
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
    const updated: IacWorkspace = { ...workspace, credentialProfileId };
    await fs.writeFile(path.join(wsDir(id), 'workspace.json'), JSON.stringify(updated, null, 2));
    return updated;
}

export async function getRun(wsId: string, runId: string): Promise<IacRun | null> {
    try {
        return JSON.parse(await fs.readFile(runPath(wsId, runId), 'utf8'));
    } catch {
        return null;
    }
}

export async function listRuns(wsId: string): Promise<IacRun[]> {
    let files: string[] = [];
    try {
        files = await fs.readdir(path.join(wsDir(wsId), 'runs'));
    } catch {
        return [];
    }
    const runs: IacRun[] = [];
    for (const f of files.filter(f => f.endsWith('.json'))) {
        try {
            runs.push(JSON.parse(await fs.readFile(path.join(wsDir(wsId), 'runs', f), 'utf8')));
        } catch { /* skip corrupt run file */ }
    }
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function makeSink(run: IacRun): (line: string) => void {
    return (line: string) => {
        if (run.logs.length < MAX_LOG_LINES) run.logs.push(line);
    };
}

/** Starts an async plan (or destroy-plan). Returns immediately; poll the run for status. */
export async function startPlan(wsId: string, destroy: boolean, force = false): Promise<IacRun> {
    const lock = await acquireLock(wsLockKey(wsId), IAC_LOCK_TTL_MS);
    if (!lock) throw new Error('WORKSPACE_BUSY');

    const run: IacRun = {
        id: crypto.randomUUID(),
        workspaceId: wsId,
        destroy,
        status: 'running',
        logs: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    await saveRun(run);

    void (async () => {
        const sink = makeSink(run);
        try {
            // Destroy-plans skip the gate: removing infrastructure introduces no misconfiguration.
            if (!destroy) {
                run.gate = await runCheckovGate(wsId, force, sink);
                if (!run.gate.passed && !force) {
                    run.status = 'blocked';
                    return;
                }
            }
            const planFlags = `-input=false -no-color -out=tfplan${destroy ? ' -destroy' : ''}`;
            const cmd = `tofu init -input=false -no-color && tofu plan ${planFlags} && tofu show -json tfplan > plan.json`;
            const exitCode = await runTofu(wsId, cmd, sink);
            if (exitCode !== 0) throw new Error(`plan exited with code ${exitCode}`);
            const planJson = JSON.parse(await fs.readFile(path.join(wsDir(wsId), 'plan.json'), 'utf8'));
            run.summary = summarizePlan(planJson);
            run.status = 'planned';
        } catch (err) {
            run.status = 'failed';
            sink(`[IaC] Plan failed: ${err instanceof Error ? err.message : String(err)}`);
            logger.error(`[IaC] Plan failed for workspace ${wsId}: ${err instanceof Error ? err.message : err}`);
        } finally {
            await releaseLock(lock);
            run.updatedAt = new Date().toISOString();
            await saveRun(run).catch(e => logger.error(`[IaC] Failed to persist run: ${e.message}`));
        }
    })();

    return run;
}

/** Approval gate: applies the exact saved tfplan of a 'planned' run — nothing else. */
export async function approveApply(wsId: string, runId: string): Promise<IacRun> {
    const run = await getRun(wsId, runId);
    if (!run) throw new Error('RUN_NOT_FOUND');
    if (run.status !== 'planned') throw new Error('RUN_NOT_APPROVABLE');
    const lock = await acquireLock(wsLockKey(wsId), IAC_LOCK_TTL_MS);
    if (!lock) throw new Error('WORKSPACE_BUSY');

    run.status = 'applying';
    run.updatedAt = new Date().toISOString();
    await saveRun(run);

    void (async () => {
        const sink = makeSink(run);
        try {
            const exitCode = await runTofu(wsId, 'tofu apply -input=false -no-color tfplan', sink);
            run.status = exitCode === 0 ? 'applied' : 'failed';
            if (exitCode !== 0) sink(`[IaC] Apply exited with code ${exitCode}`);
        } catch (err) {
            run.status = 'failed';
            sink(`[IaC] Apply failed: ${err instanceof Error ? err.message : String(err)}`);
            logger.error(`[IaC] Apply failed for workspace ${wsId}: ${err instanceof Error ? err.message : err}`);
        } finally {
            await releaseLock(lock);
            run.updatedAt = new Date().toISOString();
            await saveRun(run).catch(e => logger.error(`[IaC] Failed to persist run: ${e.message}`));
        }
    })();

    return run;
}
