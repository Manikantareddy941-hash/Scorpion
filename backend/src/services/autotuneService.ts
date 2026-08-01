import { COLLECTIONS, Query } from '../lib/appwrite';
import { fetchAllDocuments } from '../lib/paginate';
import { FindingRecord, escapeByPhase, toFindingRecord } from '../monitor/feedbackMetrics';
import { MIN_SAMPLE, proposeFromEscapes } from '../autotune/proposalEngine';
import { TunableField, TunableValue, canApply } from '../autotune/tighten';
import { gateRulesRepository } from '../repositories/gateRulesRepository';
import { Proposal, autotuneProposalRepository } from '../repositories/autotuneProposalRepository';
import { logger } from './logger';

/**
 * Wiring for the auto-tune loop: gather evidence, propose, and — only on an
 * explicit human decision — apply.
 *
 * Nothing here runs on a timer yet. The scan is triggered, so the first
 * production run is something an operator watches rather than something that
 * surprises them.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Findings for one user's repositories, read to completion.
 *
 * Exhaustive on purpose: every number downstream is a SHARE, and a truncated
 * read changes the denominator. A capped read would not fail — it would quietly
 * produce a different percentage and propose against it.
 */
async function loadFindings(userId: string): Promise<FindingRecord[]> {
  const repos = await fetchAllDocuments(COLLECTIONS.REPOSITORIES, [Query.equal('user_id', userId)]);
  if (repos.truncated) throw new Error(`repository read truncated at ${repos.items.length}/${repos.total}`);
  const repoIds = repos.items.map((r) => r.$id);
  if (repoIds.length === 0) return [];

  const findings = await fetchAllDocuments(COLLECTIONS.FINDINGS, [Query.equal('repo_id', repoIds)]);
  if (findings.truncated) throw new Error(`findings read truncated at ${findings.items.length}/${findings.total}`);

  return findings.items.map((d) => toFindingRecord(d as unknown as Record<string, unknown>));
}

/** Parses a value back to its real type using the field it belongs to. */
function parseValue(field: TunableField, raw: string): TunableValue {
  if (field === 'threshold') return Number(raw);
  if (field === 'enabled') return raw === 'true';
  return raw as TunableValue;
}

export interface EvidenceCheck {
  /** The metric as it stands now. */
  value: number;
  /** Whether it still crosses the threshold that justified the proposal. */
  stillJustified: boolean;
  detail: string;
}

/**
 * Re-runs a proposal's evidence query against live data.
 *
 * This is the whole point of storing a query rather than a hash: a hash over
 * the finding set changes whenever any unrelated finding arrives, so every open
 * proposal would invalidate within minutes. Re-running recomputes the one
 * number the decision rested on, which is what lets a resolved spike show up as
 * a visible delta instead of being rubber-stamped a week later.
 */
export async function recheckEvidence(proposal: Proposal, findings: FindingRecord[], now: number): Promise<EvidenceCheck> {
  const query = JSON.parse(proposal.evidence_query) as { kind: string; phase: string; windowDays: number };
  if (query.kind !== 'escape_share') {
    return { value: 0, stillJustified: false, detail: `unknown evidence kind "${query.kind}"` };
  }

  const since = now - query.windowDays * MS_PER_DAY;
  const inWindow = findings.filter((f) => f.createdAt >= since && f.createdAt <= now);
  if (inWindow.length < MIN_SAMPLE) {
    return {
      value: 0,
      stillJustified: false,
      detail: `only ${inWindow.length} findings in the last ${query.windowDays} days, need ${MIN_SAMPLE}`,
    };
  }

  const byPhase = escapeByPhase(inWindow);
  const total = byPhase.filter((p) => p.phase !== 'unknown').reduce((sum, p) => sum + p.count, 0);
  const phase = byPhase.find((p) => p.phase === query.phase);
  const share = total > 0 && phase ? phase.count / total : 0;

  return {
    value: share,
    stillJustified: share >= proposal.metric_threshold,
    detail: `${query.phase} was ${(proposal.metric_value * 100).toFixed(0)}% of escapes when proposed, now ${(share * 100).toFixed(0)}%`,
  };
}

export type DecisionResult =
  | { outcome: 'applied'; proposal: Proposal }
  | { outcome: 'rejected'; proposal: Proposal }
  | { outcome: 'stale'; proposal: Proposal; detail: string }
  | { outcome: 'expired'; proposal: Proposal }
  | { outcome: 'not_found' }
  | { outcome: 'not_open'; status: string }
  | { outcome: 'unavailable'; detail: string };

