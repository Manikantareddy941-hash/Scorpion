import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase, Task } from '../lib/supabase';
import {
  LogOut, Plus, CheckCircle2, Clock, AlertCircle, Edit2, Trash2, Filter,
  Github, Shield, Settings, ChevronDown, Activity, Users,
  BarChart3, Sparkles, Sun, Moon, ArrowUpRight
} from 'lucide-react';

import TaskModal from './TaskModal';

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [filter, setFilter] = useState<'all' | 'todo' | 'in_progress' | 'completed'>('all');
  const [isNavOpen, setIsNavOpen] = useState(false);

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    try {
      setError('');
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTasks(data || []);
    } catch (error: any) {
      console.error('Error fetching tasks:', error);
      setError(error.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  };

  const deleteTask = async (id: string) => {
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', id);
      if (error) throw error;
      setTasks(tasks.filter((task) => task.id !== id));
    } catch (error) {
      console.error('Error deleting task:', error);
    }
  };

  const updateTaskStatus = async (id: string, status: Task['status']) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
      setTasks(tasks.map((task) => (task.id === id ? { ...task, status } : task)));
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
      case 'high': return 'text-rose-600 bg-rose-50 dark:bg-rose-500/10 border-rose-100 dark:border-rose-500/20';
      case 'medium': return 'text-amber-600 bg-amber-50 dark:bg-amber-500/10 border-amber-100 dark:border-amber-500/20';
      case 'low': return 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-100 dark:border-emerald-500/20';
      default: return 'text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-500/10 border-slate-100 dark:border-slate-800 dark:border-slate-500/20';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
      case 'in_progress': return <Clock className="w-5 h-5 text-blue-500" />;
      default: return <AlertCircle className="w-5 h-5 text-slate-400" />;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Shield className="w-12 h-12 text-blue-600 animate-pulse" />
          <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest animate-pulse italic">Initializing Pilot...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col transition-colors duration-300">
      <nav className="bg-[var(--bg-secondary)]/80 backdrop-blur-md shadow-sm border-b border-[var(--border-subtle)] sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-blue-600 rounded-lg shadow-lg shadow-blue-500/20">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tighter italic uppercase">StackPilot</h1>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={toggleTheme}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all text-slate-500 dark:text-slate-400 border border-transparent hover:border-[var(--border-subtle)]"
              >
                {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
              </button>

              <div className="relative">
                <button
                  onClick={() => setIsNavOpen(!isNavOpen)}
                  className="flex items-center gap-3 p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition border border-transparent hover:border-[var(--border-subtle)]"
                >
                  <div className="text-right hidden sm:block">
                    <p className="text-xs font-bold text-gray-900 dark:text-white leading-none mb-1">
                      {user?.email?.split('@')[0]}
                    </p>
                    <p className="text-[9px] text-gray-500 dark:text-gray-400 dark:text-gray-400 font-bold uppercase tracking-widest leading-none italic">
                      Security Lead
                    </p>
                  </div>
                  <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-black text-xs shadow-lg shadow-blue-500/20">
                    {user?.email?.[0].toUpperCase()}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isNavOpen ? 'rotate-180' : ''}`} />
                </button>

                {isNavOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsNavOpen(false)} />
                    <div className="absolute right-0 mt-2 w-64 bg-[var(--bg-secondary)] rounded-2xl shadow-2xl border border-[var(--border-subtle)] py-3 z-50 animate-in fade-in zoom-in duration-200">
                      <div className="px-4 py-3 border-b border-[var(--border-subtle)] mb-2">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic mb-1">Signed in as</p>
                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{user?.email}</p>
                      </div>

                      <div className="space-y-1">
                        {[
                          { to: '/security', icon: Shield, label: 'Security Dashboard' },
                          { to: '/ai-insights', icon: Sparkles, label: 'AI Insights' },
                          { to: '/reports', icon: BarChart3, label: 'Reports & Export' },
                          { to: '/teams', icon: Users, label: 'Team Members' },
                          { to: '/settings', icon: Settings, label: 'Global Settings' },
                        ].map((link) => (
                          <Link
                            key={link.to}
                            to={link.to}
                            className="flex items-center gap-3 px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 dark:text-slate-400 hover:bg-slate-50 dark:bg-slate-800/50 dark:hover:bg-slate-800 hover:text-blue-600 transition italic uppercase tracking-tight"
                            onClick={() => setIsNavOpen(false)}
                          >
                            <link.icon className="w-4 h-4" />
                            {link.label}
                          </Link>
                        ))}
                      </div>

                      <div className="h-px bg-[var(--border-subtle)] my-2" />
                      <button
                        onClick={() => { signOut(); setIsNavOpen(false); }}
                        className="flex items-center gap-3 w-full px-4 py-2 text-xs font-black text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition italic uppercase tracking-tighter"
                      >
                        <LogOut className="w-4 h-4" />
                        Terminate Session
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 flex-grow">
        {/* Hero Security Pulse Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
          <div className="lg:col-span-2 premium-card p-10 relative overflow-hidden group">
            <div className="absolute -right-20 -top-20 w-80 h-80 bg-blue-600/5 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700" />
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-10">
                <div className="p-2.5 bg-blue-600/10 rounded-xl text-blue-600">
                  <Activity className="w-5 h-5" />
                </div>
                <h2 className="text-sm font-black uppercase tracking-widest italic text-slate-900 dark:text-white">Security Intelligence Pulse</h2>
                <div className="ml-auto flex items-center gap-2 px-3 py-1 bg-emerald-500/10 text-emerald-500 rounded-full border border-emerald-500/20">
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-black uppercase tracking-widest italic">+12.5% Optimal</span>
                </div>
              </div>

              <div className="flex flex-col md:flex-row items-center gap-16">
                <div className="relative w-52 h-52 flex items-center justify-center">
                  <svg className="w-full h-full -rotate-90">
                    <circle cx="104" cy="104" r="92" strokeWidth="18" stroke="currentColor" fill="transparent" className="text-slate-100 dark:text-slate-800" />
                    <circle cx="104" cy="104" r="92" strokeWidth="18" stroke="currentColor" fill="transparent" strokeDasharray={578} strokeDashoffset={578 * (1 - 0.82)} className="text-blue-600 drop-shadow-[0_0_8px_rgba(37,99,235,0.4)]" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-6xl font-black tracking-tighter italic text-gray-900 dark:text-white">82</span>
                    <span className="text-[10px] font-black text-gray-500 dark:text-gray-400 dark:text-gray-300 uppercase tracking-widest italic mt-1">Health Score</span>
                  </div>
                </div>

                <div className="flex-1 grid grid-cols-2 gap-6 w-full">
                  {[
                    { label: 'Critical Risks', value: '03', color: 'text-rose-500' },
                    { label: 'Patch Rate', value: '94%', color: 'text-emerald-500' },
                    { label: 'Avg Fix Time', value: '12h', color: 'text-blue-500' },
                    { label: 'Managed Repos', value: '42', color: 'text-slate-900 dark:text-white' },
                  ].map((item) => (
                    <div key={item.label} className="p-5 bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 dark:border-slate-800/50">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic mb-2">{item.label}</div>
                      <div className={`text-3xl font-black italic tracking-tighter ${item.color}`}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="premium-card p-10 bg-gradient-to-br from-blue-700 via-indigo-700 to-indigo-900 text-white relative overflow-hidden group flex flex-col justify-between">
            <div className="absolute -left-10 -bottom-10 w-64 h-64 bg-white/10 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700" />
            <div className="relative z-10">
              <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-md border border-white/20 mb-8">
                <Sparkles className="w-8 h-8" />
              </div>
              <h3 className="text-3xl font-black tracking-tighter uppercase italic leading-[0.9]">AI Agent Intelligence</h3>
              <p className="text-blue-100 text-xs font-bold mt-4 uppercase tracking-widest italic opacity-80 decoration-blue-400 underline underline-offset-4">08 New remediation patches</p>
            </div>
            <Link to="/ai-insights" className="relative z-10 mt-10 px-6 py-4 bg-white dark:bg-slate-900 text-blue-700 rounded-2xl font-black text-[10px] uppercase tracking-widest text-center hover:bg-blue-50 transition-all shadow-xl shadow-blue-950/40 border-b-4 border-slate-200 dark:border-slate-700 active:border-b-0 active:translate-y-1">
              Review Fleet Health
            </Link>
          </div>
        </div>

        {/* Action Center Section */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-1 bg-blue-600 rounded-full" />
            <h2 className="text-xs font-black uppercase tracking-[0.2em] italic text-slate-400">Security Action Center</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              { label: 'Active Tasks', value: stats.total, icon: Filter, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-500/10' },
              { label: 'Pending', value: stats.todo, icon: AlertCircle, color: 'text-slate-600 dark:text-slate-300', bg: 'bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-500/10' },
              { label: 'In Progress', value: stats.inProgress, icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/10' },
              { label: 'Resolved', value: stats.completed, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10' },
            ].map((stat) => (
              <div key={stat.label} className="premium-card p-6 flex items-center justify-between group hover:border-blue-500 transition-colors">
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic mb-2">{stat.label}</p>
                  <p className={`text-4xl font-black tracking-tighter italic ${stat.color}`}>{stat.value}</p>
                </div>
                <div className={`w-14 h-14 ${stat.bg} rounded-2xl flex items-center justify-center ${stat.color} group-hover:scale-110 transition-transform`}>
                  <stat.icon className="w-7 h-7" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Task Management Section */}
        <div className="premium-card overflow-hidden">
          <div className="px-10 py-8 border-b border-[var(--border-subtle)] bg-slate-50/30 dark:bg-slate-900/10">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div>
                <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase italic tracking-tight">Security Tasks</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1 italic">Operations & Remediation</p>
              </div>
              <div className="flex gap-4 w-full md:w-auto">
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as any)}
                  className="px-6 py-3 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl text-[10px] font-black uppercase italic tracking-widest outline-none focus:ring-2 focus:ring-blue-600 transition-all appearance-none pr-10 relative bg-no-repeat bg-[right_1rem_center] bg-[length:1em_1em]"
                >
                  <option value="all">Global Fleet</option>
                  <option value="todo">Pending Stage</option>
                  <option value="in_progress">Active Remediation</option>
                  <option value="completed">Production Ready</option>
                </select>
                <button
                  onClick={() => { setEditingTask(null); setIsModalOpen(true); }}
                  className="btn-premium flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Deploy Task
                </button>
              </div>
            </div>
          </div>

          <div className="divide-y divide-[var(--border-subtle)]">
            {error ? (
              <div className="p-24 text-center">
                <div className="w-20 h-20 bg-rose-50 dark:bg-rose-900/20 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-rose-100 dark:border-rose-800">
                  <AlertCircle className="w-10 h-10 text-rose-500" />
                </div>
                <p className="text-sm font-black text-slate-900 dark:text-white uppercase italic tracking-tight">Connection Error</p>
                <p className="text-[10px] font-bold text-rose-500 uppercase tracking-widest mt-2 italic">{error}</p>
                <button
                  onClick={fetchTasks}
                  className="mt-6 px-6 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-bold text-xs uppercase tracking-widest hover:opacity-90 transition-opacity"
                >
                  Retry Connection
                </button>
              </div>
            ) : filteredTasks.length === 0 ? (
              <div className="p-24 text-center">
                <div className="w-20 h-20 bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-900 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-slate-100 dark:border-slate-800 dark:border-slate-800">
                  <AlertCircle className="w-10 h-10 text-slate-300" />
                </div>
                <p className="text-sm font-black text-slate-900 dark:text-white uppercase italic tracking-tight">Clear Radar</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2 italic">No active security tasks detected in current vector</p>
              </div>
            ) : (
              filteredTasks.map((task) => (
                <div key={task.id} className="p-8 hover:bg-slate-50 dark:bg-slate-800/50 dark:hover:bg-slate-800/30 transition-all group">
                  <div className="flex flex-col md:flex-row items-start justify-between gap-8">
                    <div className="flex items-start gap-6 flex-1">
                      <div className="mt-1.5 p-2 bg-[var(--bg-primary)] rounded-lg shadow-sm">
                        {getStatusIcon(task.status)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-3 mb-3">
                          <h3 className="text-lg font-black text-slate-900 dark:text-white leading-tight italic uppercase tracking-tight">{task.title}</h3>
                          <span className={`px-4 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.15em] italic border ${getPriorityColor(task.priority)}`}>
                            {task.priority} Priority
                          </span>
                        </div>
                        {task.description && (
                          <p className="text-slate-500 dark:text-slate-400 text-xs font-medium leading-relaxed mb-6 max-w-2xl">
                            {task.description}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-4">
                          <select
                            value={task.status}
                            onChange={(e) => updateTaskStatus(task.id, e.target.value as Task['status'])}
                            className="px-4 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg text-[9px] font-black uppercase tracking-widest italic outline-none focus:ring-2 focus:ring-blue-600 transition-all"
                          >
                            <option value="todo">Pending</option>
                            <option value="in_progress">Executing</option>
                            <option value="completed">Verified</option>
                          </select>

                          {(task.repo_url || task.issue_url) && (
                            <div className="flex gap-2">
                              {task.repo_url && (
                                <a href={task.repo_url} target="_blank" rel="noopener noreferrer" className="p-2 bg-slate-900 text-white rounded-lg hover:bg-slate-700 transition-colors shadow-sm">
                                  <Github className="w-3.5 h-3.5" />
                                </a>
                              )}
                              {task.issue_url && (
                                <a href={task.issue_url} target="_blank" rel="noopener noreferrer" className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 dark:text-slate-400 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shadow-sm border border-slate-200 dark:border-slate-700">
                                  <AlertCircle className="w-3.5 h-3.5" />
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex md:flex-col items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => { setEditingTask(task); setIsModalOpen(true); }}
                        className="p-3 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-xl transition-all border border-transparent hover:border-blue-100"
                      >
                        <Edit2 className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => { if (confirm('Erase this task from logs?')) deleteTask(task.id); }}
                        className="p-3 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-xl transition-all border border-transparent hover:border-rose-100"
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
      </main>

      <footer className="bg-[var(--bg-secondary)] border-t border-[var(--border-subtle)] py-12 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-10">
            <div className="flex flex-col items-center md:items-start gap-4">
              <div className="flex items-center gap-2 grayscale opacity-50 contrast-125">
                <Shield className="w-6 h-6 text-blue-600" />
                <span className="text-xl font-black text-slate-900 dark:text-white tracking-widest uppercase italic">StackPilot</span>
              </div>
              <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] italic">
                Advanced Security Orchestration &bull; v1.4.2 PREMIUM
              </p>
            </div>

            <div className="flex flex-col items-center md:items-end gap-6 text-center md:text-right">
              <div className="flex gap-10">
                {['Security', 'Automation', 'Intelligence', 'Fleet'].map(item => (
                  <a key={item} href="#" className="text-[9px] font-black text-slate-400 hover:text-blue-600 uppercase tracking-widest italic transition-colors">
                    {item}
                  </a>
                ))}
              </div>
              <p className="text-sm text-text-secondaryLight dark:text-text-secondaryDark">
                MANIKANT REDDY FROM MANIK
              </p>
            </div>
          </div>
        </div>
      </footer>

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
