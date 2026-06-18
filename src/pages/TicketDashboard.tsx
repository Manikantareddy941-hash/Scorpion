import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTickets, useStats, updateTicket, bulkSyncToJira } from '../hooks/useTickets';
import { Ticket, TicketFilters } from '../../shared/types';
import TicketForm from '../components/TicketForm';
import IssueDetailModal from '../components/IssueDetailModal';
import SeverityBadge from '../components/SeverityBadge';
import { SkeletonTableRows, SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import {
  LayoutGrid, List, Search, Filter, Plus, Bug, ShieldAlert,
  Clock, Sparkles, AlertOctagon, Link2, ExternalLink,
  ChevronRight, RefreshCw, User, Settings, AlertTriangle, CheckCircle2
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function TicketDashboard() {
  const navigate = useNavigate();
  const { getJWT } = useAuth();
  
  const [viewMode, setViewMode] = useState<'board' | 'list'>('board');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  // Filter state
  const [filters, setFilters] = useState<TicketFilters>({
    status: '',
    priority: '',
    type: '',
    assignee: '',
    search: '',
    page: 1,
    limit: 100,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    overdue: false
  });

  const { tickets: fetchedTickets, loading, error, refetch } = useTickets(filters);
  const [tickets, setTickets] = useState<Ticket[]>([]);

  useEffect(() => {
    setTickets(fetchedTickets);
  }, [fetchedTickets]);

  const { stats, loading: statsLoading, refetch: refetchStats } = useStats();

  const [syncingAll, setSyncingAll] = useState(false);
  
  const [draggedTicketId, setDraggedTicketId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<Ticket['status'] | null>(null);

  const handleDragStart = (e: React.DragEvent, ticketId: string) => {
    e.dataTransfer.setData('text/plain', ticketId);
    setDraggedTicketId(ticketId);
  };

  const handleDragEnd = () => {
    setDraggedTicketId(null);
    setDragOverColumn(null);
  };

  const handleDragOver = (e: React.DragEvent, status: Ticket['status']) => {
    e.preventDefault();
    setDragOverColumn(status);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = async (e: React.DragEvent, newStatus: Ticket['status']) => {
    e.preventDefault();
    setDragOverColumn(null);
    const ticketId = e.dataTransfer.getData('text/plain') || draggedTicketId;
    if (!ticketId) return;

    const targetTicket = tickets.find(t => t.id === ticketId);
    if (!targetTicket || targetTicket.status === newStatus) return;

    const oldStatus = targetTicket.status;

    // Optimistic Update
    setTickets(prevTickets =>
      prevTickets.map(t => (t.id === ticketId ? { ...t, status: newStatus } : t))
    );

    try {
      await updateTicket(getJWT, ticketId, { status: newStatus });
      toast.success(`Ticket status updated to ${newStatus.replace('_', ' ')}`);
      refetch();
      refetchStats();
    } catch (err: any) {
      // Revert on failure
      setTickets(prevTickets =>
        prevTickets.map(t => (t.id === ticketId ? { ...t, status: oldStatus } : t))
      );
      toast.error(err.message || 'Failed to update ticket status');
    }
  };

  const handleBulkSync = async () => {
    setSyncingAll(true);
    const toastId = toast.loading('Initiating bulk sync to Jira...');
    try {
      const result = await bulkSyncToJira(getJWT);
      toast.success(`Synced ${result.synced}/${result.total} (${result.failed} failed)`, { id: toastId });
      refetch();
      refetchStats();
    } catch (err: any) {
      toast.error(err.message || 'Bulk sync failed', { id: toastId });
    } finally {
      setSyncingAll(false);
    }
  };

  const handleFilterChange = (key: keyof TicketFilters, value: any) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
      page: 1 // Reset to first page
    }));
  };

  const handleQuickStatusChange = async (e: React.MouseEvent, id: string, newStatus: Ticket['status']) => {
    e.stopPropagation(); // Stop navigation click
    try {
      await updateTicket(getJWT, id, { status: newStatus });
      toast.success(`Ticket status updated to ${newStatus.replace('_', ' ')}`);
      refetch();
      refetchStats();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update status');
    }
  };

  const TypeIcon = ({ type }: { type: Ticket['type'] }) => {
    switch (type) {
      case 'bug': return <Bug size={14} className="text-rose-500" />;
      case 'vulnerability': return <ShieldAlert size={14} className="text-orange-500" />;
      case 'task': return <Clock size={14} className="text-cyan-500" />;
      case 'feature': return <Sparkles size={14} className="text-yellow-500" />;
      default: return <Clock size={14} />;
    }
  };

  const PriorityBadge = ({ priority }: { priority: Ticket['priority'] }) => (
    <SeverityBadge severity={priority} />
  );

  // Columns for board view
  const COLUMNS: { id: Ticket['status']; label: string; bg: string }[] = [
    { id: 'todo', label: 'To Do', bg: 'border-t-slate-500' },
    { id: 'in_progress', label: 'In Progress', bg: 'border-t-cyan-500' },
    { id: 'in_review', label: 'In Review', bg: 'border-t-yellow-500' },
    { id: 'done', label: 'Done', bg: 'border-t-green-500' }
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
          <div>
            <h1 className="text-3xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter">
              Ticket Operations
            </h1>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-1 font-mono">
              Jira-integrated task dispatcher & remediation control
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/jira-settings')}
              className="p-3 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl text-[var(--text-secondary)] hover:text-white transition-all flex items-center gap-2 text-xs font-black uppercase italic"
            >
              <Settings size={16} />
              Jira Integration
            </button>
            <button
              onClick={handleBulkSync}
              disabled={syncingAll}
              className="px-4 py-3 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-xs font-black uppercase italic rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-cyan-500/5 disabled:opacity-50"
            >
              <RefreshCw size={16} className={syncingAll ? 'animate-spin' : ''} />
              Sync All to Jira
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-5 py-3 bg-[var(--accent-primary)] hover:bg-opacity-95 text-black text-xs font-black uppercase italic tracking-widest rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-[var(--accent-primary)]/15"
            >
              <Plus size={16} strokeWidth={3} />
              New Ticket
            </button>
          </div>
        </div>

        {/* Stats Summary Bar */}
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
            onClick={() => {
              refetch();
              refetchStats();
            }}
            className="p-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-[var(--text-secondary)] hover:text-white transition-colors"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Filters and View Toggles */}
        <div className="premium-card p-4 mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap flex-1">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
              <input
                type="text"
                placeholder="Search ticket title, descriptions, or JIRA keys..."
                value={filters.search}
                onChange={e => handleFilterChange('search', e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all placeholder:text-[var(--text-secondary)]/50 font-medium"
              />
            </div>

            {/* Dropdown Filters */}
            <div className="flex items-center gap-2">
              <select
                value={filters.type}
                onChange={e => handleFilterChange('type', e.target.value)}
                className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[10px] font-black italic uppercase text-[var(--text-primary)] outline-none cursor-pointer hover:border-[var(--accent-primary)]/40 transition-colors"
              >
                <option value="">All Types</option>
                <option value="vulnerability">Vulnerabilities</option>
                <option value="bug">Bugs</option>
                <option value="task">Tasks</option>
                <option value="feature">Features</option>
              </select>

              <select
                value={filters.priority}
                onChange={e => handleFilterChange('priority', e.target.value)}
                className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[10px] font-black italic uppercase text-[var(--text-primary)] outline-none cursor-pointer hover:border-[var(--accent-primary)]/40 transition-colors"
              >
                <option value="">All Priorities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>

              <button
                onClick={() => handleFilterChange('overdue', !filters.overdue)}
                className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase italic transition-all border ${
                  filters.overdue 
                    ? 'bg-red-500 text-white border-red-500' 
                    : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-red-500/40 hover:text-red-400'
                }`}
              >
                Overdue Only
              </button>
            </div>
          </div>

          {/* View Mode Switcher */}
          <div className="flex bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl p-1 shrink-0">
            <button
              onClick={() => setViewMode('board')}
              className="p-1.5 rounded-lg transition-all text-[var(--text-secondary)] hover:text-white"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className="p-1.5 rounded-lg transition-all text-[var(--text-secondary)] hover:text-white"
            >
              <List size={16} />
            </button>
          </div>
        </div>

        {/* Dashboard Content */}
        {error ? (
          <div className="premium-card p-16 text-center border-red-500/20 max-w-xl mx-auto my-12 bg-[var(--bg-card)]">
            <AlertOctagon className="w-16 h-16 text-red-500 mx-auto mb-6 animate-pulse" />
            <h3 className="text-xl font-black text-red-500 uppercase italic">Error Loading Tickets</h3>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase mt-2">{error}</p>
            <button
              onClick={() => refetch()}
              className="mt-6 px-6 py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all"
            >
              Retry Connection
            </button>
          </div>
        ) : loading && viewMode === 'list' ? (
          <div className="premium-card overflow-hidden bg-neutral-900">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-neutral-900 border-b border-neutral-800">
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">ID</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Title</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Type</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Priority</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60">
                <SkeletonTableRows rows={6} cols={5} />
              </tbody>
            </table>
          </div>
        ) : loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} className="h-[420px]" />)}
          </div>
        ) : tickets.length === 0 ? (
          <EmptyState icon={CheckCircle2} message="No tickets found — your security perimeter is fully synchronized" />
        ) : viewMode === 'board' ? (
          /* Kanban Board View */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-start">
            {COLUMNS.map(col => {
              const colTickets = tickets.filter(t => t.status === col.id);
              return (
                <div 
                  key={col.id} 
                  className={`flex flex-col min-h-[500px] rounded-xl p-2 transition-all duration-200 ${dragOverColumn === col.id ? 'bg-[var(--bg-secondary)]/30 border-2 border-dashed border-[var(--accent-primary)]/40' : 'border-2 border-transparent'}`}
                  onDragOver={(e) => handleDragOver(e, col.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, col.id)}
                >
                  {/* Column Header */}
                  <div className={`flex items-center justify-between pb-3 mb-4 border-b border-[var(--border-subtle)] border-t-4 ${col.bg} pt-2`}>
                    <span className="text-[10px] font-black uppercase italic tracking-wider text-[var(--text-primary)]">
                      {col.label}
                    </span>
                    <span className="px-2 py-0.5 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded text-[9px] font-bold font-mono">
                      {colTickets.length}
                    </span>
                  </div>

                  {/* Column Body / Cards */}
                  <div className="space-y-4">
                    {colTickets.map(ticket => (
                      <div
                        key={ticket.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, ticket.id)}
                        onDragEnd={handleDragEnd}
                        onClick={() => setSelectedTicketId(ticket.id)}
                        className="premium-card bg-[var(--bg-card)] hover:border-[var(--accent-primary)]/45 transition-all p-4 flex flex-col gap-3 cursor-pointer group hover:shadow-lg relative overflow-hidden"
                        style={{ opacity: draggedTicketId === ticket.id ? 0.4 : 1 }}
                      >
                        {/* Header Row */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <TypeIcon type={ticket.type} />
                            <span className="text-[8px] font-black uppercase italic tracking-wider text-[var(--text-secondary)] font-mono">
                              {ticket.type}
                            </span>
                            {ticket.jiraKey && ticket.jiraSyncStatus !== 'error' ? (
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" title="Synced to Jira" />
                            ) : ticket.jiraSyncStatus === 'error' ? (
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" title="Sync Error" />
                            ) : (
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title="Unsynced" />
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <PriorityBadge priority={ticket.priority} />
                            {ticket.isOverdue && (
                              <span className="px-1.5 py-0.5 bg-red-500 text-white rounded text-[7px] font-black uppercase tracking-wider animate-pulse shadow-sm shadow-red-500/20">
                                Overdue
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Title */}
                        <h4 className="text-[11px] font-black uppercase italic leading-tight text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] transition-colors">
                          {ticket.title}
                        </h4>

                        {/* Middle metadata: tags & JIRA key */}
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          {ticket.jiraKey ? (
                            <span className="inline-flex items-center gap-1 text-[8px] font-mono font-bold text-cyan-400 border border-cyan-500/20 bg-cyan-500/5 px-2 py-0.5 rounded">
                              <ExternalLink size={8} />
                              {ticket.jiraKey}
                            </span>
                          ) : (
                            <span className="text-[7px] text-[var(--text-secondary)] font-bold uppercase italic opacity-40">
                              Local Only
                            </span>
                          )}

                          {ticket.linkedFindings.length > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-[8px] font-bold text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded border border-orange-500/20">
                              <Link2 size={9} />
                              {ticket.linkedFindings.length} findings
                            </span>
                          )}
                        </div>

                        {/* Divider */}
                        <div className="h-px bg-[var(--border-subtle)] opacity-50 my-1" />

                        {/* Bottom Row */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <div className="w-5 h-5 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] flex items-center justify-center">
                              <User size={10} className="text-[var(--text-secondary)]" />
                            </div>
                            <span className="text-[8px] font-bold text-[var(--text-secondary)] truncate max-w-[80px]">
                              {ticket.assignee || 'Unassigned'}
                            </span>
                          </div>

                          {/* Quick Transitions */}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {col.id !== 'todo' && (
                              <button
                                onClick={(e) => handleQuickStatusChange(e, ticket.id, col.id === 'in_progress' ? 'todo' : col.id === 'in_review' ? 'in_progress' : 'in_review')}
                                className="p-1 hover:bg-[var(--bg-secondary)] rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white transition-all text-[8px]"
                                title="Move Left"
                              >
                                &larr;
                              </button>
                            )}
                            {col.id !== 'done' && (
                              <button
                                onClick={(e) => handleQuickStatusChange(e, ticket.id, col.id === 'todo' ? 'in_progress' : col.id === 'in_progress' ? 'in_review' : 'done')}
                                className="p-1 hover:bg-[var(--bg-secondary)] rounded border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white transition-all text-[8px]"
                                title="Move Right"
                              >
                                &rarr;
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* List Table View */
          <div className="premium-card overflow-hidden bg-neutral-900">
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="sticky top-0 z-10 bg-neutral-900 border-b border-neutral-800">
                    <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">ID</th>
                    <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Title</th>
                    <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Type</th>
                    <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Priority</th>
                    <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Assignee</th>
                    <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide">Jira Connection</th>
                    <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide text-right">Severity</th>
                    <th className="px-4 py-2.5 text-[10px] font-semibold text-neutral-400 uppercase tracking-wide text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/60">
                  {tickets.map((ticket, i) => (
                    <tr
                      key={ticket.id}
                      onClick={() => setSelectedTicketId(ticket.id)}
                      className={`hover:bg-neutral-800/40 transition-colors cursor-pointer group font-semibold text-xs ${i % 2 === 1 ? 'bg-white/[0.02]' : ''}`}
                    >
                      <td className="px-4 py-3 font-mono font-bold text-[10px] text-[var(--text-secondary)]">{ticket.id}</td>
                      <td className="px-4 py-3 font-black uppercase italic text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] transition-colors">
                        {ticket.title}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5 uppercase italic text-[9px]">
                          <TypeIcon type={ticket.type} />
                          {ticket.type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-black uppercase italic tracking-wider text-[var(--text-primary)]">
                          {ticket.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <PriorityBadge priority={ticket.priority} />
                      </td>
                      <td className="px-4 py-3 text-[var(--text-secondary)]">{ticket.assignee || 'Unassigned'}</td>
                      <td className="px-4 py-3">
                        {ticket.jiraKey ? (
                          <span className="text-[9px] font-mono font-bold text-cyan-400 flex items-center gap-1">
                            <Link2 size={10} />
                            {ticket.jiraKey}
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold text-[var(--text-secondary)] opacity-40 uppercase">Local Only</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-orange-400 text-right">{ticket.severity.toFixed(1)}</td>
                      <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => navigate(`/tickets/${ticket.id}`)}
                          className="p-1.5 hover:bg-[var(--bg-primary)] border border-transparent hover:border-[var(--border-subtle)] rounded-lg text-[var(--text-secondary)] hover:text-white transition-all"
                        >
                          <ChevronRight size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Ticket Create Modal Overlay */}
      {showCreateModal && (
        <TicketForm
          onClose={() => setShowCreateModal(false)}
          onSave={(newTicket) => {
            refetch();
            refetchStats();
          }}
        />
      )}

      {/* Ticket Details Modal Overlay */}
      {selectedTicketId && (
        <IssueDetailModal
          ticketId={selectedTicketId}
          onClose={() => setSelectedTicketId(null)}
          onSave={() => {
            refetch();
            refetchStats();
          }}
        />
      )}
    </div>
  );
}
