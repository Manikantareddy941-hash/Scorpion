// Policy-as-code evaluation via Open Policy Agent (OPA).
//
// This is additive to policyService.ts's hardcoded threshold checks, not a
// replacement: a security team can author/override a Rego policy per-repo
// via the `policies` collection (see policyRoutes.ts) without an engineering
// change, while the existing default-threshold gate keeps working unchanged
// for repos that don't opt in.
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';
import { resolveToolCommand } from '../utils/toolCheck';
import { logger, errorContext } from './logger';

const execFileAsync = promisify(execFile);
const OPA_TIMEOUT_MS = 10_000;

export const DEFAULT_GATE_POLICY_PATH = path.join(__dirname, '..', '..', 'policies', 'release_gate.rego');

export interface OpaEvaluation {
    allow: boolean;
    denyReasons: string[];
}

export const isOpaAvailable = async (): Promise<boolean> => {
    const resolved = await resolveToolCommand('opa');
    return resolved.status === 'installed';
};

/**
 * Evaluates `input` against a Rego policy (defaults to the bundled release
 * gate policy). `query` is the Rego rule path to read the decision from,
 * e.g. "data.scorpion.gate" to get back { allow, deny }.
 */
export const evaluatePolicy = async (
    input: Record<string, unknown>,
    options: { regoCode?: string; query?: string } = {}
): Promise<OpaEvaluation> => {
    const resolved = await resolveToolCommand('opa');
    if (resolved.status !== 'installed') {
        throw new Error(
            'OPA is not installed on this host. Install it from https://www.openpolicyagent.org/docs/latest/#running-opa ' +
            'to enable policy-as-code evaluation.'
        );
    }

    const query = options.query || 'data.scorpion.gate';
    const runId = randomBytes(6).toString('hex');
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `opa-input-${runId}.json`);
    const policyPath = options.regoCode
        ? path.join(tmpDir, `opa-policy-${runId}.rego`)
        : DEFAULT_GATE_POLICY_PATH;

    try {
        await fs.writeFile(inputPath, JSON.stringify(input), 'utf8');
        if (options.regoCode) {
            await fs.writeFile(policyPath, options.regoCode, 'utf8');
        }

        const { stdout } = await execFileAsync(
            resolved.cmd,
            [...resolved.prefixArgs, 'eval', '--format', 'json', '-i', inputPath, '-d', policyPath, query],
            { timeout: OPA_TIMEOUT_MS }
        );

        const parsed = JSON.parse(stdout);
        const decision = parsed.result?.[0]?.expressions?.[0]?.value ?? {};
        const denyReasons: string[] = Array.isArray(decision.deny) ? decision.deny : [];

        return { allow: decision.allow === true, denyReasons };
    } catch (err: any) {
        logger.error('[OPA] policy evaluation failed', {
            event: 'OPA_EVALUATION_FAILED',
            ...errorContext(err),
        });
        throw new Error(`OPA evaluation failed: ${err.message}`);
    } finally {
        await fs.unlink(inputPath).catch(() => {});
        if (options.regoCode) {
            await fs.unlink(policyPath).catch(() => {});
        }
    }
};

/** Builds the standard input shape the bundled release_gate.rego expects from a scan's stored details. */
export const buildScanGateInput = (scanDetails: Record<string, any>, environment: string): Record<string, unknown> => ({
    critical_count: scanDetails.critical_count || 0,
    high_count: scanDetails.high_count || 0,
    security_score: scanDetails.security_score || 0,
    environment,
    blocked_falco_rules_matched: scanDetails.blocked_falco_rules_matched || [],
});
