/**
 * End-to-end scan verification against a real repository.
 *
 * Runs the production orchestrator (the same one scanService uses), then the
 * normalizer, and reports what each scanner actually produced. Does not write
 * to Appwrite - persistence is exercised separately so a storage failure cannot
 * be mistaken for a scanning failure.
 *
 * Usage: npx ts-node src/scripts/e2e_real_scan.ts <path-to-repo>
 */
import { orchestrateScan } from '../services/scan/orchestrator';
import {
  normalizeSemgrep,
  normalizeTrivy,
  normalizeGitleaks,
  type NormalizedIssue,
} from '../scanners/normalizer';

const target = process.argv[2];
if (!target) {
  console.error('usage: e2e_real_scan.ts <path-to-repo>');
  process.exit(1);
}

(async () => {
  console.log(`scanning ${target}\n`);
  const started = Date.now();

  const results = await orchestrateScan(target, { scanType: 'full' });

  console.log(`orchestrator finished in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

  for (const r of results) {
    const parsedLen = r.stdout ? r.stdout.length : 0;
    console.log(`--- ${r.tool} ---`);
    console.log(`  unavailable: ${r.unavailable === true}`);
    console.log(`  exit status: ${r.status}`);
    console.log(`  stdout bytes: ${parsedLen}`);
    if (r.error) console.log(`  error: ${String(r.error).slice(0, 200)}`);
    if (r.stderr && !r.unavailable) console.log(`  stderr: ${r.stderr.slice(0, 200)}`);
  }

  console.log('\n=== normalized findings ===');
  const findings: NormalizedIssue[] = [];
  const parse = (raw: string) => { try { return JSON.parse(raw); } catch { return null; } };

  for (const r of results) {
    if (r.unavailable || !r.stdout) continue;
    const raw = parse(r.stdout);
    if (raw === null) {
      console.log(`  ${r.tool}: stdout is not JSON (${r.stdout.slice(0, 80)}...)`);
      continue;
    }
    try {
      if (r.tool === 'semgrep') findings.push(...normalizeSemgrep(raw, target));
      else if (r.tool === 'trivy') findings.push(...normalizeTrivy(raw, target));
      else if (r.tool === 'gitleaks') findings.push(...normalizeGitleaks(raw, target));
    } catch (e) {
      console.log(`  ${r.tool}: normalizer threw -> ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`total normalized findings: ${findings.length}`);

  const bySeverity: Record<string, number> = {};
  const byTool: Record<string, number> = {};
  for (const f of findings) {
    const sev = String(f.severity ?? 'UNKNOWN').toUpperCase();
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
    byTool[String(f.tool ?? 'unknown')] = (byTool[String(f.tool ?? 'unknown')] ?? 0) + 1;
  }
  console.log('by severity:', JSON.stringify(bySeverity));
  console.log('by tool:    ', JSON.stringify(byTool));

  console.log('\nsample findings (first 8):');
  for (const f of findings.slice(0, 8)) {
    console.log(`  [${f.tool}/${f.severity}] ${String(f.title || f.message).slice(0, 110)}`);
    console.log(`     file=${f.file}:${f.line}  rule=${f.ruleId}  category=${f.category}  effort=${f.effort}`);
  }

  // Ground truth check: nodejs-goof pins known-vulnerable dependency versions.
  const KNOWN_VULNERABLE_PACKAGES = ['lodash', 'adm-zip', 'ejs', 'marked', 'mongoose', 'dustjs-linkedin'];
  const text = JSON.stringify(findings).toLowerCase();
  console.log('\n=== ground-truth check (packages this repo pins at vulnerable versions) ===');
  for (const pkg of KNOWN_VULNERABLE_PACKAGES) {
    console.log(`  ${pkg}: ${text.includes(pkg) ? 'DETECTED' : 'not detected'}`);
  }
})().catch((e) => {
  console.error('scan failed:', e);
  process.exit(1);
});
