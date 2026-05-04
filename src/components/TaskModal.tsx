import { useState, useEffect } from 'react';
import { databases, DB_ID, COLLECTIONS, ID } from '../lib/appwrite';
import { X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';

interface TaskModalProps {
  task: any | null;
  onClose: () => void;
  onSave: () => void;
}

export default function TaskModal({ task, onClose, onSave }: TaskModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<string>('todo');
  const [priority, setPriority] = useState<string>('medium');
  const [dueDate, setDueDate] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
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
      };

      if (task) {
        await databases.updateDocument(DB_ID, COLLECTIONS.TASKS, task.$id, taskData);
      } else {
        await databases.createDocument(DB_ID, COLLECTIONS.TASKS, ID.unique(), {
          ...taskData,
          user_id: user?.$id,
        });
      }

      onSave();
    } catch (err: any) {
      setError(err.message || t('common.error_occurred', 'An error occurred'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-[var(--bg-card)] rounded-2xl shadow-2xl border border-[var(--border-subtle)] w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-[var(--border-subtle)]">
          <h2 className="text-2xl font-black italic tracking-tighter text-[var(--text-primary)]">
            {task ? t('tasks.modal.edit_title', 'REDEFINE PROTOCOL') : t('tasks.modal.create_title', 'INITIATE NEW TASK')}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:bg-slate-800 rounded-lg transition"
          >
            <X className="w-6 h-6 text-gray-600 dark:text-gray-300" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="bg-[var(--status-error)]/10 border border-[var(--status-error)]/20 rounded-lg p-4">
              <p className="text-sm text-[var(--status-error)] font-bold italic uppercase tracking-widest">{error}</p>
            </div>
          )}

          <div>
            <label htmlFor="title" className="block text-[10px] font-black uppercase tracking-widest italic text-[var(--text-secondary)] mb-2">
              {t('tasks.modal.title_label', 'Task Title')} <span className="text-[var(--status-error)]">*</span>
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg focus:ring-2 focus:ring-[var(--accent-primary)] focus:border-[var(--accent-primary)] outline-none transition text-[var(--text-primary)] placeholder-[var(--text-secondary)]/50"
              placeholder={t('tasks.modal.title_placeholder', 'Enter task title')}
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-[10px] font-black uppercase tracking-widest italic text-[var(--text-secondary)] mb-2">
              {t('tasks.modal.description_label', 'Description')}
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg focus:ring-2 focus:ring-[var(--accent-primary)] focus:border-[var(--accent-primary)] outline-none transition resize-none text-[var(--text-primary)] placeholder-[var(--text-secondary)]/50"
              placeholder={t('tasks.modal.description_placeholder', 'Enter task description')}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="status" className="block text-[10px] font-black uppercase tracking-widest italic text-[var(--text-secondary)] mb-2">
                {t('tasks.modal.status_label', 'Status')}
              </label>
              <select
                id="status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg focus:ring-2 focus:ring-[var(--accent-primary)] focus:border-[var(--accent-primary)] outline-none transition text-[var(--text-primary)]"
              >
                <option value="todo" className="bg-[var(--bg-card)]">{t('tasks.modal.status_todo', 'To Do')}</option>
                <option value="in_progress" className="bg-[var(--bg-card)]">{t('tasks.modal.status_in_progress', 'In Progress')}</option>
                <option value="completed" className="bg-[var(--bg-card)]">{t('tasks.modal.status_completed', 'Completed')}</option>
              </select>
            </div>
 
            <div>
              <label htmlFor="priority" className="block text-[10px] font-black uppercase tracking-widest italic text-[var(--text-secondary)] mb-2">
                {t('tasks.modal.priority_label', 'Priority')}
              </label>
              <select
                id="priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg focus:ring-2 focus:ring-[var(--accent-primary)] focus:border-[var(--accent-primary)] outline-none transition text-[var(--text-primary)]"
              >
                <option value="low" className="bg-[var(--bg-card)]">{t('tasks.modal.priority_low', 'Low')}</option>
                <option value="medium" className="bg-[var(--bg-card)]">{t('tasks.modal.priority_medium', 'Medium')}</option>
                <option value="high" className="bg-[var(--bg-card)]">{t('tasks.modal.priority_high', 'High')}</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="dueDate" className="block text-[10px] font-black uppercase tracking-widest italic text-[var(--text-secondary)] mb-2">
              {t('tasks.modal.due_date_label', 'Due Date')}
            </label>
            <input
              id="dueDate"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg focus:ring-2 focus:ring-[var(--accent-primary)] focus:border-[var(--accent-primary)] outline-none transition text-[var(--text-primary)]"
            />
          </div>

            <div>
              <label htmlFor="repoUrl" className="block text-[10px] font-black uppercase tracking-widest italic text-[var(--text-secondary)] mb-2">
                {t('tasks.modal.repo_url_label', 'Repository URL')}
              </label>
              <input
                id="repoUrl"
                type="url"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                className="w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg focus:ring-2 focus:ring-[var(--accent-primary)] focus:border-[var(--accent-primary)] outline-none transition text-[var(--text-primary)] placeholder-[var(--text-secondary)]/50"
                placeholder="https://github.com/..."
              />
            </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 border border-[var(--border-subtle)] text-[var(--text-secondary)] rounded-lg hover:bg-[var(--bg-secondary)] transition font-black uppercase tracking-widest italic text-xs"
            >
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-6 py-3 bg-[var(--accent-primary)] hover:bg-[var(--accent-secondary)] disabled:opacity-50 text-white rounded-lg transition font-black uppercase tracking-widest italic text-xs shadow-xl shadow-[var(--accent-primary)]/20"
            >
              {loading ? t('common.processing', 'Processing...') : task ? t('tasks.modal.confirm_update', 'Confirm Override') : t('tasks.modal.confirm_create', 'Deploy Task')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}




