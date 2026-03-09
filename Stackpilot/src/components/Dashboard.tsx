import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { databases, DB_ID, COLLECTIONS, Query } from '../lib/appwrite';
import {
  LogOut, Plus, AlertCircle, Edit2, Trash2,
  Github, Settings, ChevronDown, Moon, Sun
} from 'lucide-react';
import TaskModal from './TaskModal';

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<any | null>(null);
  const [filter, setFilter] = useState<'all' | 'todo' | 'in_progress' | 'completed'>('all');
  const [isNavOpen, setIsNavOpen] = useState(false);

  // Security metrics from Appwrite
  const [secMetrics, setSecMetrics] = useState({ critical: 0, high: 0, medium: 0, scans: 0 });

  // Debug connection check + security metrics fetch
  useEffect(() => {
    async function fetchSecurityMetrics() {
      try {
        const [criticalRes, highRes, medRes, scanRes] = await Promise.all([
          databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
            Query.equal('severity', 'critical'),
            Query.equal('resolution_status', 'open'),
            Query.limit(1)
          ]),
          databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
            Query.equal('severity', 'high'),
            Query.equal('resolution_status', 'open'),
            Query.limit(1)
          ]),
          databases.listDocuments(DB_ID, COLLECTIONS.VULNERABILITIES, [
            Query.equal('severity', 'medium'),
            Query.equal('resolution_status', 'open'),
            Query.limit(1)
          ]),
          databases.listDocuments(DB_ID, COLLECTIONS.SCANS, [
            Query.equal('status', 'completed'),
            Query.limit(1)
          ])
        ]);
        setSecMetrics({
          critical: criticalRes.total,
          high: highRes.total,
          medium: medRes.total,
          scans: scanRes.total
        });
        console.log('✅ Appwrite connection works. Total vulnerabilities:', criticalRes.total + highRes.total + medRes.total);
      } catch (e: any) {
        console.error('❌ Appwrite connection failed:', e.message);
      }
    }
    fetchSecurityMetrics();
  }, []);

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    try {
      setError('');
      const response = await databases.listDocuments(
        DB_ID,
        COLLECTIONS.TASKS,
        [Query.orderDesc('$createdAt')]
      );
      setTasks(response.documents);
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
        updated_at: new Date().toISOString()
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

  const filteredTasks = filter === 'all' ? tasks : tasks.filter((task: any) => task.status === filter);

  const stats = {
    total: tasks.length,
    todo: tasks.filter((t: any) => t.status === 'todo').length,
    inProgress: tasks.filter((t: any) => t.status === 'in_progress').length,
    completed: tasks.filter((t: any) => t.status === 'completed').length,
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="logo-mark !w-12 !h-12 !text-xl animate-pulse">SP</div>
          <h2 className="text-xs font-semibold text-text-subtle uppercase tracking-widest animate-pulse">Initializing Pilot...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col transition-colors duration-300">
      <nav className="nav-header">
        <Link to="/" className="nav-logo">
          <div className="logo-mark">SP</div>
          StackPilot
        </Link>
        <ul className="hidden md:flex items-center gap-1 list-none flex-1">
          <li><Link to="/security" className="btn-ghost">Security</Link></li>
          <li><Link to="/ai-insights" className="btn-ghost">AI Engine</Link></li>
          <li><Link to="/teams" className="btn-ghost">Team</Link></li>
          <li><Link to="/reports" className="btn-ghost">Reports</Link></li>
        </ul>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={toggleTheme}
            className="p-2 hover:bg-surface rounded-md transition-colors text-text-muted"
          >
            {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>

          <div className="relative">
            <button
              onClick={() => setIsNavOpen(!isNavOpen)}
              className="flex items-center gap-2 p-1 hover:bg-surface rounded-md transition border border-transparent"
            >
              <div className="w-7 h-7 bg-accent rounded-md flex items-center justify-center text-white font-bold text-[11px]">
                {user?.email?.[0].toUpperCase()}
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-text-subtle transition-transform ${isNavOpen ? 'rotate-180' : ''}`} />
            </button>

            {isNavOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsNavOpen(false)} />
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-border py-2 z-50 animate-fade-up">
                  <div className="px-4 py-2 border-b border-border mb-1 text-[11px] font-medium text-text-muted uppercase tracking-wider">
                    {user?.email}
                  </div>
                  <Link to="/settings" className="flex items-center gap-2 px-4 py-2 text-[13px] text-text-muted hover:text-text hover:bg-surface" onClick={() => setIsNavOpen(false)}>
                    <Settings className="w-4 h-4" /> Settings
                  </Link>
                  <button
                    onClick={() => { signOut(); setIsNavOpen(false); }}
                    className="flex items-center gap-2 w-full px-4 py-2 text-[13px] text-danger hover:bg-danger-light transition"
                  >
                    <LogOut className="w-4 h-4" /> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
          <Link to="/" className="btn-primary h-[34px] !px-4 !py-0 !text-[13.5px]">
            Get started →
          </Link>
        </div>
      </nav>

      <main className="max-w-[1100px] mx-auto px-12 py-20 flex-grow">
        {/* HERO */}
        <div className="text-center mb-16 animate-fade-up">
          <div className="inline-flex items-center gap-2 bg-accent-light text-accent border border-accent-mid px-3 py-1 rounded-full text-[12.5px] font-medium mb-7">
            <div className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
            Security Intelligence Platform
          </div>
          <h1 className="text-[clamp(32px,5vw,52px)] font-normal leading-[1.1] mb-6">
            Security that keeps pace<br /><em className="italic text-accent">with your team</em>
          </h1>
          <p className="text-[17px] text-text-muted max-w-[520px] mx-auto mb-10 leading-relaxed">
            StackPilot automates vulnerability detection, governance enforcement, and AI-driven remediation — continuously, across every repository.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link to="/ai-insights" className="btn-primary px-7 py-3 !text-sm lg:!text-[14px]">Get started with AI →</Link>
            <Link to="/security" className="btn-secondary px-6 py-3 !text-sm lg:!text-[14px]">View Security Health</Link>
          </div>
        </div>

        {/* METRICS GRID */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-px bg-border border border-border rounded-lg overflow-hidden mb-16 animate-fade-up" style={{ animationDelay: '0.1s' }}>
          {[
            { label: 'Health Score', value: Math.max(0, 100 - secMetrics.critical * 25 - secMetrics.high * 10), type: 'success' },
            { label: 'Critical Risks', value: String(secMetrics.critical).padStart(2, '0'), type: 'danger' },
            { label: 'High Risks', value: String(secMetrics.high).padStart(2, '0'), type: 'danger' },
            { label: 'Scans Run', value: String(secMetrics.scans), type: 'neutral' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white p-8">
              <p className="text-[10.5px] font-medium text-text-muted uppercase tracking-wider mb-2">{stat.label}</p>
              <p className={`text-4xl font-semibold tracking-tighter ${stat.type === 'danger' ? 'text-danger' :
                stat.type === 'success' ? 'text-success' : 'text-text'
                }`}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* ACTION CENTER */}
        <div className="mb-16 animate-fade-up" style={{ animationDelay: '0.2s' }}>
          <div className="flex items-center gap-2 mb-6">
            <span className="text-[12px] font-semibold text-accent uppercase tracking-wider">Security Information</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { label: 'Active Tasks', value: stats.total, badge: 'badge-neutral' },
              { label: 'Pending', value: stats.todo, badge: 'badge-warning' },
              { label: 'In Progress', value: stats.inProgress, badge: 'badge-neutral' },
              { label: 'Resolved', value: stats.completed, badge: 'badge-success' },
            ].map((stat) => (
              <div key={stat.label} className="card group">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[11px] font-medium text-text-muted uppercase tracking-wider">{stat.label}</p>
                  <span className={`badge ${stat.badge}`}>Live</span>
                </div>
                <p className="text-3xl font-semibold tracking-tighter text-text">{stat.value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* TASK MANAGEMENT */}
        <div className="card !p-0 overflow-hidden animate-fade-up" style={{ animationDelay: '0.3s' }}>
          <div className="px-8 py-6 border-b border-border flex justify-between items-center bg-surface/50">
            <div>
              <h2 className="text-[16px] font-semibold tracking-tight">Security Task Inventory</h2>
              <p className="text-[11px] text-text-muted font-medium uppercase tracking-wider mt-0.5">Fleet Operations & Compliance</p>
            </div>
            <div className="flex gap-2">
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as any)}
                className="px-3 py-1.5 bg-white border border-border rounded-md text-[12px] font-medium outline-none focus:border-accent transition-colors"
              >
                <option value="all">All Channels</option>
                <option value="todo">Pending</option>
                <option value="in_progress">Executing</option>
                <option value="completed">Verified</option>
              </select>
              <button
                onClick={() => { setEditingTask(null); setIsModalOpen(true); }}
                className="btn-primary !py-1.5 !px-4 !text-[13px]"
              >
                <Plus className="w-4 h-4" /> Deploy Task
              </button>
            </div>
          </div>

          <div className="divide-y divide-border">
            {error ? (
              <div className="p-16 text-center">
                <AlertCircle className="w-10 h-10 text-danger mx-auto mb-4" />
                <p className="text-[15px] font-semibold mb-1">Fleet Connection Failure</p>
                <p className="text-[13px] text-text-muted mb-6">{error}</p>
                <button onClick={fetchTasks} className="btn-secondary mx-auto">Retry Deployment</button>
              </div>
            ) : filteredTasks.length === 0 ? (
              <div className="p-16 text-center">
                <p className="text-[13px] text-text-muted font-medium italic">No security tasks detected in the current vector.</p>
              </div>
            ) : (
              filteredTasks.map((task) => (
                <div key={task.id} className="p-6 hover:bg-surface/30 transition-all group">
                  <div className="flex items-start justify-between gap-6">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-[15px] font-medium text-text group-hover:text-accent transition-colors">{task.title}</h3>
                        <span className={`badge ${(task as any).priority === 'high' ? 'badge-danger' :
                          (task as any).priority === 'medium' ? 'badge-warning' : 'badge-success'
                          }`}>
                          {task.priority}
                        </span>
                      </div>
                      <p className="text-[13px] text-text-muted leading-relaxed mb-4 max-w-2xl line-clamp-2">
                        {task.description || 'No additional intelligence provided for this operation.'}
                      </p>
                      <div className="flex items-center gap-4">
                        <select
                          value={task.status}
                          onChange={(e) => updateTaskStatus(task.$id, e.target.value as any)}
                          className="px-2 py-1 bg-surface border border-border rounded text-[11px] font-medium outline-none"
                        >
                          <option value="todo">Pending</option>
                          <option value="in_progress">Executing</option>
                          <option value="completed">Verified</option>
                        </select>
                        {(task.repo_url || task.issue_url) && (
                          <div className="flex gap-2">
                            {task.repo_url && (
                              <a href={task.repo_url} target="_blank" rel="noopener noreferrer" className="text-text-muted hover:text-text transition-colors">
                                <Github className="w-4 h-4" />
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => { setEditingTask(task); setIsModalOpen(true); }}
                        className="p-2 text-text-muted hover:text-accent hover:bg-accent-light rounded transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => { if (confirm('Purge this task from intelligence?')) deleteTask(task.$id); }}
                        className="p-2 text-text-muted hover:text-danger hover:bg-danger-light rounded transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-border py-12 bg-white mt-20">
        <div className="max-w-[1100px] mx-auto px-12 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-3">
            <div className="logo-mark !w-6 !h-6 !text-[11px]">SP</div>
            <span className="text-[14px] font-semibold text-text">StackPilot</span>
            <span className="text-border mx-2">·</span>
            <span className="text-[12px] text-text-subtle font-medium">DevSecOps Intelligence Engine</span>
          </div>
          <div className="flex items-center gap-8">
            <span className="text-[12px] text-text-subtle">© 2025 StackPilot. All rights reserved.</span>
            <span className="text-[12px] text-text-subtle font-medium italic">v1.4.2 Enterprise</span>
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
