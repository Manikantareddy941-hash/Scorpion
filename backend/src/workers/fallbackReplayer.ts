import { driftRepository } from '../repositories/driftRepository';
import { gateRulesRepository } from '../repositories/gateRulesRepository';
import { logger } from '../services/logger';

/**
 * Background reconciler for the repositories' local JSON fallback buffers.
 *
 * When Appwrite is unreachable, driftRepository and gateRulesRepository degrade
 * to a per-process JSON file. Those writes never make it back to Appwrite on
 * their own — this replayer closes that gap by periodically asking each repo to
 * flush its buffer. Each flush is idempotent at the repo level (records that
 * land are dropped from the buffer; the rest stay for the next tick), so a tick
 * that runs while Appwrite is still down simply flushes nothing.
 *
 * No distributed lock: each replica owns its own local buffer file, so there is
 * nothing shared to race on across replicas. The only real race — an in-process
 * flush interleaving with a save() on the same file — is serialized inside each
 * repository via its file mutex. This module only adds a re-entrancy guard so a
 * slow tick can't overlap the next interval.
 */

const REPLAY_INTERVAL_MS = Number(process.env.FALLBACK_REPLAY_INTERVAL_MS) || 60_000;

let timer: NodeJS.Timeout | null = null;
let ticking = false;

async function tick(): Promise<void> {
  if (ticking) return; // previous tick still draining a large/slow buffer
  ticking = true;
  try {
    const drift = await driftRepository.flushFallback();
    const gate = await gateRulesRepository.flushFallback();
    if (drift + gate > 0) {
      logger.info(`[FallbackReplayer] Flushed ${drift} drift + ${gate} gate record(s) to Appwrite`);
    }
  } catch (err) {
    logger.warn(
      '[FallbackReplayer] Replay tick failed:',
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    ticking = false;
  }
}

/** Start the non-blocking replay loop. Idempotent. The timer is unref'd so it
 *  never holds the process open during shutdown. */
export function startFallbackReplayer(intervalMs: number = REPLAY_INTERVAL_MS): void {
  if (timer) return;
  timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  logger.info(`[FallbackReplayer] Started (every ${intervalMs}ms)`);
}

export function stopFallbackReplayer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