export const autotuneService = {
  /**
   * Computes proposals and persists the new ones.
   *
   * Skips are logged rather than returned silently: a run that proposes nothing
   * is the expected outcome on a healthy pipeline, and an operator has to be
   * able to tell that apart from an engine that is broken.
   */
  async scan(userId: string, now: number = Date.now()): Promise<{ created: Proposal[]; skipped: number }> {
    const findings = await loadFindings(userId);
    const config = await gateRulesRepository.get(userId);
    const open = await autotuneProposalRepository.listForUser(userId, 'open');

    const run = proposeFromEscapes(findings, config, {
      now,
      existingOpen: open.map((p) => ({ targetId: p.target_id, field: p.field })),
    });

    for (const skip of run.skipped) {
      logger.info('[autotune] no proposal', { event: 'autotune_skipped', userId, reason: skip.reason, detail: skip.detail });
    }

    const created: Proposal[] = [];
    for (const draft of run.proposals) {
      created.push(await autotuneProposalRepository.create(userId, draft, now));
      logger.info('[autotune] proposal created', {
        event: 'autotune_proposed', userId, targetId: draft.targetId,
        field: draft.field, from: String(draft.currentValue), to: String(draft.proposedValue),
      });
    }
    return { created, skipped: run.skipped.length };
  },

  /**
   * Applies or rejects a proposal.
   *
   * The apply path is deliberately suspicious of its own proposal. In order:
   * ownership, still open, not expired, evidence still justifies it, and the
   * diff is still a tightening one against the rule AS IT STANDS NOW. Any of
   * those failing closes the proposal with the reason rather than applying it.
   */
  async decide(
    proposalId: string, userId: string, action: 'approve' | 'reject', note = '', now: number = Date.now(),
  ): Promise<DecisionResult> {
    const proposal = await autotuneProposalRepository.getOwned(proposalId, userId);
    if (!proposal) return { outcome: 'not_found' };
    if (proposal.status !== 'open') return { outcome: 'not_open', status: proposal.status };

    if (action === 'reject') {
      return { outcome: 'rejected', proposal: await autotuneProposalRepository.close(proposalId, 'rejected', userId, note) };
    }

    if (Date.parse(proposal.expires_at) <= now) {
      return {
        outcome: 'expired',
        proposal: await autotuneProposalRepository.close(proposalId, 'expired', userId, 'expired before a decision was made'),
      };
    }

    let findings: FindingRecord[];
    let config;
    try {
      findings = await loadFindings(userId);
      config = await gateRulesRepository.get(userId);
    } catch (err) {
      // Cannot verify the evidence, so cannot apply. The proposal stays open —
      // an unreadable database is not a reason to discard a valid proposal.
      const detail = err instanceof Error ? err.message : String(err);
      logger.error('[autotune] evidence could not be re-read; apply refused', {
        event: 'autotune_unavailable', proposalId, userId, error: detail,
      });
      return { outcome: 'unavailable', detail };
    }

    const check = await recheckEvidence(proposal, findings, now);
    if (!check.stillJustified) {
      logger.warn('[autotune] proposal no longer justified', {
        event: 'autotune_stale', proposalId, userId, detail: check.detail,
      });
      return {
        outcome: 'stale',
        detail: check.detail,
        proposal: await autotuneProposalRepository.close(proposalId, 'stale', userId, check.detail, check.value),
      };
    }

    const field = proposal.field as TunableField;
    const proposedValue = parseValue(field, proposal.proposed_value);
    const rule = config.rules.find((r) => r.id === proposal.target_id);
    if (!rule) {
      const detail = `rule "${proposal.target_id}" no longer exists`;
      return { outcome: 'stale', detail, proposal: await autotuneProposalRepository.close(proposalId, 'stale', userId, detail, check.value) };
    }

    // Re-derived from the live rule, never from what the proposal recorded: if
    // someone hand-tightened it in the meantime, applying the stale diff would
    // move the control backwards.
    const verdict = canApply(rule, field, proposedValue);
    if (!verdict.tightening) {
      const detail = `no longer a tightening change: ${verdict.reason}`;
      return { outcome: 'stale', detail, proposal: await autotuneProposalRepository.close(proposalId, 'stale', userId, detail, check.value) };
    }

    await gateRulesRepository.save(userId, {
      ...config,
      rules: config.rules.map((r) => (r.id === rule.id ? { ...r, [field]: proposedValue } : r)),
    });
    logger.info('[autotune] proposal applied', {
      event: 'autotune_applied', proposalId, userId, targetId: rule.id,
      field, to: String(proposedValue), metricAtDecision: check.value,
    });

    return {
      outcome: 'applied',
      proposal: await autotuneProposalRepository.close(proposalId, 'applied', userId, note || check.detail, check.value),
    };
  },
};
