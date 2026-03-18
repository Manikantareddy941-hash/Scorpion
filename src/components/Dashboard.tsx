import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import {
  LogOut, Plus, CheckCircle2, Clock, AlertCircle, Edit2, Trash2,
  Github, Shield, Settings, ChevronDown, Activity, Users,
  BarChart3, Sun, Moon, Bug, Wind, BarChart, Copy, Target, Flame, Eye, Snowflake
} from 'lucide-react';
import { Theme } from '../contexts/ThemeContext';

import TaskModal from './TaskModal';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from 'recharts';
import logoImg from '../assets/scorpionlegs-removebg-preview.png';

const defaultThreatData = [
  { axis: 'Vulnerabilities', Observed: 60, Expected: 90 },
  { axis: 'Bugs', Observed: 45, Expected: 80 },
  { axis: 'Security Issues', Observed: 70, Expected: 85 },
  { axis: 'Code Smells', Observed: 55, Expected: 75 },
  { axis: 'Coverage', Observed: 80, Expected: 90 },
  { axis: 'Duplications', Observed: 40, Expected: 70 },
];

const threatData = [
  { axis: 'Vulnerabilities', Observed: 85, Expected: 90 },
  { axis: 'Bugs', Observed: 60, Expected: 80 },
  { axis: 'Security', Observed: 70, Expected: 85 },
  { axis: 'Code Smells', Observed: 50, Expected: 85 },
  { axis: 'Coverage', Observed: 75, Expected: 80 },
  { axis: 'Duplications', Observed: 65, Expected: 70 },
];

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const { theme, setTheme, getLogoFilter } = useTheme();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any | null>(null);
  const [filter, setFilter] = useState<'all' | 'todo' | 'in_progress' | 'completed'>('all');
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [isThemeOpen, setIsThemeOpen] = useState(false);

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
          <img src={logoImg} alt="Scorpion Logo" className="w-16 h-16 object-contain animate-pulse" style={{ filter: getLogoFilter(), mixBlendMode: 'multiply' }} />
          <h2 className="text-xs font-black text-[var(--text-secondary)] uppercase tracking-widest animate-pulse italic">Initializing Scorpion Protocols...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col transition-colors duration-300">
      <nav className="bg-[var(--bg-primary)] backdrop-blur-md shadow-sm border-b border-[var(--border-subtle)] sticky top-0 z-40 text-[var(--text-primary)]">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
            </div>

            <div className="flex items-center gap-4">
              <div className="relative">
                <button
                  onClick={() => setIsThemeOpen(!isThemeOpen)}
                  className="p-2 hover:bg-white/5 rounded-xl transition-all text-[var(--text-secondary)] border border-transparent hover:border-[var(--border-subtle)] flex items-center gap-2"
                >
                  {theme === 'light' && <Sun className="w-5 h-5" />}
                  {theme === 'dark' && <Moon className="w-5 h-5" />}
                  {theme === 'eye-protection' && <Eye className="w-5 h-5" />}
                  {(theme === 'snow-light' || theme === 'snow-dark') && <Snowflake className="w-5 h-5" />}
                  <ChevronDown className={`w-3 h-3 transition-transform ${isThemeOpen ? 'rotate-180' : ''}`} />
                </button>

                {isThemeOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsThemeOpen(false)} />
                    <div className="absolute right-0 mt-2 w-48 bg-[var(--bg-card)] rounded-2xl shadow-2xl border border-[var(--border-subtle)] py-2 z-50 animate-in fade-in zoom-in duration-200">
                      {[
                        { id: 'light', label: 'Light Mode', icon: Sun },
                        { id: 'dark', label: 'Dark Mode', icon: Moon },
                        { id: 'eye-protection', label: 'Eye Protection', icon: Eye },
                        { id: 'snow-light', label: 'Snow Light', icon: Snowflake },
                        { id: 'snow-dark', label: 'Snow Dark', icon: Snowflake },
                      ].map((t) => (
                        <button
                          key={t.id}
                          onClick={() => { setTheme(t.id as Theme); setIsThemeOpen(false); }}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest italic transition-colors
                            ${theme === t.id ? 'text-[var(--accent-primary)] bg-[var(--accent-primary)]/5' : 'text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--text-primary)]'}`}
                        >
                          <t.icon className="w-4 h-4" />
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="relative">
                <button
                  onClick={() => setIsNavOpen(!isNavOpen)}
                  className="flex items-center gap-3 p-1.5 hover:bg-white/5 rounded-xl transition border border-transparent hover:border-[#1E1E1E]"
                >
                  <div onClick={(e) => { e.stopPropagation(); navigate('/profile'); }} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'inherit' }}>
                    <div className="text-right hidden sm:block">
                      <p className="text-xs font-bold text-[var(--text-primary)] leading-none mb-1">
                        {user?.email?.split('@')[0]}
                      </p>
                      <p className="text-[9px] text-[var(--text-secondary)] font-bold uppercase tracking-widest leading-none italic">
                        Security Lead
                      </p>
                    </div>
                    <div className="w-8 h-8 bg-[var(--accent-primary)] rounded-lg flex items-center justify-center text-white font-black text-xs shadow-lg shadow-[var(--accent-primary)]/20">
                      {user?.email?.[0].toUpperCase()}
                    </div>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${isNavOpen ? 'rotate-180' : ''}`} />
                </button>

                {isNavOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsNavOpen(false)} />
                    <div className="absolute right-0 mt-2 w-64 bg-[var(--bg-secondary)] rounded-2xl shadow-2xl border border-[var(--border-subtle)] py-3 z-50 animate-in fade-in zoom-in duration-200">
                      <div className="px-4 py-3 border-b border-[var(--border-subtle)] mb-2">
                        <p className="text-[10px] font-black text-[var(--text-secondary)] uppercase tracking-widest italic mb-1">Signed in as</p>
                        <p className="text-xs font-bold text-[var(--text-primary)] truncate">{user?.email}</p>
                      </div>

                      <div className="space-y-1">
                        {[
                          { to: '/security', icon: Shield, label: 'Security Dashboard' },

                          { to: '/reports', icon: BarChart3, label: 'Reports & Export' },
                          { to: '/teams', icon: Users, label: 'Team Members' },
                          { to: '/settings', icon: Settings, label: 'Global Settings' },
                        ].map((link) => (
                          <Link
                            key={link.to}
                            to={link.to}
                            className="flex items-center gap-3 px-4 py-2 text-xs font-bold text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--text-primary)] transition italic uppercase tracking-tight"
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
                        className="flex items-center gap-3 w-full px-4 py-2 text-xs font-black text-[var(--status-error)] hover:bg-[var(--status-error)]/5 transition italic uppercase tracking-tighter"
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

      <main className="w-full mx-auto px-4 sm:px-6 lg:px-8 py-10 flex-grow overflow-x-hidden">
        {/* Security Intelligence Pulse Section - Horizontal Rectangular Design */}
        <div className="mb-12 w-full">
          <div className="p-6 relative overflow-hidden group w-full min-h-[400px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '24px' }}>
            <div className="absolute -right-20 -top-20 w-64 h-64 bg-[var(--accent-primary)]/5 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700" />
            
            <div className="relative z-10 flex flex-col h-full">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 bg-[var(--accent-primary)]/10 rounded-xl text-[var(--accent-primary)]">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xs font-black uppercase tracking-widest italic text-[var(--text-primary)]">Security Pulse</h2>
                  <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-0.5">Real-time Vector Analysis</p>
                </div>
                <div className="ml-auto flex items-center gap-1.5 px-3 py-1 bg-[var(--status-success)]/10 text-[var(--status-success)] rounded-full border border-[var(--status-success)]/20">
                  <div className="w-1 h-1 bg-[var(--status-success)] rounded-full animate-pulse" />
                  <span className="text-[9px] font-black uppercase tracking-widest italic">+12%</span>
                </div>
              </div>

              <div className="flex flex-col lg:flex-row gap-6 w-full min-h-[350px]">
                {/* LEFT: Radar Chart */}
                <div className="w-full lg:w-4/12 min-h-[500px] bg-black/5 dark:bg-white/5 rounded-2xl border border-[var(--border-subtle)] overflow-hidden shadow-inner flex items-center justify-center relative z-20 p-4">
                  <ResponsiveContainer width="100%" height={500}>
                    <RadarChart cx="50%" cy="50%" outerRadius="70%" data={(!threatData || threatData.length === 0 || threatData.every(d => d.Observed === 0)) ? defaultThreatData : threatData}>
                      <PolarGrid 
                        gridType="polygon" 
                        stroke="var(--text-secondary)" 
                        strokeOpacity={0.8} 
                        strokeWidth={1}
                      />
                      <PolarAngleAxis 
                        dataKey="axis" 
                        tick={{ 
                          fill: 'var(--text-primary)', 
                          fontSize: 10, 
                          fontWeight: 900,
                          textAnchor: 'middle' 
                        }} 
                      />
                      <PolarRadiusAxis 
                        angle={30} 
                        domain={[0, 100]} 
                        axisLine={true}
                        stroke="var(--border-subtle)"
                        strokeOpacity={0.5}
                        tick={false} 
                      />
                      
                      {/* Manual Radius Labels - Positioned to the side */}
                      {[
                        { r: 25, label: 'Minimum' },
                        { r: 50, label: 'Modest' },
                        { r: 75, label: 'Large' },
                        { r: 100, label: 'Maximum' }
                      ].map((ring) => (
                        <text
                          key={ring.label}
                          x="55%"
                          y={`${50 - (ring.r * 0.35)}%`} // Offset calculation
                          textAnchor="start"
                          fill="var(--text-secondary)"
                          fontSize="7"
                          fontWeight="900"
                          className="uppercase tracking-[0.2em] opacity-60"
                        >
                          {ring.label}
                        </text>
                      ))}

                      <Tooltip 
                        contentStyle={{ 
                          background: 'var(--bg-card)', 
                          border: '1px solid var(--accent-primary)', 
                          borderRadius: '12px', 
                          color: 'var(--text-primary)', 
                          fontSize: '9px', 
                          textTransform: 'uppercase', 
                          fontWeight: 'bold' 
                        }}
                        itemStyle={{ color: 'var(--accent-primary)' }}
                      />
                      <Radar
                        name="Observed"
                        dataKey="Observed"
                        stroke="var(--accent-primary)"
                        strokeWidth={2}
                        fill="var(--accent-primary)"
                        fillOpacity={0.4}
                        dot={{ r: 4, fill: 'var(--accent-primary)', fillOpacity: 1, strokeWidth: 2, stroke: 'var(--bg-card)' }}
                      />
                      <Radar
                        name="Expected"
                        dataKey="Expected"
                        stroke="var(--text-secondary)"
                        strokeWidth={1}
                        fill="var(--text-secondary)"
                        fillOpacity={0.05}
                        strokeDasharray="4 4"
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                {/* RIGHT: Metric Grid */}
                 <div className="w-full lg:w-8/12 grid grid-cols-2 lg:grid-cols-4 gap-4 min-h-[400px]">
                {[
                  { label: 'Bugs', value: '14', status: 'REQUIRES REVIEW', color: 'text-[var(--status-warning)]', icon: Bug },
                  { label: 'Code Smells', value: '08', status: 'WITHIN LIMITS', color: 'text-[var(--status-success)]', icon: Wind },
                  { label: 'Vulnerabilities', value: '03', status: 'CRITICAL', color: 'text-[var(--status-error)]', icon: Shield },
                  { label: 'Security Issues', value: '02', status: 'CRITICAL', color: 'text-[var(--status-error)]', icon: AlertCircle },
                  { label: 'Coverage', value: '78%', status: 'OPTIMAL PATH', color: 'text-[var(--accent-primary)]', icon: BarChart },
                  { label: 'Duplications', value: '1.2%', status: 'WITHIN LIMITS', color: 'text-[var(--accent-secondary)]', icon: Copy },
                  { label: 'Avg Risk Score', value: '24%', status: 'SECURE', color: 'text-[var(--status-warning)]', icon: Target },
                  { label: 'Active Threats', value: '05', status: 'LIVE FEED', color: 'text-[var(--status-error)]', icon: Flame },
                ].map((item) => (
                  <div 
                    key={item.label} 
                    className="p-5 relative group/card border border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/40 transition-all duration-300 min-h-[140px] flex flex-col justify-between overflow-hidden premium-card" 
                  >
                    <div className="flex justify-between items-start mb-2">
                       <div className="text-[11px] font-black text-[var(--text-secondary)] uppercase tracking-wider italic">{item.label}</div>
                       <item.icon className={`w-4 h-4 ${item.color} opacity-60 group-hover/card:scale-110 transition-transform`} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="text-3xl font-black italic tracking-tighter text-[var(--text-primary)] leading-none">{item.value}</div>
                      <div className={`text-[9px] font-black uppercase tracking-widest italic ${item.color}`}>{item.status}</div>
                    </div>
                    <div className="w-full h-1 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden mt-4">
                      <div 
                        className={`h-full bg-[var(--accent-primary)]`} 
                        style={{ width: `${Math.random() * 60 + 20}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

        {/* Action Center Section */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-1.5 bg-[var(--accent-primary)] rounded-full" />
            <h2 className="text-sm font-black uppercase tracking-[0.3em] italic text-[var(--text-primary)]">Security Action Center</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              { label: 'Active Tasks', value: stats.total },
              { label: 'Pending', value: stats.todo },
              { label: 'In Progress', value: stats.inProgress },
              { label: 'Resolved', value: stats.completed },
            ].map((stat) => (
              <div key={stat.label} className="p-6 flex items-center justify-between group hover:border-[var(--accent-primary)] transition-colors" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '12px' }}>
                <div>
                  <p className="text-[10px] font-black text-[var(--text-primary)] uppercase tracking-widest italic mb-2">{stat.label}</p>
                  <p className={`text-4xl font-black tracking-tighter italic text-[var(--accent-primary)]`}>{stat.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Task Management Section */}
        <div className="overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '12px' }}>
          <div className="px-10 py-8 border-b border-[var(--border-subtle)] bg-white/5 dark:bg-white/10">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div>
                <h2 className="text-xl font-black text-[var(--text-primary)] uppercase italic tracking-tight">Security Tasks</h2>
                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-1 italic">Operations & Remediation</p>
              </div>
              <div className="flex gap-4 w-full md:w-auto">
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as any)}
                  className="px-6 py-3 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl text-[10px] font-black text-[var(--text-primary)] uppercase italic tracking-widest outline-none focus:ring-2 focus:ring-[var(--accent-primary)] transition-all appearance-none pr-10 relative bg-no-repeat bg-[right_1rem_center] bg-[length:1em_1em]"
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
                <div className="w-20 h-20 bg-[var(--status-error)]/10 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-[var(--status-error)]/20">
                  <AlertCircle className="w-10 h-10 text-[var(--status-error)]" />
                </div>
                <p className="text-sm font-black text-[var(--text-primary)] uppercase italic tracking-tight">Connection Error</p>
                <p className="text-[10px] font-bold text-[var(--status-error)] uppercase tracking-widest mt-2 italic">{error}</p>
                <button
                  onClick={fetchTasks}
                  className="mt-6 px-6 py-2 bg-[var(--accent-primary)] text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:opacity-90 transition-opacity"
                >
                  Retry Connection
                </button>
              </div>
            ) : filteredTasks.length === 0 ? (
              <div className="p-24 text-center">
                <div className="w-20 h-20 bg-[var(--bg-secondary)] rounded-3xl flex items-center justify-center mx-auto mb-6 border border-[var(--border-subtle)]">
                  <AlertCircle className="w-10 h-10 text-[var(--text-secondary)]" />
                </div>
                <p className="text-sm font-black text-[var(--text-primary)] uppercase italic tracking-tight">Clear Radar</p>
                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest mt-2 italic">No active security tasks detected in current vector</p>
              </div>
            ) : (
              filteredTasks.map((task) => (
                <div key={task.$id} className="p-8 bg-[var(--bg-card)] hover:bg-white/5 transition-all group border-b border-[var(--border-subtle)]">
                  <div className="flex flex-col md:flex-row items-start justify-between gap-8">
                    <div className="flex items-start gap-6 flex-1">
                      <div className="mt-1.5 p-2 bg-[var(--bg-primary)] rounded-lg shadow-sm border border-[var(--border-subtle)]">
                        {getStatusIcon(task.status)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-3 mb-3">
                          <h3 className="text-lg font-black text-[var(--text-primary)] leading-tight italic uppercase tracking-tight">{task.title}</h3>
                          <span className={`px-4 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.15em] italic border ${getPriorityColor(task.priority)}`}>
                            {task.priority} Priority
                          </span>
                        </div>
                        {task.description && (
                          <p className="text-[var(--text-secondary)] text-xs font-medium leading-relaxed mb-6 max-w-2xl">
                            {task.description}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-4">
                          <select
                            value={task.status}
                            onChange={(e) => updateTaskStatus(task.$id, e.target.value)}
                            className="px-4 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg text-[9px] font-black text-[var(--text-primary)] uppercase tracking-widest italic outline-none focus:ring-2 focus:ring-[var(--accent-primary)] transition-all"
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
                                <a href={task.issue_url} target="_blank" rel="noopener noreferrer" className="p-2 bg-[var(--bg-secondary)] text-[var(--text-secondary)] rounded-lg hover:text-[var(--text-primary)] transition-colors shadow-sm border border-[var(--border-subtle)]">
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
                        className="p-3 text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/10 rounded-xl transition-all border border-transparent hover:border-[var(--border-subtle)]"
                      >
                        <Edit2 className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => { if (confirm('Erase this task from logs?')) deleteTask(task.$id); }}
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
      </main>



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
