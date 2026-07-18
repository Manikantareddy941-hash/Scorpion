const API_BASE_URL = '';

export const verifyService = {
  async triggerReScan(repoId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/api/repos/${repoId}/scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ visibility: 'public' })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to trigger scan');
    }

    return await response.json();
  },

  async pollScanStatus(scanId: string, token: string) {
    const response = await fetch(`${API_BASE_URL}/api/repos/scans/${scanId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch scan status');
    }

    return await response.json();
  },

  /**
   * Whether the rescan cleared this specific finding.
   *
   * The scan pipeline already decides this: delta ingestion marks a finding
   * 'resolved' when a later scan of the same repository no longer reports it.
   * So verification is a read of one finding, not a write.
   *
   * This replaces a browser-side sweep that listed every vulnerability in the
   * repository and set `verified: true` on any already-resolved one. That was
   * wrong twice over. It reported success whenever *any* finding in the repo
   * had ever been resolved — including one closed months earlier by an
   * unrelated fix — so the button showed "Fix verified" while the fix under
   * test was still broken. And `verified` was written by that sweep and read
   * by nothing, so its only observable effect was the false success.
   */
  async isFindingResolved(findingId: string, token: string): Promise<boolean> {
    const response = await fetch(`${API_BASE_URL}/api/findings/${findingId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error('Failed to check finding status');
    }

    const { finding } = await response.json();
    return finding?.status === 'resolved' || finding?.status === 'remediated';
  }
};
