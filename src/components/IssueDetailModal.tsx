import React, { useState, useEffect } from 'react';
import { X, Loader2, Send, User, Clock, Link2, ExternalLink, Activity, Tag, Calendar, ShieldAlert, Bug, Sparkles, Plus, AlertOctagon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTicket, updateTicket, addComment } from '../hooks/useTickets';
import { Ticket } from '../../shared/types';
import toast from 'react-hot-toast';

interface Props {
  ticketId: string;
  onClose: () => void;
  onSave?: () => void;
}

export default function IssueDetailModal({ ticketId, onClose, onSave }: Props) {
  const { getJWT } = useAuth();
  const { ticket, comments, activity, loading, error, refetch } = useTicket(ticketId);

  const [commentBody, setCommentBody] = useState('');
  const [commenting, setCommenting] = useState(false);

  // Temporary local state for assignee, storyPoints, dueDate for smoother inline editing
  const [localAssignee, setLocalAssignee] = useState('');
  const [localStoryPoints, setLocalStoryPoints] = useState<string>('');
  const [localDueDate, setLocalDueDate] = useState('');

  useEffect(() => {
    if (ticket) {
      setLocalAssignee(ticket.assignee || '');
      setLocalStoryPoints(ticket.storyPoints !== undefined ? String(ticket.storyPoints) : '');
      setLocalDueDate(ticket.dueDate || '');
    }
  }, [ticket]);

  const handleUpdateField = async (field: keyof Ticket, value: any) => {
    if (!ticket) return;
    try {
      await updateTicket(getJWT, ticket.id, { [field]: value });
      refetch();
      if (onSave) onSave();
    } catch (err: any) {
      toast.error(err.message || `Failed to update ${String(field)}`);
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentBody.trim() || !ticket) return;

    setCommenting(true);
    try {
      await addComment(getJWT, ticket.id, commentBody.trim());
      setCommentBody('');
      toast.success('Comment added');
      refetch();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add comment');
    } finally {
      setCommenting(false);
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

  const calculateAge = (createdAt: string) => {
    const created = new Date(createdAt).getTime();
    const diffMs = Date.now() - created;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) {
      const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
      if (diffHrs === 0) return 'Created just now';
      return `${diffHrs}h ago`;
    }
    return `${diffDays} days old`;
  };

  const getInitials = (name: string) => {
    if (!name) return 'U';
    return name.split('@')[0].substring(0, 2).toUpperCase();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
        <div className="card bg-neutral-900 border border-neutral-800 rounded-lg shadow-lg p-8 flex flex-col items-center justify-center min-w-[300px]">
          <Loader2 className="w-10 h-10 text-[var(--accent-primary)] animate-spin mb-4" />
          <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] italic">
            Loading ticket payload...
          </p>
        </div>
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
        <div className="card bg-neutral-900 border border-red-500/20 rounded-lg shadow-lg p-8 max-w-md text-center">
          <AlertOctagon className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-sm font-black text-red-500 uppercase italic">Ticket Offline</h3>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase mt-2">
            {error || 'Failed to load ticket details.'}
          </p>
          <button
            onClick={onClose}
            className="mt-6 px-6 py-2 bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white text-[9px] font-black uppercase tracking-widest rounded-xl transition-all"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="card bg-neutral-900 border border-neutral-800 rounded-lg shadow-lg w-full max-w-4xl flex flex-col relative overflow-hidden max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono font-bold text-[var(--text-secondary)] bg-[var(--bg-primary)] border border-[var(--border-subtle)] px-2.5 py-1 rounded-lg">
              {ticket.id}
            </span>
            {ticket.jiraKey && (
              <span className="text-[10px] font-mono font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1 rounded-lg flex items-center gap-1">
                <ExternalLink size={10} />
                {ticket.jiraKey}
              </span>
            )}
            <div className="flex items-center gap-1.5 ml-2">
              <TypeIcon type={ticket.type} />
              <span className="text-[10px] font-black uppercase italic tracking-wider text-[var(--text-secondary)]">
                {ticket.type}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors p-1"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body (Split columns) */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col lg:flex-row gap-6">
          {/* Main Content Pane (Left) */}
          <div className="flex-1 space-y-6">
            <div>
              <h2 className="text-lg font-black text-[var(--text-primary)] uppercase italic leading-tight">
                {ticket.title}
              </h2>
              <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]/40">
                <label className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-wider block mb-1.5 font-mono">
                  Description
                </label>
                <p className="text-xs text-[var(--text-secondary)] font-semibold leading-relaxed whitespace-pre-wrap bg-[var(--bg-primary)]/30 border border-[var(--border-subtle)]/30 p-3 rounded-xl">
                  {ticket.description || 'No description provided.'}
                </p>
              </div>
            </div>

            {/* Tags & Findings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-wider block font-mono">
                  Linked Findings
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ticket.linkedFindings && ticket.linkedFindings.length > 0 ? (
                    ticket.linkedFindings.map(fid => (
                      <span
                        key={fid}
                        className="inline-flex items-center gap-1 text-[9px] font-mono font-bold text-orange-400 bg-orange-500/10 border border-orange-500/25 px-2.5 py-0.5 rounded-lg"
                      >
                        <Link2 size={10} />
                        {fid}
                      </span>
                    ))
                  ) : (
                    <span className="text-[9px] text-[var(--text-secondary)] opacity-50 uppercase italic font-bold">No linked findings</span>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-wider block font-mono">
                  Tags
                </label>
                <div className="flex flex-wrap gap-1.5 items-center">
                  {ticket.tags && ticket.tags.length > 0 ? (
                    ticket.tags.map(tag => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--text-secondary)] bg-[var(--bg-primary)] border border-[var(--border-subtle)] px-2.5 py-0.5 rounded-lg"
                      >
                        <Tag size={9} />
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="text-[9px] text-[var(--text-secondary)] opacity-50 uppercase italic font-bold">No tags</span>
                  )}
                </div>
              </div>
            </div>

            {/* Comments Section */}
            <div className="space-y-4 pt-4 border-t border-[var(--border-subtle)]/40">
              <div>
                <h3 className="text-xs font-black uppercase italic tracking-wider text-[var(--text-primary)]">
                  Operator Comments
                </h3>
              </div>

              <div className="space-y-3 max-h-[200px] overflow-y-auto pr-1">
                {comments.length === 0 ? (
                  <p className="text-[9px] font-bold uppercase italic text-[var(--text-secondary)] opacity-40 text-center py-4">
                    No comments yet.
                  </p>
                ) : (
                  comments.map(c => (
                    <div key={c.id} className="p-3 bg-[var(--bg-primary)]/40 border border-neutral-800 rounded-lg flex gap-3 items-start">
                      <div className="w-7 h-7 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] flex items-center justify-center font-bold text-[10px] text-[var(--accent-primary)] shrink-0">
                        {getInitials(c.author)}
                      </div>
                      <div className="flex-1 space-y-0.5 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-black text-[var(--text-primary)] truncate">{c.author}</span>
                          <span className="text-[8px] font-bold text-[var(--text-secondary)] font-mono shrink-0">
                            {new Date(c.createdAt).toLocaleDateString()} {new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-secondary)] font-semibold whitespace-pre-wrap">{c.body}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <form onSubmit={handleAddComment} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Add a comment..."
                  value={commentBody}
                  onChange={e => setCommentBody(e.target.value)}
                  disabled={commenting}
                  className="flex-1 px-4 py-2.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all font-semibold"
                />
                <button
                  type="submit"
                  disabled={commenting || !commentBody.trim()}
                  className="px-4 py-2.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/40 text-[var(--text-secondary)] hover:text-white rounded-xl transition-all cursor-pointer flex items-center justify-center shrink-0 disabled:opacity-50"
                >
                  {commenting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send size={12} />}
                </button>
              </form>
            </div>

            {/* Activity Log */}
            <div className="space-y-3 pt-4 border-t border-[var(--border-subtle)]/40">
              <div>
                <h3 className="text-xs font-black uppercase italic tracking-wider text-[var(--text-primary)]">
                  System Activity Log
                </h3>
              </div>

              <div className="space-y-2 max-h-[150px] overflow-y-auto pr-1 font-mono text-[9px] text-[var(--text-secondary)]">
                {activity.length === 0 ? (
                  <p className="font-bold uppercase italic opacity-40 text-center py-4">No activity logs recorded.</p>
                ) : (
                  activity.map(a => (
                    <div key={a.id} className="flex items-start gap-2 py-1 border-b border-[var(--border-subtle)]/20 last:border-0">
                      <Activity size={10} className="text-cyan-500 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <span className="font-bold text-[var(--text-primary)]">[{a.actor}]</span>{' '}
                        <span>{a.details.message || `${a.type.replace('_', ' ')}: changed ${a.details.field} from ${a.details.oldValue} to ${a.details.newValue}`}</span>
                      </div>
                      <span className="shrink-0 text-[8px] font-bold opacity-75">{calculateAge(a.createdAt)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Details Sidebar (Right) */}
          <div className="w-full lg:w-[280px] shrink-0 space-y-4 bg-[var(--bg-secondary)]/25 p-4 rounded-xl border border-[var(--border-subtle)]/40">
            <h4 className="text-[10px] font-black uppercase italic tracking-wider text-[var(--accent-primary)] pb-1.5 border-b border-[var(--border-subtle)]/50">
              Ticket Metadata
            </h4>

            {/* Status Inline Edit */}
            <div className="space-y-1">
              <label className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-wider block font-mono">
                Status
              </label>
              <select
                value={ticket.status}
                onChange={e => handleUpdateField('status', e.target.value as any)}
                className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs font-bold uppercase italic text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all cursor-pointer"
              >
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="in_review">In Review</option>
                <option value="done">Done</option>
                <option value="closed">Closed</option>
              </select>
            </div>

            {/* Priority Inline Edit */}
            <div className="space-y-1">
              <label className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-wider block font-mono">
                Priority
              </label>
              <select
                value={ticket.priority}
                onChange={e => handleUpdateField('priority', e.target.value as any)}
                className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs font-bold uppercase italic text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all cursor-pointer"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>

            {/* Assignee Inline Edit */}
            <div className="space-y-1">
              <label className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-wider block font-mono">
                Assignee
              </label>
              <div className="relative">
                <User size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  type="text"
                  value={localAssignee}
                  onChange={e => setLocalAssignee(e.target.value)}
                  onBlur={() => {
                    if (localAssignee.trim() !== (ticket.assignee || '')) {
                      handleUpdateField('assignee', localAssignee.trim());
                    }
                  }}
                  placeholder="Unassigned"
                  className="w-full pl-8 pr-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all"
                />
              </div>
            </div>

            {/* Story Points Inline Edit */}
            <div className="space-y-1">
              <label className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-wider block font-mono">
                Story Points
              </label>
              <input
                type="number"
                min={0}
                value={localStoryPoints}
                onChange={e => setLocalStoryPoints(e.target.value)}
                onBlur={() => {
                  const val = localStoryPoints === '' ? undefined : Number(localStoryPoints);
                  if (val !== ticket.storyPoints) {
                    handleUpdateField('storyPoints', val);
                  }
                }}
                placeholder="None"
                className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all"
              />
            </div>

            {/* Due Date Inline Edit */}
            <div className="space-y-1">
              <label className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-wider block font-mono">
                Due Date
              </label>
              <input
                type="date"
                value={localDueDate}
                onChange={e => setLocalDueDate(e.target.value)}
                onBlur={() => {
                  const val = localDueDate === '' ? undefined : localDueDate;
                  if (val !== (ticket.dueDate || '')) {
                    handleUpdateField('dueDate', val);
                  }
                }}
                className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all"
              />
            </div>

            {/* Epic Link (Read Only in detail modal) */}
            <div className="space-y-1">
              <label className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-wider block font-mono">
                Epic Link
              </label>
              <div className="px-3 py-2 bg-[var(--bg-primary)]/50 border border-[var(--border-subtle)]/40 rounded-xl text-xs font-semibold text-[var(--text-secondary)]">
                {ticket.epicLink || 'None'}
              </div>
            </div>

            {/* Sprint (Read Only in detail modal) */}
            <div className="space-y-1">
              <label className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-wider block font-mono">
                Sprint
              </label>
              <div className="px-3 py-2 bg-[var(--bg-primary)]/50 border border-[var(--border-subtle)]/40 rounded-xl text-xs font-semibold text-[var(--text-secondary)]">
                {ticket.sprintId || 'None'}
              </div>
            </div>

            {/* Severity slider / Read Only gauge */}
            <div className="space-y-1 pt-1.5">
              <div className="flex justify-between items-center text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-wider font-mono">
                <span>Severity</span>
                <span className="text-orange-400 font-bold text-[9px]">{ticket.severity ? ticket.severity.toFixed(1) : '0.0'}/10.0</span>
              </div>
              <div className="w-full h-1.5 bg-[var(--bg-primary)] rounded-full overflow-hidden border border-[var(--border-subtle)]/50">
                <div
                  className="h-full bg-gradient-to-r from-yellow-500 to-orange-500 transition-all duration-300"
                  style={{ width: `${(ticket.severity || 0) * 10}%` }}
                />
              </div>
            </div>

            {/* Audit Dates & Reporter info */}
            <div className="pt-2 border-t border-[var(--border-subtle)]/30 space-y-1.5 font-mono text-[8px] text-[var(--text-secondary)]">
              <div className="flex justify-between">
                <span>REPORTER:</span>
                <span className="font-bold text-[var(--text-primary)] truncate max-w-[120px]" title={ticket.reporter}>
                  {ticket.reporter ? ticket.reporter.split('@')[0] : 'System'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>CREATED:</span>
                <span className="font-bold text-[var(--text-primary)]">
                  {new Date(ticket.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span>UPDATED:</span>
                <span className="font-bold text-[var(--text-primary)]">
                  {new Date(ticket.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
