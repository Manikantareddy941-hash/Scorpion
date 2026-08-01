import { databases, DB_ID, Query, ID } from '../lib/appwrite';
import { fetchAllDocuments } from '../lib/paginate';
import { ProposalDraft } from '../autotune/proposalEngine';

const COLLECTION = 'autotune_proposals';

/**
 * `applied` rather than `approved`: approval and application are one atomic
 * step. A proposal that was approved but not applied would be a control change
 * everyone believes happened, which is worse than one that plainly failed.
 */
export type ProposalStatus = 'open' | 'applied' | 'rejected' | 'stale' | 'expired';

export interface Proposal {
  $id: string;
  user_id: string;
  status: ProposalStatus;
  target_kind: string;
  target_id: string;
  field: string;
  current_value: string;
  proposed_value: string;
  rationale: string;
  metric_key: string;
  metric_value: number;
  metric_threshold: number;
  evidence_query: string;
  created_at: string;
  expires_at: string;
  decided_by?: string;
  decided_at?: string;
  decision_note?: string;
  metric_at_decision?: number;
}

/** A proposal nobody acted on closes itself: an old queue is an unread queue. */
export const PROPOSAL_TTL_DAYS = 14;

export const autotuneProposalRepository = {
  /**
   * Proposals for one user, newest first.
   *
   * Reads to completion — this is the queue an operator works from, and a
   * silently capped page hides proposals they believe they have triaged.
   */
  async listForUser(userId: string, status?: ProposalStatus): Promise<Proposal[]> {
    const queries = [Query.equal('user_id', userId)];
    if (status) queries.push(Query.equal('status', status));
    const page = await fetchAllDocuments(COLLECTION, queries);
    if (page.truncated) throw new Error(`proposal list truncated at ${page.items.length}/${page.total}`);
    return (page.items as unknown as Proposal[])
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  },

  /**
   * Fetches a proposal only if it belongs to `userId`.
   *
   * Tenancy is enforced here rather than by the caller checking afterwards: a
   * proposal names a security control and the evidence behind it, so reading
   * someone else's is disclosure even without acting on it.
   */
  async getOwned(proposalId: string, userId: string): Promise<Proposal | null> {
    try {
      const doc = await databases.getDocument(DB_ID, COLLECTION, proposalId);
      const proposal = doc as unknown as Proposal;
      return proposal.user_id === userId ? proposal : null;
    } catch {
      return null;
    }
  },

  async create(userId: string, draft: ProposalDraft, now: number = Date.now()): Promise<Proposal> {
    const doc = await databases.createDocument(DB_ID, COLLECTION, ID.unique(), {
      user_id: userId,
      status: 'open' satisfies ProposalStatus,
      target_kind: draft.targetKind,
      target_id: draft.targetId,
      field: draft.field,
      // Values are number | 'warn' | 'block' | boolean; stored as text and
      // parsed back against `field`.
      current_value: String(draft.currentValue),
      proposed_value: String(draft.proposedValue),
      rationale: draft.rationale,
      metric_key: draft.metricKey,
      metric_value: draft.metricValue,
      metric_threshold: draft.metricThreshold,
      evidence_query: draft.evidenceQuery,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + PROPOSAL_TTL_DAYS * 86_400_000).toISOString(),
    });
    return doc as unknown as Proposal;
  },

  /**
   * Records a terminal decision. Always writes the metric recomputed at
   * decision time, so the audit record shows what the approver actually saw
   * rather than what the proposer once saw.
   */
  async close(
    proposalId: string,
    status: Exclude<ProposalStatus, 'open'>,
    decidedBy: string,
    note: string,
    metricAtDecision?: number,
  ): Promise<Proposal> {
    const doc = await databases.updateDocument(DB_ID, COLLECTION, proposalId, {
      status,
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
      decision_note: note,
      ...(metricAtDecision === undefined ? {} : { metric_at_decision: metricAtDecision }),
    });
    return doc as unknown as Proposal;
  },
};
