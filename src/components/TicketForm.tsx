import React, { useState } from 'react';
import { X, Loader2, Save } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { createTicket } from '../hooks/useTickets';
import { Ticket } from '../../shared/types';
import toast from 'react-hot-toast';

interface Props {
  onClose: () => void;
  onSave: (ticket: Ticket) => void;
}

export default function TicketForm({ onClose, onSave }: Props) {
  const { getJWT } = useAuth();
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    title: '',
    description: '',
    type: 'task' as Ticket['type'],
    priority: 'medium' as Ticket['priority'],
    status: 'todo' as Ticket['status'],
    assignee: '',
    severity: 0,
    tags: '',
    linkedFindings: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.description.trim()) {
      toast.error('Title and description are required.');
      return;
    }

    setLoading(true);
    try {
      const parsedTags = form.tags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);
      
      const parsedFindings = form.linkedFindings
        .split(',')
        .map(f => f.trim())
        .filter(f => f.length > 0);

      const ticket = await createTicket(getJWT, {
        title: form.title.trim(),
        description: form.description.trim(),
        type: form.type,
        priority: form.priority,
        status: form.status,
        assignee: form.assignee.trim(),
        reporter: '', // Backend overrides this with the auth user
        severity: Number(form.severity),
        tags: parsedTags,
        linkedFindings: parsedFindings
      });

      toast.success('Ticket created successfully');
      onSave(ticket);
      onClose();
    } catch (err: any) {
      console.error('Error creating ticket:', err);
      toast.error(err.message || 'Failed to create ticket');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl w-full max-w-lg flex flex-col relative overflow-hidden max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/50">
          <div>
            <h3 className="text-sm font-black uppercase italic tracking-wider text-[var(--accent-primary)]">
              + Create Security Ticket
            </h3>
            <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase mt-0.5 tracking-wider font-mono">
              Initialize task tracking & compliance records
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors p-1"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="space-y-1">
            <label className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-wider block">
              Ticket Title *
            </label>
            <input
              type="text"
              required
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Upgrade outdated lodash version"
              className="w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all font-semibold"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-wider block">
              Description *
            </label>
            <textarea
              required
              rows={4}
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="Describe the issue, reproduction steps, or compliance task..."
              className="w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all font-semibold resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-wider block">
                Type
              </label>
              <select
                value={form.type}
                onChange={e => setForm({ ...form, type: e.target.value as any })}
                className="w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all font-bold uppercase italic"
              >
                <option value="task">Task</option>
                <option value="bug">Bug</option>
                <option value="vulnerability">Vulnerability</option>
                <option value="feature">Feature</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-wider block">
                Priority
              </label>
              <select
                value={form.priority}
                onChange={e => setForm({ ...form, priority: e.target.value as any })}
                className="w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all font-bold uppercase italic"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-wider block">
                Status
              </label>
              <select
                value={form.status}
                onChange={e => setForm({ ...form, status: e.target.value as any })}
                className="w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all font-bold uppercase italic"
              >
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="in_review">In Review</option>
                <option value="done">Done</option>
                <option value="closed">Closed</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-wider block">
                Severity (0-10)
              </label>
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={form.severity}
                onChange={e => setForm({ ...form, severity: parseFloat(e.target.value) || 0 })}
                className="w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all font-semibold"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-wider block">
              Assignee
            </label>
            <input
              type="text"
              value={form.assignee}
              onChange={e => setForm({ ...form, assignee: e.target.value })}
              placeholder="Operator name"
              className="w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all font-semibold"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-wider block">
              Tags (Comma separated)
            </label>
            <input
              type="text"
              value={form.tags}
              onChange={e => setForm({ ...form, tags: e.target.value })}
              placeholder="security, patch, dependency"
              className="w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all font-mono text-[10px]"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-wider block">
              Linked Findings (Comma separated IDs)
            </label>
            <input
              type="text"
              value={form.linkedFindings}
              onChange={e => setForm({ ...form, linkedFindings: e.target.value })}
              placeholder="e.g. f-101, f-102"
              className="w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all font-mono text-[10px]"
            />
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]/20 -mx-6 -mb-6 p-6">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-5 py-2.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-[10px] font-black uppercase italic tracking-widest text-[var(--text-secondary)] hover:text-white transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 bg-[var(--accent-primary)] hover:bg-opacity-95 text-black text-[10px] font-black uppercase italic tracking-widest rounded-xl transition-all flex items-center gap-2"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Create Ticket
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
