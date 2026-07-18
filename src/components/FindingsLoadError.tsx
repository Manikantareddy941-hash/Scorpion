import { AlertTriangle } from 'lucide-react';

/**
 * Shown when a findings fetch fails, in place of the "No Findings Detected"
 * empty state.
 *
 * These are not interchangeable. On a security page an empty list reads as
 * "you are clean" — several of these pages say so outright ("your security
 * posture is within optimal parameters"). Rendering that after a failed read
 * tells the operator the opposite of the truth.
 */
export function FindingsLoadError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="bg-[var(--bg-card)] rounded-3xl p-20 text-center border border-[#ff8a00]/40 flex flex-col items-center">
      <div className="w-20 h-20 bg-[#ff8a00]/10 rounded-full flex items-center justify-center mb-6">
        <AlertTriangle size={40} className="text-[#ff8a00]" />
      </div>
      <h3 className="text-xl font-black text-[var(--text-primary)] uppercase italic">Findings Unavailable</h3>
      <p className="text-xs text-[var(--text-secondary)] mt-2 font-bold uppercase tracking-widest max-w-md">
        This is not a clean result — the findings for this scan could not be loaded
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-8 px-6 py-2.5 bg-[var(--accent-primary)] text-black rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-[var(--accent-primary)]/20 hover:scale-105 transition-all"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export default FindingsLoadError;
