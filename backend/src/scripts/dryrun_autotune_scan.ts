// backend/src/scripts/dryrun_autotune_scan.ts
//
// READ-ONLY. Runs the auto-tune decision logic against live data and prints
// what it would propose — without writing a single proposal row.
//
// Calls proposeFromEscapes directly rather than autotuneService.scan, so the
// persistence path is untouched. The point is to see the noise floor before
// committing to the 40% / N=10 parameters, not to fill a queue.
//
// Also prints the raw escape distribution per user, because the interesting
// question is not only "what did it propose" but "how close was it, and why".
//
// Run (from backend/):
//   npm run build && node dist/backend/src/scripts/dryrun_autotune_scan.js
import * as dotenv from 'dotenv';
import path from 'path';

// Must load before ../lib/appwrite, which reads process.env at import time.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { COLLECTIONS, Query } from '../lib/appwrite';
import { fetchAllDocuments } from '../lib/paginate';
import { FindingRecord, escapeByPhase, toFindingRecord } from '../monitor/feedbackMetrics';
import { MIN_PHASE_SHARE, MIN_SAMPLE, WINDOW_DAYS, proposeFromEscapes } from '../autotune/proposalEngine';
import { gateRulesRepository } from '../repositories/gateRulesRepository';

const REQUIRED = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'APPWRITE_API_KEY', 'APPWRITE_DATABASE_ID'];
const missingEnv = REQUIRED.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`[FATAL] missing env var(s): ${missingEnv.join(', ')} — run this from backend/`);
  process.exit(1);
}

const MS_PER_DAY = 86_400_000;
const now = Date.now();

async function main(): Promise<void> {
  console.log(`Auto-tune dry run — window ${WINDOW_DAYS}d, min sample ${MIN_SAMPLE}, min share ${MIN_PHASE_SHARE * 100}%`);
  console.log('READ-ONLY: no proposals are written.\n');

  const repos = await fetchAllDocuments(COLLECTIONS.REPOSITORIES);
  if (repos.truncated) { console.error('[FATAL] repository read truncated'); process.exit(1); }

  const byUser = new Map<string, string[]>();
  for (const r of repos.items) {
    const userId = String((r as unknown as { user_id?: string }).user_id ?? '');
    if (!userId) continue;
    byUser.set(userId, [...(byUser.get(userId) ?? []), r.$id]);
  }
  console.log(`${repos.items.length} repositories across ${byUser.size} owner(s)\n`);

  if (byUser.size === 0) {
    console.log('No owned repositories, so there is nothing for the engine to read.');
    return;
  }

  for (const [userId, repoIds] of byUser) {
    console.log(`--- user ${userId} (${repoIds.length} repo${repoIds.length === 1 ? '' : 's'}) ---`);

    const findingsPage = await fetchAllDocuments(COLLECTIONS.FINDINGS, [Query.equal('repo_id', repoIds)]);
    if (findingsPage.truncated) {
      console.log(`  findings read TRUNCATED at ${findingsPage.items.length}/${findingsPage.total} — engine would refuse\n`);
      continue;
    }

    const findings: FindingRecord[] = findingsPage.items.map((x) => toFindingRecord(x as unknown as Record<string, unknown>));

    const inWindow = findings.filter((f) => f.createdAt >= now - WINDOW_DAYS * MS_PER_DAY);
    console.log(`  findings: ${findings.length} total, ${inWindow.length} in the last ${WINDOW_DAYS} days`);

    const dist = escapeByPhase(inWindow).sort((a, b) => b.count - a.count);
    const actionable = dist.filter((p) => p.phase !== 'unknown').reduce((s, p) => s + p.count, 0);
    if (dist.length > 0) {
      console.log(`  escape distribution (${actionable} actionable):`);
      for (const p of dist) {
        const share = actionable > 0 && p.phase !== 'unknown' ? `${((p.count / actionable) * 100).toFixed(0)}%` : '—';
        console.log(`    ${p.phase.padEnd(8)} ${String(p.count).padStart(4)}  ${share}`);
      }
    }

    const config = await gateRulesRepository.get(userId);
    console.log(`  gate rules: ${config.rules.map((r) => `${r.severity}@${r.threshold}${r.enabled ? '' : ' (off)'}`).join(', ') || 'none'}`);

    const run = proposeFromEscapes(findings, config, { now });
    console.log(`  => ${run.proposals.length} proposal(s), ${run.skipped.length} skip(s)`);
    for (const p of run.proposals) {
      console.log(`     PROPOSE ${p.targetId}.${p.field}: ${String(p.currentValue)} -> ${String(p.proposedValue)}`);
      console.log(`       ${p.rationale}`);
    }
    for (const s of run.skipped) console.log(`     skip [${s.reason}] ${s.detail}`);
    console.log('');
  }

  console.log('Dry run complete. Nothing was written.');
}

main().catch((e) => { console.error('[FATAL]', e); process.exit(1); });
