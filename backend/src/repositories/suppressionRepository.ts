import type { SuppressionRule } from '../monitor/suppressionMatcher';

// ponytail: minimal stub so correlationQueueWorker compiles against the real import path;
// Task 12 replaces this with the real Appwrite-backed implementation.
export const suppressionRepository = {
  async listForOwner(_ownerUserId: string): Promise<SuppressionRule[]> {
    return [];
  },
};
