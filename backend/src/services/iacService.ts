// backend/src/services/iacService.ts
// IaC engine: runs OpenTofu (Terraform-compatible, MPL-licensed) in an isolated
// container per workspace. Plan → human approval → apply, with the saved binary
// plan file guaranteeing what was approved is exactly what gets applied.
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { dockerRunnerService } from './dockerRunnerService';
import { logger } from './logger';

const TOFU_IMAGE = process.env.IAC_TOFU_IMAGE || 'ghcr.io/opentofu/opentofu:1.8';
// ponytail: filesystem store (workspace.json / runs/*.json / tfstate on disk).
// Move to Appwrite collections when the UI needs cross-workspace queries.
const DATA_DIR = process.env.IAC_DATA_DIR || path.join(process.cwd(), 'data', 'iac');
const MAX_LOG_LINES = 2000;

export type IacRunStatus = 'running' | 'planned' | 'applying' | 'applied' | 'failed';

export interface IacWorkspace {
    id: string;
    name: string;
    createdAt: string;
}

export interface PlanSummary {
    create: number;
    update: number;
    delete: number;
    replace: number;
    changes: { address: string; actions: string[] }[];
}

export interface IacRun {
    id: string;
    workspaceId: string;
    destroy: boolean;
    status: IacRunStatus;
    summary?: PlanSummary;
    logs: string[];
    createdAt: string;
    updatedAt: string;
}

// ponytail: in-process per-workspace lock; per-instance is fine while the
// backend is a single process. Move to a Redis lock if it ever scales out.
const busyWorkspaces = new Set<string>();

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

// ponytail: cloud creds come from backend env for now (AWS first). Per-project
// encrypted credential profiles are the phase-3 upgrade path.
function cloudEnv(): string[] {
    const keys = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_DEFAULT_REGION', 'AWS_REGION'];
    return keys.filter(k => process.env[k]).map(k => `${k}=${process.env[k]}`);
}

async function runTofu(workspaceId: string, shellCmd: string, sink: (line: string) => void): Promise<number> {
    const { exitCode } = await dockerRunnerService.runInContainer({
        image: TOFU_IMAGE,
        entrypoint: ['/bin/sh', '-c'],
        cmd: [shellCmd],
        workspacePath: wsDir(workspaceId),
        env: cloudEnv(),
        logger: { log: sink },
    });
    return exitCode;
}

export async function createWorkspace(name: string, config: string): Promise<IacWorkspace> {
    const workspace: IacWorkspace = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() };
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
export async function startPlan(wsId: string, destroy: boolean): Promise<IacRun> {
    if (busyWorkspaces.has(wsId)) throw new Error('WORKSPACE_BUSY');
    busyWorkspaces.add(wsId);

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
            busyWorkspaces.delete(wsId);
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
    if (busyWorkspaces.has(wsId)) throw new Error('WORKSPACE_BUSY');
    busyWorkspaces.add(wsId);

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
            busyWorkspaces.delete(wsId);
            run.updatedAt = new Date().toISOString();
            await saveRun(run).catch(e => logger.error(`[IaC] Failed to persist run: ${e.message}`));
        }
    })();

    return run;
}
