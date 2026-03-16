import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import {
  LogOut, Plus, CheckCircle2, Clock, AlertCircle, Edit2, Trash2,
  Github, Shield, Settings, ChevronDown, Activity, Users,
  BarChart3, Sparkles, Sun, Moon, ArrowUpRight
} from 'lucide-react';

import TaskModal from './TaskModal';
import ScorpionIcon from './ScorpionIcon';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend } from 'recharts';

const threatData = [
  { axis: 'Authentication', Observed: 85, Expected: 90, Residual: 40 },
  { axis: 'Network Access', Observed: 60, Expected: 80, Residual: 55 },
  { axis: 'Defense Evasion', Observed: 70, Expected: 75, Residual: 45 },
  { axis: 'Data Exfiltration', Observed: 50, Expected: 85, Residual: 60 },
  { axis: 'Asset Exposure', Observed: 75, Expected: 80, Residual: 35 },
  { axis: 'Privilege Use', Observed: 65, Expected: 70, Residual: 50 },
];

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any | null>(null);
  const [filter, setFilter] = useState<'all' | 'todo' | 'in_progress' | 'completed'>('all');
  const [isNavOpen, setIsNavOpen] = useState(false);

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
      case 'high': return 'text-[#E8440A] bg-[#E8440A]/10 border-[#E8440A]/20';
      case 'medium': return 'text-white bg-[#E8440A]/10 border-[#1E1E1E]';
      case 'low': return 'text-[#666666] bg-[#1E1E1E] border-[#1E1E1E]';
      default: return 'text-[#666666] bg-[#1E1E1E] border-[#1E1E1E]';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-5 h-5 text-[#E8440A]" />;
      case 'in_progress': return <Clock className="w-5 h-5 text-white" />;
      default: return <AlertCircle className="w-5 h-5 text-[#666666]" />;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0D0D0D] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <ScorpionIcon size={64} color="#E8440A" />
          <h2 className="text-xs font-black text-[#666666] uppercase tracking-widest animate-pulse italic">Initializing Scorpion Protocols...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0D0D0D] flex flex-col transition-colors duration-300">
      <nav className="bg-[#0D0D0D] backdrop-blur-md shadow-sm border-b border-[var(--border-subtle)] sticky top-0 z-40 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              {/* Branding removed from top navbar as it is in Sidebar */}
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={toggleTheme}
                className="p-2 hover:bg-white/5 dark:hover:bg-slate-800 rounded-xl transition-all text-[#666666] dark:text-[#666666] border border-transparent hover:border-[var(--border-subtle)]"
              >
                {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
              </button>

              <div className="relative">
                <button
                  onClick={() => setIsNavOpen(!isNavOpen)}
                  className="flex items-center gap-3 p-1.5 hover:bg-white/5 rounded-xl transition border border-transparent hover:border-[#1E1E1E]"
                >
                  <div onClick={(e) => { e.stopPropagation(); navigate('/profile'); }} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'inherit' }}>
                    <div className="text-right hidden sm:block">
                      <p className="text-xs font-bold text-gray-900 dark:text-white leading-none mb-1">
                        {user?.email?.split('@')[0]}
                      </p>
                      <p className="text-[9px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest leading-none italic">
                        Security Lead
                      </p>
                    </div>
                    <div className="w-8 h-8 bg-[#E8440A] rounded-lg flex items-center justify-center text-white font-black text-xs shadow-lg shadow-[#E8440A]/20">
                      {user?.email?.[0].toUpperCase()}
                    </div>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-[#666666] transition-transform ${isNavOpen ? 'rotate-180' : ''}`} />
                </button>

                {isNavOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsNavOpen(false)} />
                    <div className="absolute right-0 mt-2 w-64 bg-[var(--bg-secondary)] rounded-2xl shadow-2xl border border-[var(--border-subtle)] py-3 z-50 animate-in fade-in zoom-in duration-200">
                      <div className="px-4 py-3 border-b border-[var(--border-subtle)] mb-2">
                        <p className="text-[10px] font-black text-[#666666] uppercase tracking-widest italic mb-1">Signed in as</p>
                        <p className="text-xs font-bold text-white dark:text-white truncate">{user?.email}</p>
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
                            className="flex items-center gap-3 px-4 py-2 text-xs font-bold text-[#666666] hover:bg-white/5 hover:text-white transition italic uppercase tracking-tight"
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
        <div className="grid grid-cols-1 gap-8 mb-12">
          <div className="p-10 relative overflow-hidden group" style={{ background: '#141414', border: '1px solid #1E1E1E', borderRadius: '12px' }}>
            <div className="absolute -right-20 -top-20 w-80 h-80 bg-blue-600/5 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700" />
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-10">
                <div className="p-2.5 bg-[#E8440A]/10 rounded-xl text-[#E8440A]">
                  <Activity className="w-5 h-5" />
                </div>
                <h2 className="text-sm font-black uppercase tracking-widest italic text-white dark:text-white">Security Intelligence Pulse</h2>
                <div className="ml-auto flex items-center gap-2 px-3 py-1 bg-emerald-500/10 text-emerald-500 rounded-full border border-emerald-500/20">
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-black uppercase tracking-widest italic">+12.5% Optimal</span>
                </div>
              </div>

              <div className="flex flex-col md:flex-row items-center gap-16">
                <div className="relative w-full h-[350px] flex items-center justify-center">
                  <ResponsiveContainer width="100%" height={350}>
                    <RadarChart data={threatData}>
                      <PolarGrid stroke="#1E1E1E" />
                      <PolarAngleAxis dataKey="axis" tick={{ fill: '#666666', fontSize: 11 }} />
                      <PolarRadiusAxis stroke="#1E1E1E" tick={{ fill: '#444' }} />
                      <Radar name="Observed" dataKey="Observed" stroke="#E8440A" fill="#E8440A" fillOpacity={0.2} />
                      <Radar name="Expected" dataKey="Expected" stroke="#666666" fill="#666666" fillOpacity={0.1} />
                      <Radar name="Residual Risk" dataKey="Residual" stroke="#ff2200" fill="#ff2200" fillOpacity={0.15} />
                      <Legend wrapperStyle={{ color: '#666' }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-6 w-full">
                  {[
                    { label: 'Critical Risks', value: '03', color: 'text-[#E8440A]' },
                    { label: 'Patch Rate', value: '94%', color: 'text-[#E8440A]' },
                    { label: 'Avg Fix Time', value: '12h', color: 'text-[#E8440A]' },
                    { label: 'Managed Repos', value: '42', color: 'text-white' },
                  ].map((item) => (
                    <div key={item.label} className="p-5" style={{ background: '#141414', border: '1px solid #1E1E1E', borderRadius: '12px' }}>
                      <div className="text-[10px] font-black text-[#666666] uppercase tracking-widest italic mb-2">{item.label}</div>
                      <div className={`text-3xl font-black italic tracking-tighter ${item.color}`}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="p-10 relative overflow-hidden group flex flex-col justify-between" style={{ background: '#141414', border: '1px solid #1E1E1E', borderRadius: '12px' }}>
            <div className="absolute -left-10 -bottom-10 w-64 h-64 bg-[#E8440A]/5 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700" />
            <div className="relative z-10">
              <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center backdrop-blur-md border border-white/10 mb-8">
                <Sparkles className="w-8 h-8 text-[#E8440A]" />
              </div>
              <h3 className="text-3xl font-black tracking-tighter uppercase italic leading-[0.9] text-white">AI Agent Intelligence</h3>
              <p className="text-[#E8440A] text-xs font-bold mt-4 uppercase tracking-widest italic opacity-80 decoration-[#E8440A] underline underline-offset-4">08 New remediation patches</p>
            </div>
            <Link to="/ai-insights" className="relative z-10 mt-10 px-6 py-4 bg-[#E8440A] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest text-center hover:opacity-90 transition-all shadow-xl shadow-black/40 border-b-4 border-[#ae3207] active:border-b-0 active:translate-y-1">
              Review Fleet Health
            </Link>
          </div>
        </div>

        {/* Action Center Section */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-1 bg-[#E8440A] rounded-full" />
            <h2 className="text-xs font-black uppercase tracking-[0.2em] italic text-[#666666]">Security Action Center</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              { label: 'Active Tasks', value: stats.total, color: 'text-[#E8440A]' },
              { label: 'Pending', value: stats.todo, color: 'text-[#E8440A]' },
              { label: 'In Progress', value: stats.inProgress, color: 'text-[#E8440A]' },
              { label: 'Resolved', value: stats.completed, color: 'text-[#E8440A]' },
            ].map((stat) => (
              <div key={stat.label} className="p-6 flex items-center justify-between group hover:border-[#E8440A] transition-colors" style={{ background: '#141414', border: '1px solid #1E1E1E', borderRadius: '12px' }}>
                <div>
                  <p className="text-[10px] font-black text-white uppercase tracking-widest italic mb-2">{stat.label}</p>
                  <p className={`text-4xl font-black tracking-tighter italic ${stat.color}`}>{stat.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Task Management Section */}
        <div className="overflow-hidden" style={{ background: '#141414', border: '1px solid #1E1E1E', borderRadius: '12px' }}>
          <div className="px-10 py-8 border-b border-[var(--border-subtle)] bg-white/5 dark:bg-white/10">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div>
                <h2 className="text-xl font-black text-white uppercase italic tracking-tight">Security Tasks</h2>
                <p className="text-[10px] font-bold text-[#666666] uppercase tracking-widest mt-1 italic">Operations & Remediation</p>
              </div>
              <div className="flex gap-4 w-full md:w-auto">
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as any)}
                  className="px-6 py-3 bg-[#141414] border border-[#1E1E1E] rounded-xl text-[10px] font-black text-white uppercase italic tracking-widest outline-none focus:ring-2 focus:ring-[#E8440A] transition-all appearance-none pr-10 relative bg-no-repeat bg-[right_1rem_center] bg-[length:1em_1em]"
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
                <p className="text-sm font-black text-white dark:text-white uppercase italic tracking-tight">Connection Error</p>
                <p className="text-[10px] font-bold text-rose-500 uppercase tracking-widest mt-2 italic">{error}</p>
                <button
                  onClick={fetchTasks}
                  className="mt-6 px-6 py-2 bg-white dark:bg-white text-white dark:text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:opacity-90 transition-opacity"
                >
                  Retry Connection
                </button>
              </div>
            ) : filteredTasks.length === 0 ? (
              <div className="p-24 text-center">
                <div className="w-20 h-20 bg-slate-50 dark:bg-slate-800/50 dark:bg-white rounded-3xl flex items-center justify-center mx-auto mb-6 border border-[#1E1E1E] dark:border-slate-800 dark:border-slate-800">
                  <AlertCircle className="w-10 h-10 text-slate-300" />
                </div>
                <p className="text-sm font-black text-white dark:text-white uppercase italic tracking-tight">Clear Radar</p>
                <p className="text-[10px] font-bold text-[#666666] uppercase tracking-widest mt-2 italic">No active security tasks detected in current vector</p>
              </div>
            ) : (
              filteredTasks.map((task) => (
                <div key={task.$id} className="p-8 bg-[#141414] hover:bg-white/5 transition-all group border-b border-[#1E1E1E]">
                  <div className="flex flex-col md:flex-row items-start justify-between gap-8">
                    <div className="flex items-start gap-6 flex-1">
                      <div className="mt-1.5 p-2 bg-[#0D0D0D] rounded-lg shadow-sm border border-[#1E1E1E]">
                        {getStatusIcon(task.status)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-3 mb-3">
                          <h3 className="text-lg font-black text-white leading-tight italic uppercase tracking-tight">{task.title}</h3>
                          <span className={`px-4 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.15em] italic border ${getPriorityColor(task.priority)}`}>
                            {task.priority} Priority
                          </span>
                        </div>
                        {task.description && (
                          <p className="text-[#666666] text-xs font-medium leading-relaxed mb-6 max-w-2xl">
                            {task.description}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-4">
                          <select
                            value={task.status}
                            onChange={(e) => updateTaskStatus(task.$id, e.target.value)}
                            className="px-4 py-1.5 bg-[#0D0D0D] border border-[#1E1E1E] rounded-lg text-[9px] font-black text-white uppercase tracking-widest italic outline-none focus:ring-2 focus:ring-[#E8440A] transition-all"
                          >
                            <option value="todo">Pending</option>
                            <option value="in_progress">Executing</option>
                            <option value="completed">Verified</option>
                          </select>

                          {(task.repo_url || task.issue_url) && (
                            <div className="flex gap-2">
                              {task.repo_url && (
                                <a href={task.repo_url} target="_blank" rel="noopener noreferrer" className="p-2 bg-white text-white rounded-lg hover:bg-slate-700 transition-colors shadow-sm">
                                  <Github className="w-3.5 h-3.5" />
                                </a>
                              )}
                              {task.issue_url && (
                                <a href={task.issue_url} target="_blank" rel="noopener noreferrer" className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 dark:text-[#666666] rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shadow-sm border border-[#1E1E1E] dark:border-slate-700">
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
                        className="p-3 text-[#666666] hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-xl transition-all border border-transparent hover:border-blue-100"
                      >
                        <Edit2 className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => { if (confirm('Erase this task from logs?')) deleteTask(task.$id); }}
                        className="p-3 text-[#666666] hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-xl transition-all border border-transparent hover:border-rose-100"
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
              <div className="flex items-center gap-2">
                <ScorpionIcon size={24} color="#E8440A" />
                <span className="text-xl font-black text-white tracking-widest uppercase italic">SCORPION</span>
              </div>
              <p className="text-[10px] text-[#666666] font-black uppercase tracking-[0.2em] italic">
                Advanced Security Orchestration &bull; v1.4.2 PREMIUM
              </p>
            </div>

            <div className="flex flex-col items-center md:items-end gap-6 text-center md:text-right">
              <div className="flex gap-10">
                {['Security', 'Automation', 'Intelligence', 'Fleet'].map(item => (
                  <a key={item} href="#" className="text-[9px] font-black text-[#666666] hover:text-[#E8440A] uppercase tracking-widest italic transition-colors">
                    {item}
                  </a>
                ))}
              </div>
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
