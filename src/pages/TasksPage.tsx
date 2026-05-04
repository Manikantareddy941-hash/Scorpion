import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import {
  Plus, CheckCircle2, Clock, AlertCircle, Edit2, Trash2
} from 'lucide-react';
import TaskModal from '../components/TaskModal';

import { useTranslation } from 'react-i18next';

export default function TasksPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any | null>(null);
  const [filter, setFilter] = useState<'all' | 'todo' | 'in_progress' | 'completed'>('all');

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    try {
      if (!user?.$id) return;
      setError('');
      const response = await databases.listDocuments(DB_ID, COLLECTIONS.TASKS, [
        Query.equal('user_id', user.$id),
        Query.orderDesc('$createdAt'),
      ]);

      setTasks(response.documents || []);
    } catch (error: any) {
      console.error('Error fetching tasks:', error);
      setError(error.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  };

  const deleteTask = async (id: string) => {
    try {
      await databases.deleteDocument(DB_ID, COLLECTIONS.TASKS, id);
      setTasks(tasks.filter((task) => task.$id !== id));
    } catch (error) {
      console.error('Error deleting task:', error);
    }
  };

  const updateTaskStatus = async (id: string, status: string) => {
    try {
      await databases.updateDocument(DB_ID, COLLECTIONS.TASKS, id, {
        status,
      });

      setTasks(tasks.map((task) => (task.$id === id ? { ...task, status } : task)));
    } catch (error) {
      console.error('Error updating task:', error);
    }
  };

  const handleTaskSaved = () => {
    fetchTasks();
    setIsModalOpen(false);
    setEditingTask(null);
  };

  const filteredTasks = filter === 'all' ? tasks : tasks.filter((task) => task.status === filter);

  const stats = {
    total: tasks.length,
    todo: tasks.filter((t) => t.status === 'todo').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'text-[var(--status-error)] bg-[var(--status-error)]/10 border-[var(--status-error)]/20';
      case 'medium': return 'text-[var(--status-warning)] bg-[var(--status-warning)]/10 border-[var(--border-subtle)]';
      case 'low': return 'text-[var(--text-secondary)] bg-[var(--bg-secondary)] border-[var(--border-subtle)]';
      default: return 'text-[var(--text-secondary)] bg-[var(--bg-secondary)] border-[var(--border-subtle)]';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-5 h-5 text-[var(--status-success)]" />;
      case 'in_progress': return <Clock className="w-5 h-5 text-[var(--text-primary)]" />;
      default: return <AlertCircle className="w-5 h-5 text-[var(--text-secondary)]" />;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[var(--accent-primary)] border-t-transparent rounded-full animate-spin" />
          <h2 className="text-xs font-black text-[var(--text-secondary)] uppercase tracking-widest italic">{t('dashboard.loading')}</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-12">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-[var(--accent-primary)] rounded-2xl flex items-center justify-center text-white shadow-xl shadow-[var(--accent-primary)]/20">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-[var(--text-primary)] tracking-tighter uppercase italic">{t('tasks.title')}</h1>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] mt-1 italic font-mono">{t('tasks.subtitle')}</p>
          </div>
        </div>
        
        <button
          onClick={() => { setEditingTask(null); setIsModalOpen(true); }}
          className="btn-premium flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> {t('tasks.deploy_task')}
        </button>
      </div>

      {/* Action Center Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
        {[
          { label: t('tasks.active_tasks'), value: stats.total },
          { label: t('tasks.pending'), value: stats.todo },
          { label: t('tasks.in_progress'), value: stats.inProgress },
          { label: t('tasks.resolved'), value: stats.completed },
        ].map((stat) => (
          <div key={stat.label} className="p-6 flex items-center justify-between group hover:border-[var(--accent-primary)] transition-colors premium-card">
            <div>
              <p className="text-[10px] font-black text-[var(--text-primary)] uppercase tracking-widest italic mb-2">{stat.label}</p>
              <p className={`text-4xl font-black tracking-tighter italic text-[var(--accent-primary)]`}>{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Task Management Section */}
      <div className="premium-card overflow-hidden">
        <div className="px-10 py-8 border-b border-[var(--border-subtle)] bg-white/5 dark:bg-white/10">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div>
              <h2 className="text-xl font-black text-[var(--text-primary)] uppercase italic tracking-tight">{t('tasks.fleet_tasks')}</h2>
              <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1 italic font-mono">{t('tasks.status_tracking')}</p>
            </div>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              className="px-6 py-3 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl text-[10px] font-black text-[var(--text-primary)] uppercase italic tracking-widest outline-none focus:ring-2 focus:ring-[var(--accent-primary)] transition-all"
            >
              <option value="all">{t('tasks.global_fleet')}</option>
              <option value="todo">{t('tasks.pending_stage')}</option>
              <option value="in_progress">{t('tasks.active_remediation')}</option>
              <option value="completed">{t('tasks.production_ready')}</option>
            </select>
          </div>
        </div>

        <div className="divide-y divide-[var(--border-subtle)]">
          {error ? (
            <div className="p-24 text-center">
              <AlertCircle className="w-10 h-10 text-[var(--status-error)] mx-auto mb-4" />
              <p className="text-[10px] font-bold text-[var(--status-error)] uppercase tracking-widest italic">{error}</p>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="p-24 text-center">
              <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic">{t('tasks.no_tasks')}</p>
            </div>
          ) : (
            filteredTasks.map((task) => (
              <div key={task.$id} className="p-8 hover:bg-white/5 transition-all group">
                <div className="flex flex-col md:flex-row items-start justify-between gap-8">
                  <div className="flex items-start gap-6 flex-1">
                    <div className="mt-1.5 p-2 bg-[var(--bg-primary)] rounded-lg shadow-sm border border-[var(--border-subtle)]">
                      {getStatusIcon(task.status)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-3 mb-3">
                        <h3 className="text-lg font-black text-[var(--text-primary)] leading-tight italic uppercase tracking-tight">{task.title}</h3>
                        <span className={`px-4 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.15em] italic border ${getPriorityColor(task.priority)}`}>
                          {task.priority} {t('tasks.priority')}
                        </span>
                      </div>
                      {task.description && (
                        <p className="text-[var(--text-secondary)] text-xs font-medium leading-relaxed mb-6">
                          {task.description}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-4">
                        <select
                          value={task.status}
                          onChange={(e) => updateTaskStatus(task.$id, e.target.value)}
                          className="px-4 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg text-[9px] font-black text-[var(--text-primary)] uppercase tracking-widest italic outline-none focus:ring-2 focus:ring-[var(--accent-primary)] transition-all"
                        >
                          <option value="todo">{t('tasks.pending')}</option>
                          <option value="in_progress">{t('tasks.executing')}</option>
                          <option value="completed">{t('tasks.verified')}</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="flex md:flex-col items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => { setEditingTask(task); setIsModalOpen(true); }}
                      className="p-3 text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 rounded-xl transition-all border border-transparent hover:border-[var(--border-subtle)]"
                    >
                      <Edit2 className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => { if (confirm(t('tasks.erase_task'))) deleteTask(task.$id); }}
                      className="p-3 text-[var(--text-secondary)] hover:text-[var(--status-error)] hover:bg-[var(--status-error)]/10 rounded-xl transition-all border border-transparent hover:border-[var(--border-subtle)]"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {isModalOpen && (
        <TaskModal
          task={editingTask}
          onClose={() => { setIsModalOpen(false); setEditingTask(null); }}
          onSave={handleTaskSaved}
        />
      )}
    </div>
  );
}
