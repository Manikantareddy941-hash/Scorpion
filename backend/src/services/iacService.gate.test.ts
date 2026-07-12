import fs from 'fs';
import os from 'os';
import path from 'path';

// Simulates the containers: "checkov" writes checkov.json, "tofu" writes plan.json.
const runInContainer = jest.fn();
jest.mock('./dockerRunnerService', () => ({ dockerRunnerService: { runInContainer } }));

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'iac-gate-'));
process.env.IAC_DATA_DIR = DATA_DIR;
process.env.IAC_CRED_KEY = 'gate-test-key';

// require (not import) so IAC_DATA_DIR above is set before the module reads it
// eslint-disable-next-line @typescript-eslint/no-require-imports
const iac = require('./iacService') as typeof import('./iacService');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const creds = require('./iacCredentials') as typeof import('./iacCredentials');

const FAILED_CHECKOV = JSON.stringify({
    results: {
        failed_checks: [
            { check_id: 'CKV_AWS_20', check_name: 'S3 bucket has an ACL defined which allows public READ access', file_path: '/main.tf', file_line_range: [1, 5] },
        ],
    },
});
const CLEAN_CHECKOV = JSON.stringify({ results: { failed_checks: [] } });
const PLAN_JSON = JSON.stringify({ resource_changes: [{ address: 'aws_s3_bucket.b', change: { actions: ['create'] } }] });

function mockContainers(checkovOutput: string) {
    runInContainer.mockClear();
    runInContainer.mockImplementation(async ({ cmd, workspacePath }: { cmd: string[]; workspacePath: string }) => {
        const shellCmd = cmd.join(' ');
        if (shellCmd.includes('checkov')) {
            fs.writeFileSync(path.join(workspacePath, 'checkov.json'), checkovOutput);
        } else if (shellCmd.includes('show -json')) {
            fs.writeFileSync(path.join(workspacePath, 'plan.json'), PLAN_JSON);
        }
        return { exitCode: 0 };
    });
}

async function settledRun(wsId: string, runId: string) {
    for (let i = 0; i < 50; i++) {
        const run = await iac.getRun(wsId, runId);
        if (run && run.status !== 'running') return run;
        await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('run never settled');
}

afterAll(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

describe('checkov gate in startPlan', () => {
    it('blocks the run when checkov reports failed checks', async () => {
        mockContainers(FAILED_CHECKOV);
        const ws = await iac.createWorkspace('gated', 'resource "aws_s3_bucket" "b" {}');

        const started = await iac.startPlan(ws.id, false);
        const run = await settledRun(ws.id, started.id);

        expect(run.status).toBe('blocked');
        expect(run.gate?.passed).toBe(false);
        expect(run.gate?.findings).toHaveLength(1);
        expect(run.gate?.findings[0].message).toContain('CKV_AWS_20');
        // tofu never ran: only the checkov container was invoked
        expect(runInContainer).toHaveBeenCalledTimes(1);
    });

    it('proceeds to planned with overridden gate when forced', async () => {
        mockContainers(FAILED_CHECKOV);
        const ws = await iac.createWorkspace('forced', 'resource "aws_s3_bucket" "b" {}');

        const started = await iac.startPlan(ws.id, false, true);
        const run = await settledRun(ws.id, started.id);

        expect(run.status).toBe('planned');
        expect(run.gate?.passed).toBe(false);
        expect(run.gate?.overridden).toBe(true);
        expect(run.summary?.create).toBe(1);
    });

    it('passes the gate cleanly when checkov finds nothing', async () => {
        mockContainers(CLEAN_CHECKOV);
        const ws = await iac.createWorkspace('clean', 'output "x" { value = 1 }');

        const started = await iac.startPlan(ws.id, false);
        const run = await settledRun(ws.id, started.id);

        expect(run.status).toBe('planned');
        expect(run.gate?.passed).toBe(true);
        expect(run.gate?.overridden).toBe(false);
    });

    it('injects the linked credential profile env into tofu containers', async () => {
        mockContainers(CLEAN_CHECKOV);
        const profile = await creds.createProfile('aws-prod', 'aws', { AWS_ACCESS_KEY_ID: 'AKIAFROMPROFILE' });
        const ws = await iac.createWorkspace('with-creds', 'output "x" { value = 1 }', profile.id);

        const started = await iac.startPlan(ws.id, false);
        const run = await settledRun(ws.id, started.id);

        expect(run.status).toBe('planned');
        const tofuCall = runInContainer.mock.calls.find(c => c[0].cmd.join(' ').includes('tofu init'));
        expect(tofuCall[0].env).toContain('AWS_ACCESS_KEY_ID=AKIAFROMPROFILE');
        // the checkov gate container gets no cloud credentials
        const checkovCall = runInContainer.mock.calls.find(c => c[0].cmd.join(' ').includes('checkov'));
        expect(checkovCall[0].env ?? []).toHaveLength(0);
    });

    it('skips the gate entirely for destroy-plans', async () => {
        mockContainers(FAILED_CHECKOV);
        const ws = await iac.createWorkspace('destroyer', 'resource "aws_s3_bucket" "b" {}');

        const started = await iac.startPlan(ws.id, true);
        const run = await settledRun(ws.id, started.id);

        expect(run.status).toBe('planned');
        expect(run.gate).toBeUndefined();
        const cmds = runInContainer.mock.calls.map(c => c[0].cmd.join(' '));
        expect(cmds.some(c => c.includes('checkov'))).toBe(false);
    });
});
