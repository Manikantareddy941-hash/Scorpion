import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTicket, updateTicket, addComment, syncToJira } from '../hooks/useTickets';
import { Ticket, TicketComment, TicketActivity } from '../../shared/types';
import {
  ArrowLeft, ExternalLink, Link2, Plus, Send, User, Clock,
  AlertOctagon, CheckCircle2, ShieldAlert, Bug, Sparkles,
  Loader2, RefreshCw, Check, Calendar, Activity, Tag
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getJWT } = useAuth();

  const { ticket, comments, activity, loading, error, refetch } = useTicket(id || '');

  // Inline edit states
  const [editingTitle, setEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  const [tempDesc, setTempDesc] = useState('');

  // Comment state
  const [commentBody, setCommentBody] = useState('');
  const [commenting, setCommenting] = useState(false);

  // Sync state
  const [syncing, setSyncing] = useState(false);

  // Update temp values on ticket load
  useEffect(() => {
    if (ticket) {
      setTempTitle(ticket.title);
      setTempDesc(ticket.description);
    }
  }, [ticket]);

  const handleUpdate = async (field: keyof Ticket, value: any) => {
    if (!ticket) return;
    try {
      await updateTicket(getJWT, ticket.id, { [field]: value });
      refetch();
    } catch (err: any) {
      toast.error(err.message || `Failed to update ${String(field)}`);
    }
  };

  const handleSaveTitle = async () => {
    if (!tempTitle.trim()) {
      toast.error('Title cannot be empty');
      return;
    }
    setEditingTitle(false);
    if (ticket && tempTitle.trim() !== ticket.title) {
      await handleUpdate('title', tempTitle.trim());
      toast.success('Title updated');
    }
  };

  const handleSaveDesc = async () => {
    if (!tempDesc.trim()) {
      toast.error('Description cannot be empty');
      return;
    }
    setEditingDesc(false);
    if (ticket && tempDesc.trim() !== ticket.description) {
      await handleUpdate('description', tempDesc.trim());
      toast.success('Description updated');
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

  const handleSyncToJira = async () => {
    if (!ticket) return;
    setSyncing(true);
    const toastId = toast.loading(ticket.jiraKey ? 'Re-syncing with Jira...' : 'Pushing ticket to Jira...');
    try {
      const result = await syncToJira(getJWT, ticket.id);
      if (result.ok) {
        toast.success(ticket.jiraKey ? `Synced issue: ${result.jiraKey}` : `Created Jira issue: ${result.jiraKey}`, { id: toastId });
        refetch();
      } else {
        toast.error(result.error || 'Sync failed', { id: toastId });
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to sync with Jira', { id: toastId });
    } finally {
      setSyncing(false);
    }
  };

  // Get Initials for comments avatar
  const getInitials = (name: string) => {
    if (!name) return 'U';
    return name.split('@')[0].substring(0, 2).toUpperCase();
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

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col items-center justify-center py-32">
        <Loader2 className="w-12 h-12 text-[var(--accent-primary)] animate-spin mb-4" />
        <p className="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] italic">
          Loading ticket inspector payload...
        </p>
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] py-12 px-4">
        <div className="max-w-xl mx-auto premium-card p-16 text-center border-red-500/20 bg-[var(--bg-card)]">
          <AlertOctagon className="w-16 h-16 text-red-500 mx-auto mb-6 animate-pulse" />
          <h3 className="text-xl font-black text-red-500 uppercase italic">Ticket Offline</h3>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase mt-2">
            {error || 'The requested ticket ID does not resolve to a stored object.'}
          </p>
          <button
            onClick={() => navigate('/tickets')}
            className="mt-6 px-6 py-2.5 bg-[var(--bg-primary)] hover:bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all"
          >
            Return to Board
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Top bar control path */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 premium-card bg-[var(--bg-card)]">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/tickets')}
              className="p-2.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white rounded-xl transition-colors"
            >
              <ArrowLeft size={16} />
            </button>
            <span className="text-[10px] font-mono font-bold text-[var(--text-secondary)] bg-[var(--bg-primary)] border border-[var(--border-subtle)] px-3 py-1 rounded-lg">
              {ticket.id}
            </span>
            {ticket.jiraKey && (
              <span className="text-[10px] font-mono font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-3 py-1 rounded-lg flex items-center gap-1.5">
                <ExternalLink size={10} />
                {ticket.jiraKey}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSyncToJira}
              disabled={syncing}
              className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase italic tracking-widest transition-all flex items-center gap-2 shadow-lg
                ${ticket.jiraKey 
                  ? 'bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 shadow-cyan-500/5' 
                  : 'bg-[var(--accent-primary)] hover:bg-opacity-95 text-black shadow-[var(--accent-primary)]/15'
                }`}
            >
              {syncing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {ticket.jiraKey ? 'Re-Sync JIRA' : 'Push to JIRA'}
            </button>
          </div>
        </div>

        {/* Main 2-Panel layout */}
        <div className="flex flex-col lg:flex-row gap-6">
          
          {/* Main Content Pane (Left) */}
          <div className="flex-1 space-y-6">
            
            {/* Title / Description Block */}
            <div className="premium-card p-6 space-y-4 bg-[var(--bg-card)]">
              {/* Title Section */}
              <div className="group relative">
                {editingTitle ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={tempTitle}
                      onChange={e => setTempTitle(e.target.value)}
                      className="flex-1 px-4 py-3 bg-[var(--bg-primary)] border border-[var(--accent-primary)] rounded-xl text-base font-black italic uppercase outline-none text-[var(--text-primary)] transition-all"
                    />
                    <button
                      onClick={handleSaveTitle}
                      className="p-3 bg-[var(--accent-primary)] text-black rounded-xl hover:bg-opacity-90 transition-all"
                    >
                      <Check size={16} strokeWidth={3} />
                    </button>
                    <button
                      onClick={() => {
                        setEditingTitle(false);
                        setTempTitle(ticket.title);
                      }}
                      className="p-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white rounded-xl transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <h2
                    onClick={() => setEditingTitle(true)}
                    className="text-xl font-black text-[var(--text-primary)] uppercase italic leading-tight hover:text-[var(--accent-primary)] cursor-pointer transition-colors"
                  >
                    {ticket.title}
                  </h2>
                )}
              </div>

              {/* Description Section */}
              <div className="group relative pt-2 border-t border-[var(--border-subtle)]/40">
                <label className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-wider block mb-2 font-mono">
                  Description / Context Ledger
                </label>
                {editingDesc ? (
                  <div className="space-y-2">
                    <textarea
                      rows={5}
                      value={tempDesc}
                      onChange={e => setTempDesc(e.target.value)}
                      className="w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--accent-primary)] rounded-xl text-xs font-semibold outline-none text-[var(--text-primary)] transition-all resize-none"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          setEditingDesc(false);
                          setTempDesc(ticket.description);
                        }}
                        className="px-4 py-2 bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white text-[10px] font-black uppercase rounded-lg transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveDesc}
                        className="px-4 py-2 bg-[var(--accent-primary)] text-black text-[10px] font-black uppercase rounded-lg hover:bg-opacity-90 transition-all"
                      >
                        Save Details
                      </button>
                    </div>
                  </div>
                ) : (
                  <p
                    onClick={() => setEditingDesc(true)}
                    className="text-xs text-[var(--text-secondary)] font-semibold leading-relaxed hover:bg-[var(--bg-primary)]/10 p-2 -m-2 rounded-lg cursor-pointer whitespace-pre-wrap transition-colors"
                  >
                    {ticket.description || 'No description entered. Click here to edit details.'}
                  </p>
                )}
              </div>

              {/* Tags & Findings */}
              <div className="flex flex-wrap gap-4 pt-2">
                {ticket.linkedFindings.length > 0 && (
                  <div className="space-y-1.5 w-full">
                    <label className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-wider block font-mono">
                      Linked Security Findings
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {ticket.linkedFindings.map(fid => (
                        <span
                          key={fid}
                          className="inline-flex items-center gap-1 text-[9px] font-mono font-bold text-orange-400 bg-orange-500/10 border border-orange-500/25 px-2.5 py-0.5 rounded-lg"
                        >
                          <Link2 size={10} />
                          {fid}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5 w-full">
                  <label className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-wider block font-mono">
                    Labels / Tags
                  </label>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {ticket.tags.map(tag => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 text-[9px] font-bold text-[var(--text-secondary)] bg-[var(--bg-primary)] border border-[var(--border-subtle)] px-2.5 py-0.5 rounded-lg"
                      >
                        <Tag size={9} />
                        {tag}
                      </span>
                    ))}
                    <button
                      onClick={() => {
                        const newTag = prompt('Enter tag:');
                        if (newTag?.trim()) {
                          const updatedTags = [...ticket.tags, newTag.trim()];
                          handleUpdate('tags', updatedTags);
                          toast.success('Tag added');
                        }
                      }}
                      className="px-2 py-0.5 border border-dashed border-[var(--border-subtle)] rounded-lg hover:border-[var(--accent-primary)]/40 hover:text-white transition-all text-[9px] font-bold flex items-center gap-0.5 text-[var(--text-secondary)]"
                    >
                      <Plus size={9} /> Add tag
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Comment Thread Pane */}
            <div className="premium-card p-6 space-y-6 bg-[var(--bg-card)]">
              <div>
                <h3 className="text-xs font-black uppercase italic tracking-wider text-[var(--text-primary)]">
                  Operator Comments
                </h3>
                <p className="text-[8px] text-[var(--text-secondary)] uppercase tracking-widest italic mt-0.5 font-mono">
                  Activity coordination ledger
                </p>
              </div>

              {/* Comments list */}
              <div className="space-y-4 max-h-[350px] overflow-y-auto pr-2">
                {comments.length === 0 ? (
                  <p className="text-[9px] font-bold uppercase italic text-[var(--text-secondary)] opacity-40 text-center py-4">
                    No operator logs entered.
                  </p>
                ) : (
                  comments.map(c => (
                    <div key={c.id} className="p-4 bg-[var(--bg-primary)]/40 border border-[var(--border-subtle)]/75 rounded-2xl flex gap-3.5 items-start">
                      <div className="w-8 h-8 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] flex items-center justify-center font-bold text-xs text-[var(--accent-primary)] shrink-0">
                        {getInitials(c.author)}
                      </div>
                      <div className="flex-1 space-y-1 min-w-0">
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

              {/* Add Comment Form */}
              <form onSubmit={handleAddComment} className="flex gap-3">
                <input
                  type="text"
                  placeholder="Post comment details to security ledger..."
                  value={commentBody}
                  onChange={e => setCommentBody(e.target.value)}
                  disabled={commenting}
                  className="flex-1 px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all font-semibold"
                />
                <button
                  type="submit"
                  disabled={commenting || !commentBody.trim()}
                  className="px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/40 text-[var(--text-secondary)] hover:text-white rounded-xl transition-all cursor-pointer flex items-center justify-center shrink-0 disabled:opacity-50"
                >
                  {commenting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                </button>
              </form>
            </div>

            {/* Audit Logs / Activity History */}
            <div className="premium-card p-6 space-y-4 bg-[var(--bg-card)]">
              <div>
                <h3 className="text-xs font-black uppercase italic tracking-wider text-[var(--text-primary)]">
                  System Activity Log
                </h3>
                <p className="text-[8px] text-[var(--text-secondary)] uppercase tracking-widest italic mt-0.5 font-mono">
                  State transition audit history
                </p>
              </div>

              <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-2 font-mono text-[9px] text-[var(--text-secondary)]">
                {activity.length === 0 ? (
                  <p className="font-bold uppercase italic opacity-40 text-center py-4">No audit logs logged.</p>
                ) : (
                  activity.map(a => (
                    <div key={a.id} className="flex items-start gap-2 py-1.5 border-b border-[var(--border-subtle)]/20 last:border-0">
                      <Activity size={12} className="text-cyan-500 shrink-0 mt-0.5" />
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
          <div className="w-full lg:w-[280px] shrink-0 space-y-6">
            
            {/* Meta status inspector card */}
            <div className="premium-card p-5 space-y-4 bg-[var(--bg-card)]">
              <h4 className="text-[10px] font-black uppercase italic tracking-wider text-[var(--accent-secondary)] pb-2 border-b border-[var(--border-subtle)]/50">
                Ticket Metadata
              </h4>

              {/* Status Select */}
              <div className="space-y-1">
                <label className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-wider block font-mono">
                  Operational Status
                </label>
                <select
                  value={ticket.status}
                  onChange={e => handleUpdate('status', e.target.value as any)}
                  className="w-full px-3 py-2.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs font-bold uppercase italic text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all cursor-pointer"
                >
                  <option value="todo">To Do</option>
                  <option value="in_progress">In Progress</option>
                  <option value="in_review">In Review</option>
                  <option value="done">Done</option>
                  <option value="closed">Closed</option>
                </select>
              </div>

              {/* Priority Select */}
              <div className="space-y-1">
                <label className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-wider block font-mono">
                  Priority Index
                </label>
                <select
                  value={ticket.priority}
                  onChange={e => handleUpdate('priority', e.target.value as any)}
                  className="w-full px-3 py-2.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs font-bold uppercase italic text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all cursor-pointer"
                >
                  <option value="low">Low Priority</option>
                  <option value="medium">Medium Priority</option>
                  <option value="high">High Priority</option>
                  <option value="critical">Critical Index</option>
                </select>
              </div>

              {/* Assignee Input */}
              <div className="space-y-1">
                <label className="text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-wider block font-mono">
                  Assigned Operator
                </label>
                <div className="relative">
                  <User size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                  <input
                    type="text"
                    value={ticket.assignee}
                    onChange={e => handleUpdate('assignee', e.target.value)}
                    placeholder="Unassigned"
                    className="w-full pl-8 pr-3 py-2.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all"
                  />
                </div>
              </div>

              {/* Severity Gauge Slider */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[8px] font-black text-[var(--text-secondary)] uppercase tracking-wider font-mono">
                  <span>CVSS Severity</span>
                  <span className="text-orange-400 font-bold text-[9px]">{ticket.severity.toFixed(1)}/10.0</span>
                </div>
                {/* Progress bar visual representation */}
                <div className="w-full h-2 bg-[var(--bg-primary)] rounded-full overflow-hidden border border-[var(--border-subtle)]/50">
                  <div
                    className="h-full bg-gradient-to-r from-yellow-500 to-orange-500 transition-all duration-300"
                    style={{ width: `${ticket.severity * 10}%` }}
                  />
                </div>
                {/* Input slider */}
                <input
                  type="range"
                  min="0"
                  max="10"
                  step="0.1"
                  value={ticket.severity}
                  onChange={e => handleUpdate('severity', parseFloat(e.target.value))}
                  className="w-full h-1 accent-orange-500 bg-[var(--bg-primary)] rounded-lg appearance-none cursor-pointer outline-none mt-1"
                />
              </div>

              {/* Audit Details */}
              <div className="pt-3 border-t border-[var(--border-subtle)]/30 space-y-2.5 font-mono text-[8px] text-[var(--text-secondary)]">
                <div className="flex justify-between">
                  <span>REPORTER:</span>
                  <span className="font-bold text-[var(--text-primary)] truncate max-w-[140px]" title={ticket.reporter}>
                    {ticket.reporter.split('@')[0]}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>AGE:</span>
                  <span className="font-bold text-[var(--text-primary)]">{calculateAge(ticket.createdAt)}</span>
                </div>
                {ticket.jiraSyncedAt && (
                  <div className="flex flex-col gap-0.5 pt-1 border-t border-[var(--border-subtle)]/10">
                    <div className="flex justify-between">
                      <span>JIRA SYNC:</span>
                      <span className={`font-bold uppercase ${ticket.jiraSyncStatus === 'synced' ? 'text-green-500' : 'text-red-500'}`}>
                        {ticket.jiraSyncStatus}
                      </span>
                    </div>
                    <div className="flex justify-between opacity-75">
                      <span>SYNC TIME:</span>
                      <span>{new Date(ticket.jiraSyncedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
