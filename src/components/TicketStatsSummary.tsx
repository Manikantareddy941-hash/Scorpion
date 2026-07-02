import { RefreshCw } from 'lucide-react';

interface TicketStatsSummaryProps {
  stats: any;
  statsLoading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}

export default function TicketStatsSummary({ stats, statsLoading, refreshing, onRefresh }: TicketStatsSummaryProps) {
  return (
    <div className="premium-card p-6 mb-8 flex flex-wrap items-center justify-between gap-6 bg-[var(--bg-card)]">
      <div className="flex items-center gap-4 flex-1 justify-around">
        <div className="text-center">
          <p className="text-[8px] font-black text-[var(--text-secondary)] uppercase italic">Total Tickets</p>
          <p className="text-2xl font-black text-[var(--text-primary)] italic">
            {statsLoading ? '...' : stats?.total ?? 0}
          </p>
        </div>
        <div className="w-px h-8 bg-[var(--border-subtle)]" />
        <div className="text-center">
          <p className="text-[8px] font-black text-cyan-400 uppercase italic">In Flight</p>
          <p className="text-2xl font-black text-cyan-400 italic">
            {statsLoading ? '...' : stats?.open ?? 0}
          </p>
        </div>
        <div className="w-px h-8 bg-[var(--border-subtle)]" />
        <div className="text-center">
          <p className="text-[8px] font-black text-red-500 uppercase italic">Critical</p>
          <p className="text-2xl font-black text-red-500 italic">
            {statsLoading ? '...' : stats?.critical ?? 0}
          </p>
        </div>
        <div className="w-px h-8 bg-[var(--border-subtle)]" />
        <div className="text-center">
          <p className="text-[8px] font-black text-green-500 uppercase italic">Resolved</p>
          <p className="text-2xl font-black text-green-500 italic">
            {statsLoading ? '...' : stats?.resolved ?? 0}
          </p>
        </div>
        {stats?.overdue > 0 && (
          <>
            <div className="w-px h-8 bg-[var(--border-subtle)]" />
            <div className="text-center">
              <p className="text-[8px] font-black text-red-500 uppercase italic animate-pulse">Overdue</p>
              <p className="text-2xl font-black text-red-500 italic animate-pulse">
                {stats.overdue}
              </p>
            </div>
          </>
        )}
      </div>
      <button
        onClick={onRefresh}
        className="p-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-[var(--text-secondary)] hover:text-white transition-colors"
      >
        <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
      </button>
    </div>
  );
}
