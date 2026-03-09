import { useState, useEffect } from 'react';
import { databases, DB_ID, COLLECTIONS, ID } from '../lib/appwrite';
import { X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface TaskModalProps {
  task: any | null;
  onClose: () => void;
  onSave: () => void;
}

export default function TaskModal({ task, onClose, onSave }: TaskModalProps) {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<string>('todo');
  const [priority, setPriority] = useState<string>('medium');
  const [dueDate, setDueDate] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [issueUrl, setIssueUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description);
      setStatus(task.status);
      setPriority(task.priority);
      setDueDate(task.due_date ? task.due_date.split('T')[0] : '');
      setRepoUrl(task.repo_url || '');
      setIssueUrl(task.issue_url || '');
    }
  }, [task]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const taskData = {
        title,
        description,
        status,
        priority,
        due_date: dueDate || null,
        repo_url: repoUrl || null,
        issue_url: issueUrl || null,
        updated_at: new Date().toISOString(),
      };

      if (task) {
        await databases.updateDocument(DB_ID, COLLECTIONS.TASKS, task.$id, taskData);
      } else {
        await databases.createDocument(DB_ID, COLLECTIONS.TASKS, ID.unique(), {
          ...taskData,
          user_id: user?.$id || user?.id
        });
      }

      onSave();
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[4px] flex items-center justify-center p-6 z-[100] animate-fade-up">
      <div className="bg-white rounded-xl shadow-[0_20px_48px_rgba(0,0,0,0.12)] border border-border w-full max-w-[560px] max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-8 py-6 border-b border-border bg-surface/30">
          <div>
            <h2 className="text-[18px] font-semibold tracking-tight text-text">
              {task ? 'Update Operation' : 'Deploy New Task'}
            </h2>
            <p className="text-[11px] text-text-muted font-medium uppercase tracking-wider mt-0.5">Intelligence Orchestration</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-text-muted hover:text-text hover:bg-surface rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6 overflow-y-auto">
          {error && (
            <div className="bg-danger-light border border-danger/10 rounded-md p-4 flex items-start gap-3">
              <p className="text-[13px] text-danger font-medium leading-relaxed">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="title" className="block text-[13px] font-medium text-text-muted mb-2">
                Task Objective <span className="text-danger">*</span>
              </label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-md text-[14px] outline-none focus:border-accent transition-colors placeholder:text-text-subtle"
                placeholder="e.g., Remediate SQL injection vulnerability"
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-[13px] font-medium text-text-muted mb-2">
                Operational Intelligence
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full px-4 py-2.5 bg-surface border border-border rounded-md text-[14px] outline-none focus:border-accent transition-colors placeholder:text-text-subtle resize-none"
                placeholder="Detailed description of the findings and remediation steps..."
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="status" className="block text-[13px] font-medium text-text-muted mb-2">
                  Deployment Status
                </label>
                <select
                  id="status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full px-4 py-2.5 bg-surface border border-border rounded-md text-[14px] outline-none focus:border-accent transition-colors"
                >
                  <option value="todo">Pending Stage</option>
                  <option value="in_progress">Active Execution</option>
                  <option value="completed">Verified Success</option>
                </select>
              </div>

              <div>
                <label htmlFor="priority" className="block text-[13px] font-medium text-text-muted mb-2">
                  Mission Priority
                </label>
                <select
                  id="priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full px-4 py-2.5 bg-surface border border-border rounded-md text-[14px] outline-none focus:border-accent transition-colors"
                >
                  <option value="low">Standard</option>
                  <option value="medium">Elevated</option>
                  <option value="high">Critical</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="dueDate" className="block text-[13px] font-medium text-text-muted mb-2">
                  Target Date
                </label>
                <input
                  id="dueDate"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-4 py-2.5 bg-surface border border-border rounded-md text-[14px] outline-none focus:border-accent transition-colors"
                />
              </div>

              <div>
                <label htmlFor="repoUrl" className="block text-[13px] font-medium text-text-muted mb-2">
                  Asset Repository
                </label>
                <input
                  id="repoUrl"
                  type="url"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="w-full px-4 py-2.5 bg-surface border border-border rounded-md text-[14px] outline-none focus:border-accent transition-colors placeholder:text-text-subtle"
                  placeholder="https://github.com/..."
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-4 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost !py-2.5 !px-6 flex-1 justify-center !text-[14px]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary !py-2.5 !px-6 flex-1 justify-center !text-[14px]"
            >
              {loading ? 'Processing...' : task ? 'Update Operation' : 'Deploy Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}




