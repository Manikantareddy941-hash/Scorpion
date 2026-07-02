import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  Plus, Trash2, Calendar, Clock, Shield, Sparkles, Settings, BarChart2,
  LayoutGrid, CheckCircle2, ChevronRight, X, AlertTriangle, Play, Check,
  Edit3, ArrowRight, User, Tag, Zap, RefreshCw, Layers, ListTodo, MoreVertical,
  ChevronDown, HelpCircle, FileText
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import toast from 'react-hot-toast';

// Types matched to Backend Schema
interface Project {
  $id: string;
  name: string;
  repoId: string;
  type: 'kanban' | 'scrum';
  createdAt: string;
}

interface Epic {
  $id: string;
  projectId: string;
  title: string;
  color: string;
  startDate?: string;
  endDate?: string;
  status: string;
}

interface Sprint {
  $id: string;
  projectId: string;
  name: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
  status: 'planned' | 'active' | 'completed';
}

interface Issue {
  $id: string;
  projectId: string;
  epicId?: string | null;
  sprintId?: string | null;
  type: 'epic' | 'story' | 'task' | 'bug' | 'subtask';
  title: string;
  description?: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'backlog' | 'todo' | 'inprogress' | 'inreview' | 'done';
  assignee?: string;
  storyPoints?: number;
  timeEstimate?: number;
  timeLogged?: number;
  vulnId?: string | null;
  labels?: string[];
  dueDate?: string;
  createdAt: string;
}

interface Comment {
  $id: string;
  issueId: string;
  author: string;
  body: string;
  createdAt: string;
}

interface AutomationRule {
  $id: string;
  projectId: string;
  trigger: string;
  conditions?: string;
  action: string;
}

interface Vulnerability {
  $id: string;
  title: string;
  severity: string;
  repo_name: string;
}

interface Threat {
  $id: string;
  projectId: string;
  title: string;
  strideCategory: 'Spoofing' | 'Tampering' | 'Repudiation' | 'Information Disclosure' | 'Denial of Service' | 'Elevation of Privilege';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description?: string;
  mitigation?: string;
  status: 'identified' | 'mitigated' | 'accepted';
  issueId?: string;
}

export default function PlanWorkspace() {
  const { getJWT } = useAuth();
  const [activeTab, setActiveTab] = useState<'board' | 'backlog' | 'threats' | 'timeline' | 'reports' | 'dashboard' | 'settings'>('board');

  // DB States
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjId, setSelectedProjId] = useState<string>('');
  const [epics, setEpics] = useState<Epic[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>([]);
  const [vulnerabilities, setVulnerabilities] = useState<Vulnerability[]>([]);
  const [threats, setThreats] = useState<Threat[]>([]);

  // UI States
  const [loading, setLoading] = useState(true);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newCommentBody, setNewCommentBody] = useState('');
  const [commentLoading, setCommentLoading] = useState(false);
  const [createThreatOpen, setCreateThreatOpen] = useState(false);
  const [aiThreatLoading, setAiThreatLoading] = useState(false);

  // New Threat Form States
  const [newThreatTitle, setNewThreatTitle] = useState('');
  const [newThreatStride, setNewThreatStride] = useState<'Spoofing' | 'Tampering' | 'Repudiation' | 'Information Disclosure' | 'Denial of Service' | 'Elevation of Privilege'>('Spoofing');
  const [newThreatSeverity, setNewThreatSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [newThreatDesc, setNewThreatDesc] = useState('');
  const [newThreatMitigation, setNewThreatMitigation] = useState('');

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterEpic, setFilterEpic] = useState('all');

  // Modal / Form Creators
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [newProjType, setNewProjType] = useState<'kanban' | 'scrum'>('scrum');

  const [createSprintOpen, setCreateSprintOpen] = useState(false);
  const [newSprintName, setNewSprintName] = useState('');
  const [newSprintGoal, setNewSprintGoal] = useState('');

  const [createEpicOpen, setCreateEpicOpen] = useState(false);
  const [newEpicTitle, setNewEpicTitle] = useState('');
  const [newEpicColor, setNewEpicColor] = useState('#3b82f6');

  const [createIssueOpen, setCreateIssueOpen] = useState(false);
  const [newIssueTitle, setNewIssueTitle] = useState('');
  const [newIssueType, setNewIssueType] = useState<Issue['type']>('task');
  const [newIssuePriority, setNewIssuePriority] = useState<Issue['priority']>('medium');
  const [newIssuePoints, setNewIssuePoints] = useState(1);
  const [newIssueDesc, setNewIssueDesc] = useState('');
  const [newIssueVulnId, setNewIssueVulnId] = useState('');

  const [ruleTrigger, setRuleTrigger] = useState('vuln_resolved');
  const [ruleAction, setRuleAction] = useState('auto_create_task');

  // Initial Load
  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    if (selectedProjId) {
      fetchProjectData(selectedProjId);
    }
  }, [selectedProjId]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const token = await getJWT();
      const headers = { 'Authorization': `Bearer ${token}` };

      // Load Projects
      const resProj = await fetch('/api/plan/projects', { headers });
      if (resProj.ok) {
        const projs = await resProj.json();
        setProjects(projs);
        if (projs.length > 0) {
          setSelectedProjId(projs[0].$id);
        }
      }

      // Load Vulnerabilities for linking
      const resVulns = await fetch('/api/plan/vulnerabilities', { headers });
      if (resVulns.ok) {
        setVulnerabilities(await resVulns.json());
      }
    } catch (err) {
      console.error('Fetch initial plan data failed:', err);
      toast.error('Failed to connect to plan engine');
    } finally {
      setLoading(false);
    }
  };

  const fetchProjectData = async (projId: string) => {
    try {
      const token = await getJWT();
      const headers = { 'Authorization': `Bearer ${token}` };

      // Fetch Epics
      const resEpics = await fetch(`/api/plan/projects/${projId}/epics`, { headers });
      if (resEpics.ok) setEpics(await resEpics.json());

      // Fetch Sprints
      const resSprints = await fetch(`/api/plan/projects/${projId}/sprints`, { headers });
      if (resSprints.ok) setSprints(await resSprints.json());

      // Fetch Issues
      const resIssues = await fetch(`/api/plan/projects/${projId}/issues`, { headers });
      if (resIssues.ok) setIssues(await resIssues.json());

      // Fetch Rules
      const resRules = await fetch(`/api/plan/projects/${projId}/automation-rules`, { headers });
      if (resRules.ok) setAutomationRules(await resRules.json());

      // Fetch Threats
      const resThreats = await fetch(`/api/plan/projects/${projId}/threats`, { headers });
      if (resThreats.ok) setThreats(await resThreats.json());
    } catch (err) {
      console.error('Error fetching project detail data:', err);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjName) return;
    try {
      const token = await getJWT();
      const res = await fetch('/api/plan/projects', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjName, type: newProjType })
      });
      if (res.ok) {
        const proj = await res.json();
        setProjects(prev => [proj, ...prev]);
        setSelectedProjId(proj.$id);
        setNewProjName('');
        setCreateProjectOpen(false);
        toast.success('Project created successfully');
      }
    } catch (err) {
      toast.error('Failed to create project');
    }
  };

  const handleCreateSprint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSprintName) return;
    try {
      const token = await getJWT();
      const res = await fetch(`/api/plan/projects/${selectedProjId}/sprints`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newSprintName, goal: newSprintGoal })
      });
      if (res.ok) {
        const sprint = await res.json();
        setSprints(prev => [...prev, sprint]);
        setNewSprintName('');
        setNewSprintGoal('');
        setCreateSprintOpen(false);
        toast.success('Sprint created successfully');
      }
    } catch (err) {
      toast.error('Failed to create sprint');
    }
  };

  const handleCreateEpic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEpicTitle) return;
    try {
      const token = await getJWT();
      const res = await fetch(`/api/plan/projects/${selectedProjId}/epics`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newEpicTitle, color: newEpicColor })
      });
      if (res.ok) {
        const epic = await res.json();
        setEpics(prev => [...prev, epic]);
        setNewEpicTitle('');
        setCreateEpicOpen(false);
        toast.success('Epic created successfully');
      }
    } catch (err) {
      toast.error('Failed to create epic');
    }
  };

  const handleCreateIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIssueTitle) return;
    try {
      const token = await getJWT();
      const res = await fetch(`/api/plan/projects/${selectedProjId}/issues`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newIssueTitle,
          type: newIssueType,
          priority: newIssuePriority,
          storyPoints: newIssuePoints,
          description: newIssueDesc,
          vulnId: newIssueVulnId || null
        })
      });
      if (res.ok) {
        const issue = await res.json();
        setIssues(prev => [issue, ...prev]);
        setNewIssueTitle('');
        setNewIssuePoints(1);
        setNewIssueDesc('');
        setNewIssueVulnId('');
        setCreateIssueOpen(false);
        toast.success('Issue created');
      }
    } catch (err) {
      toast.error('Failed to create issue');
    }
  };

  const handleUpdateIssue = async (issueId: string, updates: Partial<Issue>) => {
    try {
      const token = await getJWT();
      const res = await fetch(`/api/plan/issues/${issueId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        const updated = await res.json();
        setIssues(prev => prev.map(i => i.$id === issueId ? updated : i));
        if (selectedIssue && selectedIssue.$id === issueId) {
          setSelectedIssue(updated);
        }
      }
    } catch (err) {
      toast.error('Failed to update issue');
    }
  };

  const handleDeleteIssue = async (issueId: string) => {
    if (!window.confirm('Delete this issue permanently?')) return;
    try {
      const token = await getJWT();
      const res = await fetch(`/api/plan/issues/${issueId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setIssues(prev => prev.filter(i => i.$id !== issueId));
        setSelectedIssue(null);
        toast.success('Issue deleted');
      }
    } catch (err) {
      toast.error('Failed to delete issue');
    }
  };

  const handleUpdateSprintStatus = async (sprintId: string, updates: Partial<Sprint>) => {
    try {
      const token = await getJWT();
      const res = await fetch(`/api/plan/sprints/${sprintId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        const updated = await res.json();
        setSprints(prev => prev.map(s => s.$id === sprintId ? updated : s));
        if (updates.status === 'completed') {
          // Refresh issues since completed sprint tasks roll to backlog
          fetchProjectData(selectedProjId);
        }
        toast.success(`Sprint updated to ${updates.status}`);
      }
    } catch (err) {
      toast.error('Failed to update sprint');
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = await getJWT();
      const res = await fetch(`/api/plan/projects/${selectedProjId}/automation-rules`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: ruleTrigger, action: ruleAction })
      });
      if (res.ok) {
        const rule = await res.json();
        setAutomationRules(prev => [...prev, rule]);
        toast.success('Automation rule registered');
      }
    } catch (err) {
      toast.error('Failed to create rule');
    }
  };

  const handleImportVulnerability = async (vuln: Vulnerability) => {
    try {
      const token = await getJWT();
      const res = await fetch(`/api/plan/projects/${selectedProjId}/issues`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `[Remediation] Fix ${vuln.title}`,
          type: 'bug',
          priority: vuln.severity.toLowerCase() === 'critical' ? 'critical' :
                    vuln.severity.toLowerCase() === 'high' ? 'high' :
                    vuln.severity.toLowerCase() === 'medium' ? 'medium' : 'low',
          storyPoints: 5,
          description: `Imported from Scorpion scanner. Repository: ${vuln.repo_name}`,
          vulnId: vuln.$id
        })
      });
      if (res.ok) {
        const issue = await res.json();
        setIssues(prev => [issue, ...prev]);
        toast.success('Vulnerability imported to Plan');
      }
    } catch (err) {
      toast.error('Failed to import vulnerability');
    }
  };

  const handleCreateThreat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newThreatTitle) return;
    try {
      const token = await getJWT();
      const res = await fetch(`/api/plan/projects/${selectedProjId}/threats`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newThreatTitle,
          strideCategory: newThreatStride,
          severity: newThreatSeverity,
          description: newThreatDesc,
          mitigation: newThreatMitigation
        })
      });
      if (res.ok) {
        const threat = await res.json();
        setThreats(prev => [...prev, threat]);
        setNewThreatTitle('');
        setNewThreatDesc('');
        setNewThreatMitigation('');
        setCreateThreatOpen(false);
        toast.success('Threat identified and logged');
      }
    } catch (err) {
      toast.error('Failed to log threat');
    }
  };

  const handleUpdateThreat = async (threatId: string, updates: Partial<Threat>) => {
    try {
      const token = await getJWT();
      const res = await fetch(`/api/plan/projects/${selectedProjId}/threats/${threatId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        const updated = await res.json();
        setThreats(prev => prev.map(t => t.$id === threatId ? updated : t));
      }
    } catch (err) {
      toast.error('Failed to update threat');
    }
  };

  const handleDeleteThreat = async (threatId: string) => {
    if (!window.confirm('Delete this threat assessment?')) return;
    try {
      const token = await getJWT();
      const res = await fetch(`/api/plan/projects/${selectedProjId}/threats/${threatId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setThreats(prev => prev.filter(t => t.$id !== threatId));
        toast.success('Threat deleted');
      }
    } catch (err) {
      toast.error('Failed to delete threat');
    }
  };

  const handleConvertThreat = async (threat: Threat) => {
    try {
      const token = await getJWT();
      const res = await fetch(`/api/plan/projects/${selectedProjId}/threats/${threat.$id}/convert`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const updated = await res.json();
        setThreats(prev => prev.map(t => t.$id === threat.$id ? updated : t));
        // Refresh issues list
        const resIssues = await fetch(`/api/plan/projects/${selectedProjId}/issues`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (resIssues.ok) setIssues(await resIssues.json());
        toast.success('Threat converted to project ticket');
      }
    } catch (err) {
      toast.error('Failed to convert threat');
    }
  };

  const handleAiGenerateThreats = async () => {
    if (!selectedProjId) return;
    const architecture = window.prompt(
      'List your system components (one per line) — the AI runs STRIDE against each:',
      'React frontend\nExpress API\nPostgres database\nThird-party payment API'
    );
    if (architecture === null) return; // cancelled
    setAiThreatLoading(true);
    try {
      const token = await getJWT();
      const res = await fetch(`/api/plan/projects/${selectedProjId}/threats/ai-generate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ architecture })
      });
      if (res.ok) {
        const generated: Threat[] = await res.json();
        setThreats(prev => [...prev, ...generated]);
        toast.success(`AI identified ${generated.length} threat${generated.length === 1 ? '' : 's'}`);
      } else {
        toast.error('AI threat generation failed');
      }
    } catch (err) {
      toast.error('AI threat generation failed');
    } finally {
      setAiThreatLoading(false);
    }
  };

  // Comments Fetch & Create
  const fetchComments = async (issueId: string) => {
    setCommentLoading(true);
    try {
      const token = await getJWT();
      const res = await fetch(`/api/plan/issues/${issueId}/comments`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setComments(await res.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCommentLoading(false);
    }
  };

  const handleCreateComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentBody || !selectedIssue) return;
    try {
      const token = await getJWT();
      const res = await fetch(`/api/plan/issues/${selectedIssue.$id}/comments`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: newCommentBody })
      });
      if (res.ok) {
        const comm = await res.json();
        setComments(prev => [...prev, comm]);
        setNewCommentBody('');
      }
    } catch (err) {
      toast.error('Failed to post comment');
    }
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, issueId: string) => {
    e.dataTransfer.setData('text/plain', issueId);
  };

  const handleDrop = async (e: React.DragEvent, newStatus: Issue['status']) => {
    e.preventDefault();
    const issueId = e.dataTransfer.getData('text/plain');
    if (issueId) {
      await handleUpdateIssue(issueId, { status: newStatus });
    }
  };

  // Filters application
  const currentProject = projects.find(p => p.$id === selectedProjId);
  const activeSprint = sprints.find(s => s.status === 'active');

  const filteredIssues = issues.filter(iss => {
    if (searchQuery && !iss.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filterAssignee !== 'all' && iss.assignee !== filterAssignee) return false;
    if (filterPriority !== 'all' && iss.priority !== filterPriority) return false;
    if (filterEpic !== 'all' && iss.epicId !== filterEpic) return false;
    return true;
  });

  // Real burndown for the active sprint: the "ideal" line is a genuine linear
  // interpolation from total points to zero across the sprint's real dates;
  // "actual" is the one real data point we have - today's remaining points.
  // There's no daily history stored, so no fabricated multi-day curve is drawn.
  const burndownData = (() => {
    if (!activeSprint?.startDate || !activeSprint?.endDate) return [];
    const sprintIssues = issues.filter(i => i.sprintId === activeSprint.$id);
    const totalPoints = sprintIssues.reduce((acc, i) => acc + (i.storyPoints || 0), 0);
    const remainingPoints = sprintIssues
      .filter(i => i.status !== 'done')
      .reduce((acc, i) => acc + (i.storyPoints || 0), 0);

    const start = new Date(activeSprint.startDate);
    const end = new Date(activeSprint.endDate);
    const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
    const elapsedDays = Math.min(totalDays, Math.max(0, Math.round((Date.now() - start.getTime()) / 86400000)));

    const points: { day: string; ideal: number; actual?: number }[] = [];
    for (let d = 0; d <= totalDays; d++) {
      const date = new Date(start.getTime() + d * 86400000);
      const point: { day: string; ideal: number; actual?: number } = {
        day: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        ideal: Math.max(0, Math.round(totalPoints - (totalPoints / totalDays) * d)),
      };
      if (d === elapsedDays) point.actual = remainingPoints;
      points.push(point);
    }
    return points;
  })();

  // Real velocity per sprint: committed vs. completed story points, aggregated
  // directly from the actual issues assigned to each sprint.
  const velocityData = sprints.map(s => {
    const sprintIssues = issues.filter(i => i.sprintId === s.$id);
    const committed = sprintIssues.reduce((acc, i) => acc + (i.storyPoints || 0), 0);
    const completed = sprintIssues
      .filter(i => i.status === 'done')
      .reduce((acc, i) => acc + (i.storyPoints || 0), 0);
    return { sprint: s.name, committed, completed };
  });

  // Real bug closure cohorts: bugs grouped by the week they were created,
  // split into closed vs. still-open based on their current status.
  const closureVelocityData = (() => {
    const bugs = issues.filter(i => i.type === 'bug');
    const weeks: Record<string, { closed: number; open: number; sortKey: number }> = {};
    bugs.forEach(i => {
      const created = new Date(i.createdAt);
      if (Number.isNaN(created.getTime())) return;
      const weekStart = new Date(created);
      weekStart.setDate(created.getDate() - created.getDay());
      const label = weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      if (!weeks[label]) weeks[label] = { closed: 0, open: 0, sortKey: weekStart.getTime() };
      if (i.status === 'done') weeks[label].closed++;
      else weeks[label].open++;
    });
    return Object.entries(weeks)
      .sort((a, b) => a[1].sortKey - b[1].sortKey)
      .map(([date, v]) => ({ date, closed: v.closed, open: v.open }));
  })();

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <RefreshCw className="w-12 h-12 text-[var(--accent-primary)] animate-spin mb-4" />
        <p className="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] italic">
          Initializing PLAN Workspace...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header Bar */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-[var(--border-subtle)] pb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter flex items-center gap-2">
                <Layers className="text-[var(--accent-primary)] w-8 h-8" />
                Plan Workspace
              </h1>
              {currentProject && (
                <span className="px-3 py-1 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/20 rounded-full text-[10px] font-black uppercase italic tracking-widest">
                  {currentProject.type} Mode
                </span>
              )}
            </div>
            <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.15em] italic font-mono">
              Scorpion Agile Security Orchestration Console
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {/* Project Select */}
            <div className="relative">
              <select
                value={selectedProjId}
                onChange={e => setSelectedProjId(e.target.value)}
                className="appearance-none bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 pr-10 text-xs font-black italic uppercase text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50 cursor-pointer"
              >
                {projects.map(p => (
                  <option key={p.$id} value={p.$id}>{p.name.toUpperCase()}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)] pointer-events-none" />
            </div>

            <button
              onClick={() => setCreateProjectOpen(true)}
              className="btn-premium flex items-center gap-2 px-4 py-2.5 text-[10px]"
            >
              <Plus size={14} />
              <span>New Project</span>
            </button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-[var(--border-subtle)] pb-px overflow-x-auto gap-2">
          {[
            { id: 'board', label: 'Active Board', icon: LayoutGrid },
            { id: 'backlog', label: 'Backlog & Sprints', icon: ListTodo },
            { id: 'threats', label: 'Threat Model', icon: Shield },
            { id: 'timeline', label: 'Roadmap & Timeline', icon: Calendar },
            { id: 'reports', label: 'Agile Reports', icon: BarChart2 },
            { id: 'dashboard', label: 'Project Dashboard', icon: Shield },
            { id: 'settings', label: 'Automation & Rules', icon: Settings }
          ].map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-5 py-3 border-b-2 text-xs font-black uppercase tracking-wider italic transition-all shrink-0 ${
                  active
                    ? 'border-[var(--accent-primary)] text-[var(--text-primary)] bg-[var(--accent-primary)]/5 rounded-t-xl'
                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]/30'
                }`}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* ── BOARD TAB ── */}
        {activeTab === 'board' && (
          <div className="space-y-6">
            {/* Filter controls */}
            <div className="premium-card p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3 flex-grow">
                <div className="relative w-full max-w-xs">
                  <input
                    type="text"
                    placeholder="Search issues..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
                  />
                </div>

                <select
                  value={filterAssignee}
                  onChange={e => setFilterAssignee(e.target.value)}
                  className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[10px] font-black italic uppercase text-[var(--text-primary)] outline-none"
                >
                  <option value="all">All Assignees</option>
                  <option value="dev@scorpion.local">dev@scorpion.local</option>
                  <option value="Tony AI">Tony AI</option>
                </select>

                <select
                  value={filterPriority}
                  onChange={e => setFilterPriority(e.target.value)}
                  className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[10px] font-black italic uppercase text-[var(--text-primary)] outline-none"
                >
                  <option value="all">All Priorities</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>

              <button
                onClick={() => setCreateIssueOpen(true)}
                className="btn-premium flex items-center gap-2 py-2 px-4"
              >
                <Plus size={14} />
                Create Issue
              </button>
            </div>

            {/* Kanban Columns */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {(['backlog', 'todo', 'inprogress', 'inreview', 'done'] as const).map(colStatus => {
                // In Scrum mode, board only displays issues belonging to the active sprint (except backlog status)
                const columnIssues = filteredIssues.filter(iss => {
                  if (iss.status !== colStatus) return false;
                  if (currentProject?.type === 'scrum') {
                    if (colStatus === 'backlog') return !iss.sprintId;
                    return iss.sprintId === activeSprint?.$id;
                  }
                  return true;
                });

                const statusLabels: Record<string, string> = {
                  backlog: 'Backlog',
                  todo: 'To Do',
                  inprogress: 'In Progress',
                  inreview: 'In Review',
                  done: 'Done'
                };

                const columnColors: Record<string, string> = {
                  backlog: 'border-t-gray-500 bg-gray-500/5',
                  todo: 'border-t-blue-500 bg-blue-500/5',
                  inprogress: 'border-t-yellow-500 bg-yellow-500/5',
                  inreview: 'border-t-purple-500 bg-purple-500/5',
                  done: 'border-t-green-500 bg-green-500/5'
                };

                return (
                  <div
                    key={colStatus}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => handleDrop(e, colStatus)}
                    className={`rounded-2xl border border-[var(--border-subtle)] p-4 min-h-[500px] flex flex-col gap-3 border-t-4 ${columnColors[colStatus]}`}
                  >
                    <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]">
                      <span className="text-[10px] font-black uppercase italic tracking-widest text-[var(--text-primary)]">
                        {statusLabels[colStatus]}
                      </span>
                      <span className="bg-[var(--bg-secondary)] text-[9px] font-black italic px-2 py-0.5 rounded-full border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                        {columnIssues.length}
                      </span>
                    </div>

                    <div className="flex-1 flex flex-col gap-3 overflow-y-auto max-h-[600px] pr-1">
                      {columnIssues.map(issue => {
                        const epic = epics.find(e => e.$id === issue.epicId);
                        const priorityColors = {
                          critical: 'text-red-500 border-red-500/20 bg-red-500/5',
                          high: 'text-orange-500 border-orange-500/20 bg-orange-500/5',
                          medium: 'text-yellow-500 border-yellow-500/20 bg-yellow-500/5',
                          low: 'text-green-500 border-green-500/20 bg-green-500/5'
                        };

                        const issueTypeBadges = {
                          epic: 'border-purple-500/30 text-purple-400 bg-purple-500/5',
                          story: 'border-blue-500/30 text-blue-400 bg-blue-500/5',
                          task: 'border-gray-500/30 text-gray-400 bg-gray-500/5',
                          bug: 'border-red-500/30 text-red-400 bg-red-500/5',
                          subtask: 'border-teal-500/30 text-teal-400 bg-teal-500/5'
                        };

                        return (
                          <div
                            key={issue.$id}
                            draggable
                            onDragStart={e => handleDragStart(e, issue.$id)}
                            onClick={() => {
                              setSelectedIssue(issue);
                              fetchComments(issue.$id);
                            }}
                            className="premium-card p-4 hover:border-[var(--accent-primary)]/60 cursor-pointer flex flex-col gap-2.5 transition-all duration-200"
                          >
                            <div className="flex items-center justify-between gap-1.5 flex-wrap">
                              <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border tracking-wider italic ${issueTypeBadges[issue.type]}`}>
                                {issue.type}
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border tracking-wider italic ${priorityColors[issue.priority]}`}>
                                {issue.priority}
                              </span>
                            </div>

                            <h4 className="text-[11px] font-black uppercase italic leading-tight text-[var(--text-primary)]">
                              {issue.title}
                            </h4>

                            {epic && (
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="w-2 h-2 rounded-full"
                                  style={{ backgroundColor: epic.color }}
                                />
                                <span className="text-[8px] font-bold text-[var(--text-secondary)] uppercase tracking-wider truncate">
                                  {epic.title}
                                </span>
                              </div>
                            )}

                            <div className="flex items-center justify-between pt-2 border-t border-[var(--border-subtle)] mt-1">
                              <div className="flex items-center gap-1 text-[var(--text-secondary)]">
                                <User size={10} />
                                <span className="text-[8px] font-bold truncate max-w-[80px]">
                                  {issue.assignee?.split('@')[0]}
                                </span>
                              </div>

                              {issue.storyPoints !== undefined && (
                                <span className="w-5 h-5 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] flex items-center justify-center text-[9px] font-mono font-bold text-[var(--text-primary)]">
                                  {issue.storyPoints}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {columnIssues.length === 0 && (
                        <div className="flex flex-col items-center justify-center p-8 border border-dashed border-[var(--border-subtle)] rounded-2xl text-center opacity-40">
                          <CheckCircle2 size={24} className="mb-2" />
                          <span className="text-[9px] font-black uppercase italic">Column Empty</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── BACKLOG & SPRINTS TAB ── */}
        {activeTab === 'backlog' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left side Sprints and Backlog: Col-8 */}
            <div className="lg:col-span-9 space-y-6">

              {/* Sprints Group */}
              {currentProject?.type === 'scrum' && (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-sm font-black uppercase italic tracking-wider text-[var(--text-primary)]">
                      Sprints
                    </h3>
                    <button
                      onClick={() => setCreateSprintOpen(true)}
                      className="btn-premium flex items-center gap-2 py-1.5 px-4 text-[9px]"
                    >
                      <Plus size={12} /> Create Sprint
                    </button>
                  </div>

                  {sprints.map(sprint => {
                    const sprintIssues = issues.filter(i => i.sprintId === sprint.$id);
                    const totalPoints = sprintIssues.reduce((acc, curr) => acc + (curr.storyPoints || 0), 0);
                    const completedPoints = sprintIssues
                      .filter(i => i.status === 'done')
                      .reduce((acc, curr) => acc + (curr.storyPoints || 0), 0);

                    return (
                      <div
                        key={sprint.$id}
                        onDragOver={e => e.preventDefault()}
                        onDrop={async e => {
                          e.preventDefault();
                          const issueId = e.dataTransfer.getData('text/plain');
                          if (issueId) {
                            await handleUpdateIssue(issueId, { sprintId: sprint.$id });
                          }
                        }}
                        className="premium-card p-5 border-l-4 border-l-[var(--accent-primary)] space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
                          <div>
                            <div className="flex items-center gap-2.5">
                              <h4 className="text-xs font-black uppercase italic text-[var(--text-primary)]">
                                {sprint.name}
                              </h4>
                              <span className={`px-2 py-0.5 text-[8px] font-black uppercase border rounded italic tracking-wider ${
                                sprint.status === 'active'
                                  ? 'bg-green-500/10 text-green-500 border-green-500/20 animate-pulse'
                                  : sprint.status === 'completed'
                                    ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                                    : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
                              }`}>
                                {sprint.status}
                              </span>
                            </div>
                            {sprint.goal && (
                              <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic mt-1 font-mono">
                                Goal: {sprint.goal}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <span className="text-[9px] font-black uppercase italic text-[var(--text-secondary)] block">
                                Story Points
                              </span>
                              <span className="text-xs font-mono font-bold text-[var(--text-primary)]">
                                {completedPoints} / {totalPoints} SP
                              </span>
                            </div>

                            {sprint.status === 'planned' && (
                              <button
                                onClick={() => handleUpdateSprintStatus(sprint.$id, { status: 'active' })}
                                className="px-3 py-1.5 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 text-green-500 text-[9px] font-black uppercase tracking-wider rounded-lg italic flex items-center gap-1 cursor-pointer"
                              >
                                <Play size={10} /> Start
                              </button>
                            )}

                            {sprint.status === 'active' && (
                              <button
                                onClick={() => handleUpdateSprintStatus(sprint.$id, { status: 'completed' })}
                                className="px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 text-[9px] font-black uppercase tracking-wider rounded-lg italic flex items-center gap-1 cursor-pointer"
                              >
                                <Check size={10} /> Complete
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Sprint Issues List */}
                        <div className="space-y-2">
                          {sprintIssues.map(issue => (
                            <div
                              key={issue.$id}
                              draggable
                              onDragStart={e => handleDragStart(e, issue.$id)}
                              onClick={() => {
                                setSelectedIssue(issue);
                                fetchComments(issue.$id);
                              }}
                              className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/50 rounded-xl p-3 flex items-center justify-between gap-4 cursor-pointer transition-all duration-200"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border tracking-wider italic shrink-0 ${
                                  issue.type === 'bug' ? 'bg-red-500/10 text-red-500 border-red-500/20' : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                                }`}>
                                  {issue.type}
                                </span>
                                <h5 className="text-[10px] font-black uppercase italic text-[var(--text-primary)] truncate">
                                  {issue.title}
                                </h5>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase italic ${
                                  issue.status === 'done' ? 'text-green-500 bg-green-500/10' : 'text-yellow-500 bg-yellow-500/10'
                                }`}>
                                  {issue.status}
                                </span>
                                <span className="px-2 py-0.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded text-[9px] font-mono text-[var(--text-secondary)]">
                                  {issue.storyPoints || 0} SP
                                </span>
                              </div>
                            </div>
                          ))}

                          {sprintIssues.length === 0 && (
                            <div className="text-center py-6 text-[9px] uppercase italic text-[var(--text-secondary)] opacity-50">
                              Drag issues here to assign to sprint
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Master Backlog */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-black uppercase italic tracking-wider text-[var(--text-primary)]">
                    Project Backlog
                  </h3>
                  <button
                    onClick={() => setCreateIssueOpen(true)}
                    className="btn-premium flex items-center gap-2 py-1.5 px-4 text-[9px]"
                  >
                    <Plus size={12} /> Create Task
                  </button>
                </div>

                <div
                  onDragOver={e => e.preventDefault()}
                  onDrop={async e => {
                    e.preventDefault();
                    const issueId = e.dataTransfer.getData('text/plain');
                    if (issueId) {
                      await handleUpdateIssue(issueId, { sprintId: null });
                    }
                  }}
                  className="premium-card p-5 space-y-3 min-h-[300px]"
                >
                  {/* Filter unassigned issues (backlog) */}
                  {issues.filter(i => !i.sprintId).length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center opacity-40">
                      <ListTodo size={36} className="mb-2" />
                      <span className="text-[10px] font-black uppercase italic">Backlog is Empty</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {issues.filter(i => !i.sprintId).map(issue => (
                        <div
                          key={issue.$id}
                          draggable
                          onDragStart={e => handleDragStart(e, issue.$id)}
                          onClick={() => {
                            setSelectedIssue(issue);
                            fetchComments(issue.$id);
                          }}
                          className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/50 rounded-xl p-3 flex items-center justify-between gap-4 cursor-pointer transition-all duration-200"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="w-1.5 h-6 rounded bg-gray-600" />
                            <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border tracking-wider italic shrink-0 ${
                              issue.type === 'bug' ? 'bg-red-500/10 text-red-500 border-red-500/20' : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                            }`}>
                              {issue.type}
                            </span>
                            <h5 className="text-[10px] font-black uppercase italic text-[var(--text-primary)] truncate">
                              {issue.title}
                            </h5>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border tracking-wider italic ${
                              issue.priority === 'critical' ? 'text-red-500 border-red-500/20 bg-red-500/5' :
                              issue.priority === 'high' ? 'text-orange-500 border-orange-500/20' : 'text-gray-400 border-gray-500/10'
                            }`}>
                              {issue.priority}
                            </span>
                            <span className="px-2 py-0.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded text-[9px] font-mono text-[var(--text-secondary)]">
                              {issue.storyPoints || 0} SP
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right side Epics & Linked Vulns: Col-3 */}
            <div className="lg:col-span-3 space-y-6">
              {/* Epics Panel */}
              <div className="premium-card p-4 space-y-4">
                <div className="flex justify-between items-center border-b border-[var(--border-subtle)] pb-2">
                  <span className="text-[10px] font-black uppercase italic tracking-widest text-[var(--text-primary)]">
                    Epics
                  </span>
                  <button
                    onClick={() => setCreateEpicOpen(true)}
                    className="p-1 hover:text-[var(--accent-primary)] transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                </div>

                <div className="space-y-3">
                  {epics.map(epic => {
                    const epicIssues = issues.filter(i => i.epicId === epic.$id);
                    const total = epicIssues.length;
                    const done = epicIssues.filter(i => i.status === 'done').length;
                    const percent = total > 0 ? Math.round((done / total) * 100) : 0;

                    return (
                      <div key={epic.$id} className="space-y-1">
                        <div className="flex items-center justify-between text-[9px] font-black uppercase italic">
                          <span className="flex items-center gap-1.5 text-[var(--text-primary)]">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: epic.color }} />
                            {epic.title}
                          </span>
                          <span className="text-[var(--text-secondary)]">{percent}%</span>
                        </div>
                        {/* Progress Bar */}
                        <div className="w-full h-1.5 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{ width: `${percent}%`, backgroundColor: epic.color }}
                          />
                        </div>
                      </div>
                    );
                  })}

                  {epics.length === 0 && (
                    <div className="text-center py-4 text-[9px] uppercase italic text-[var(--text-secondary)] opacity-50">
                      No epics defined.
                    </div>
                  )}
                </div>
              </div>

              {/* Vulnerabilities Ingestion panel */}
              <div className="premium-card p-4 space-y-4">
                <div className="border-b border-[var(--border-subtle)] pb-2">
                  <span className="text-[10px] font-black uppercase italic tracking-widest text-[var(--text-primary)]">
                    Vulnerabilities Ingestion
                  </span>
                  <p className="text-[8px] font-bold text-[var(--text-secondary)] uppercase mt-0.5 tracking-wider font-mono">
                    Import scan findings to backlog
                  </p>
                </div>

                <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                  {vulnerabilities.filter(v => !issues.some(i => i.vulnId === v.$id)).map(vuln => (
                    <div
                      key={vuln.$id}
                      className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] p-2.5 rounded-xl space-y-2"
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase italic border ${
                          vuln.severity.toLowerCase() === 'critical' || vuln.severity.toLowerCase() === 'high'
                            ? 'text-red-500 border-red-500/20 bg-red-500/5'
                            : 'text-yellow-500 border-yellow-500/20'
                        }`}>
                          {vuln.severity}
                        </span>
                        <span className="text-[8px] font-bold text-[var(--text-secondary)] truncate max-w-[100px]">
                          {vuln.repo_name}
                        </span>
                      </div>
                      <h6 className="text-[9px] font-bold uppercase italic text-[var(--text-primary)] leading-tight line-clamp-2">
                        {vuln.title}
                      </h6>
                      <button
                        onClick={() => handleImportVulnerability(vuln)}
                        className="w-full py-1 bg-[var(--accent-primary)]/10 hover:bg-[var(--accent-primary)]/20 border border-[var(--accent-primary)]/30 text-[var(--accent-primary)] text-[8px] font-black uppercase italic rounded-md flex items-center justify-center gap-1 transition-all cursor-pointer"
                      >
                        <ArrowRight size={10} /> Send to Plan
                      </button>
                    </div>
                  ))}

                  {vulnerabilities.filter(v => !issues.some(i => i.vulnId === v.$id)).length === 0 && (
                    <div className="text-center py-6 text-[9px] uppercase italic text-[var(--text-secondary)] opacity-50">
                      All scanned vulnerabilities are currently linked.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── THREAT MODEL TAB ── */}
        {activeTab === 'threats' && (
          <div className="space-y-6">
            <div className="premium-card p-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-black uppercase italic tracking-wider text-[var(--text-primary)]">
                  Project Threat Model (STRIDE)
                </h3>
                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase mt-0.5 tracking-wider font-mono">
                  Identify design-time security flaws and generate remediation tasks.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAiGenerateThreats}
                  disabled={aiThreatLoading || !selectedProjId}
                  className="btn-ghost flex items-center gap-2 py-2 px-4 disabled:opacity-50"
                  title="Run STRIDE analysis over your components with AI"
                >
                  <Sparkles size={14} />
                  {aiThreatLoading ? 'Analyzing…' : 'AI Generate (STRIDE)'}
                </button>
                <button
                  onClick={() => setCreateThreatOpen(true)}
                  className="btn-premium flex items-center gap-2 py-2 px-4"
                >
                  <Plus size={14} />
                  Log Threat Finding
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {[
                { id: 'Spoofing', label: 'Spoofing (Identity)', desc: 'Pretending to be something or someone other than oneself.' },
                { id: 'Tampering', label: 'Tampering (Data)', desc: 'Modifying data or configuration maliciously.' },
                { id: 'Repudiation', label: 'Repudiation', desc: 'Claiming not to have performed an action without proof.' },
                { id: 'Information Disclosure', label: 'Information Disclosure', desc: 'Exposing confidential information to unauthorized parties.' },
                { id: 'Denial of Service', label: 'Denial of Service', desc: 'Interrupting or reducing capability to provide service.' },
                { id: 'Elevation of Privilege', label: 'Elevation of Privilege', desc: 'Gaining authorization level beyond expected capabilities.' }
              ].map(cat => {
                const catThreats = threats.filter(t => t.strideCategory === cat.id);
                return (
                  <div key={cat.id} className="premium-card p-5 space-y-4 border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/35">
                    <div className="border-b border-[var(--border-subtle)] pb-2 flex justify-between items-center">
                      <div>
                        <span className="text-[10px] font-black uppercase italic tracking-widest text-[var(--text-primary)] block">
                          {cat.label}
                        </span>
                        <span className="text-[8px] font-bold text-[var(--text-secondary)] uppercase tracking-wider block font-mono">
                          {cat.desc}
                        </span>
                      </div>
                      <span className="bg-[var(--bg-secondary)] text-[9px] font-black italic px-2 py-0.5 rounded-full border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                        {catThreats.length}
                      </span>
                    </div>

                    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                      {catThreats.map(threat => {
                        const sevColors = {
                          critical: 'text-red-500 border-red-500/20 bg-red-500/5',
                          high: 'text-orange-500 border-orange-500/20 bg-orange-500/5',
                          medium: 'text-yellow-500 border-yellow-500/20 bg-yellow-500/5',
                          low: 'text-green-500 border-green-500/20 bg-green-500/5'
                        };

                        const statusColors = {
                          identified: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
                          mitigated: 'bg-green-500/10 text-green-500 border-green-500/20',
                          accepted: 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                        };

                        return (
                          <div key={threat.$id} className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] p-4 rounded-xl space-y-3 relative group">
                            <div className="flex items-center justify-between gap-1.5 flex-wrap">
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border tracking-wider italic ${sevColors[threat.severity]}`}>
                                  {threat.severity}
                                </span>
                                <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border tracking-wider italic ${statusColors[threat.status]}`}>
                                  {threat.status}
                                </span>
                              </div>
                              <button
                                onClick={() => handleDeleteThreat(threat.$id)}
                                className="opacity-0 group-hover:opacity-100 text-[var(--status-error)] transition-opacity p-1 bg-transparent border-none cursor-pointer"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>

                            <h4 className="text-[11px] font-black uppercase italic leading-tight text-[var(--text-primary)]">
                              {threat.title}
                            </h4>

                            {threat.description && (
                              <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                                {threat.description}
                              </p>
                            )}

                            {threat.mitigation && (
                              <div className="p-2.5 bg-[var(--bg-primary)]/50 border border-[var(--border-subtle)] rounded-lg">
                                <span className="text-[8px] font-black uppercase italic text-[var(--text-secondary)] block mb-1">Proposed Countermeasure</span>
                                <p className="text-[9px] font-bold text-[var(--text-primary)] font-mono leading-tight">
                                  {threat.mitigation}
                                </p>
                              </div>
                            )}

                            <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between gap-4">
                              {threat.issueId ? (
                                <span className="text-[8px] font-black uppercase italic text-green-500 flex items-center gap-1">
                                  <CheckCircle2 size={10} /> Converted (ID: {threat.issueId})
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleConvertThreat(threat)}
                                  className="w-full py-1 bg-[var(--accent-primary)]/10 hover:bg-[var(--accent-primary)]/20 border border-[var(--accent-primary)]/30 text-[var(--accent-primary)] text-[8px] font-black uppercase italic rounded-md flex items-center justify-center gap-1 transition-all cursor-pointer"
                                >
                                  <ArrowRight size={10} /> Convert to Ticket
                                </button>
                              )}

                              <select
                                value={threat.status}
                                onChange={e => handleUpdateThreat(threat.$id, { status: e.target.value as any })}
                                className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg px-2 py-1 text-[9px] font-black italic uppercase text-[var(--text-primary)] outline-none cursor-pointer"
                              >
                                <option value="identified">Identified</option>
                                <option value="mitigated">Mitigated</option>
                                <option value="accepted">Accepted</option>
                              </select>
                            </div>
                          </div>
                        );
                      })}

                      {catThreats.length === 0 && (
                        <div className="text-center py-8 border border-dashed border-[var(--border-subtle)] rounded-2xl opacity-40">
                          <span className="text-[9px] font-black uppercase italic">No threat identified</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── ROADMAP & TIMELINE TAB ── */}
        {activeTab === 'timeline' && (
          <div className="premium-card p-6 space-y-6">
            <div>
              <h3 className="text-sm font-black uppercase italic tracking-wider text-[var(--text-primary)]">
                Agile Gantt & Epic Roadmap
              </h3>
              <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase mt-0.5 tracking-wider font-mono">
                Visualizing parent milestones and timelines
              </p>
            </div>

            <div className="space-y-6">
              {/* Epics timeline */}
              <div className="space-y-4">
                <div className="text-[10px] font-black uppercase italic tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-subtle)] pb-2">
                  Epics Timeline
                </div>

                <div className="space-y-4">
                  {epics.map((epic, index) => {
                    const startDays = 10 + index * 12;
                    const durationPercent = 30 + index * 5;

                    return (
                      <div key={epic.$id} className="grid grid-cols-12 items-center gap-4">
                        <div className="col-span-3 text-[10px] font-black uppercase italic text-[var(--text-primary)] flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: epic.color }} />
                          {epic.title}
                        </div>
                        <div className="col-span-9 bg-[var(--bg-secondary)] h-8 rounded-xl border border-[var(--border-subtle)] relative overflow-hidden flex items-center">
                          <div
                            className="absolute h-full opacity-35"
                            style={{
                              left: `${startDays}%`,
                              width: `${durationPercent}%`,
                              backgroundColor: epic.color
                            }}
                          />
                          <div
                            className="absolute h-1 top-0"
                            style={{
                              left: `${startDays}%`,
                              width: `${durationPercent}%`,
                              backgroundColor: epic.color
                            }}
                          />
                          <span
                            className="absolute text-[9px] font-black uppercase italic px-3"
                            style={{ left: `${startDays}%` }}
                          >
                            Target Range
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {epics.length === 0 && (
                    <div className="text-center py-6 text-[10px] uppercase italic text-[var(--text-secondary)] opacity-50">
                      No epics created to display on roadmap.
                    </div>
                  )}
                </div>
              </div>

              {/* Sprints timeline */}
              {currentProject?.type === 'scrum' && (
                <div className="space-y-4 pt-4 border-t border-[var(--border-subtle)]">
                  <div className="text-[10px] font-black uppercase italic tracking-widest text-[var(--text-secondary)] border-b border-[var(--border-subtle)] pb-2">
                    Sprints Grid
                  </div>

                  <div className="space-y-4">
                    {sprints.map((sprint, index) => {
                      const offset = index * 40;
                      return (
                        <div key={sprint.$id} className="grid grid-cols-12 items-center gap-4">
                          <div className="col-span-3 text-[10px] font-black uppercase italic text-[var(--text-primary)]">
                            {sprint.name}
                          </div>
                          <div className="col-span-9 bg-[var(--bg-secondary)] h-8 rounded-xl border border-[var(--border-subtle)] relative overflow-hidden flex items-center">
                            <div
                              className="absolute h-full bg-[var(--accent-primary)]/15 border-l-2 border-l-[var(--accent-primary)] border-r-2 border-r-[var(--accent-primary)]"
                              style={{ left: `${offset}%`, width: '40%' }}
                            />
                            <span
                              className="absolute text-[9px] font-black uppercase italic px-3 text-[var(--accent-primary)]"
                              style={{ left: `${offset}%` }}
                            >
                              {sprint.status === 'active' ? 'ACTIVE ITERATION' : 'PLANNED PERIOD'}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {sprints.length === 0 && (
                      <div className="text-center py-6 text-[10px] uppercase italic text-[var(--text-secondary)] opacity-50">
                        No sprints created to display on roadmap.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── REPORTS TAB ── */}
        {activeTab === 'reports' && (
          <div className="space-y-6">
            {/* Main stats blocks */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[
                { title: 'Total Issues', val: issues.length, icon: ListTodo, color: 'text-blue-500' },
                { title: 'Completed Issues', val: issues.filter(i => i.status === 'done').length, icon: CheckCircle2, color: 'text-green-500' },
                { title: 'Open Critical Bugs', val: issues.filter(i => i.type === 'bug' && i.priority === 'critical' && i.status !== 'done').length, icon: AlertTriangle, color: 'text-red-500' },
                { title: 'Total Sprints Logged', val: sprints.length, icon: Calendar, color: 'text-yellow-500' }
              ].map((card, i) => {
                const Icon = card.icon;
                return (
                  <div key={i} className="premium-card p-5 flex items-center justify-between">
                    <div>
                      <span className="text-[8px] font-black uppercase italic text-[var(--text-secondary)] block">
                        {card.title}
                      </span>
                      <span className="text-2xl font-black italic text-[var(--text-primary)] block mt-1">
                        {card.val}
                      </span>
                    </div>
                    <Icon className={`w-8 h-8 ${card.color} opacity-80`} />
                  </div>
                );
              })}
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Sprint Burndown Simulation */}
              <div className="premium-card p-6 space-y-4">
                <div>
                  <h4 className="text-xs font-black uppercase italic tracking-wider text-[var(--text-primary)]">
                    Sprint Burndown Chart
                  </h4>
                  <span className="text-[8px] font-bold text-[var(--text-secondary)] uppercase tracking-wider font-mono">
                    Story points remaining vs Ideal linear flow
                  </span>
                </div>
                <div className="h-64">
                  {burndownData.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-[10px] font-black uppercase tracking-widest italic text-[var(--text-secondary)]">
                      No active sprint with dates set
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={burndownData}
                        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="day" stroke="rgba(255,255,255,0.3)" fontSize={9} />
                        <YAxis stroke="rgba(255,255,255,0.3)" fontSize={9} />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }} />
                        <Legend wrapperStyle={{ fontSize: 9 }} />
                        <Line type="monotone" dataKey="actual" stroke="#ef4444" name="Actual Remaining" strokeWidth={2} connectNulls={false} dot={{ r: 4 }} />
                        <Line type="monotone" dataKey="ideal" stroke="#10b981" name="Ideal Burn" strokeDasharray="5 5" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Velocity Chart */}
              <div className="premium-card p-6 space-y-4">
                <div>
                  <h4 className="text-xs font-black uppercase italic tracking-wider text-[var(--text-primary)]">
                    Sprint Velocity Chart
                  </h4>
                  <span className="text-[8px] font-bold text-[var(--text-secondary)] uppercase tracking-wider font-mono">
                    Completed vs committed story points per sprint
                  </span>
                </div>
                <div className="h-64">
                  {velocityData.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-[10px] font-black uppercase tracking-widest italic text-[var(--text-secondary)]">
                      No sprints created yet
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={velocityData}
                        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="sprint" stroke="rgba(255,255,255,0.3)" fontSize={9} />
                        <YAxis stroke="rgba(255,255,255,0.3)" fontSize={9} />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }} />
                        <Legend wrapperStyle={{ fontSize: 9 }} />
                        <Bar dataKey="committed" fill="rgba(59, 130, 246, 0.4)" stroke="#3b82f6" name="Committed" />
                        <Bar dataKey="completed" fill="rgba(16, 185, 129, 0.4)" stroke="#10b981" name="Completed" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── DASHBOARD TAB ── */}
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Col-2 left */}
            <div className="lg:col-span-2 space-y-6">
              {/* Sprint Burndown Area graph */}
              <div className="premium-card p-6 space-y-4">
                <div>
                  <h4 className="text-xs font-black uppercase italic tracking-wider text-[var(--text-primary)]">
                    Bug Closure Velocity
                  </h4>
                  <span className="text-[8px] font-bold text-[var(--text-secondary)] uppercase tracking-wider font-mono">
                    Bugs by week created, closed vs still open
                  </span>
                </div>

                <div className="h-64">
                  {closureVelocityData.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-[10px] font-black uppercase tracking-widest italic text-[var(--text-secondary)]">
                      No bug issues tracked yet
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={closureVelocityData}
                        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="date" stroke="rgba(255,255,255,0.3)" fontSize={9} />
                        <YAxis stroke="rgba(255,255,255,0.3)" fontSize={9} />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }} />
                        <Area type="monotone" dataKey="closed" stroke="#10b981" fillOpacity={0.15} fill="#10b981" name="Closed" />
                        <Area type="monotone" dataKey="open" stroke="#ef4444" fillOpacity={0.05} fill="#ef4444" name="Still Open" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Recent Active Issues */}
              <div className="premium-card p-5 space-y-4">
                <span className="text-[10px] font-black uppercase italic tracking-widest text-[var(--text-primary)] border-b border-[var(--border-subtle)] pb-2 block">
                  Active Sprint Backlog View
                </span>

                <div className="space-y-3">
                  {issues.slice(0, 4).map(iss => (
                    <div key={iss.$id} className="flex justify-between items-center bg-[var(--bg-secondary)] border border-[var(--border-subtle)] p-3 rounded-xl">
                      <div>
                        <h6 className="text-[10px] font-black uppercase italic text-[var(--text-primary)]">
                          {iss.title}
                        </h6>
                        <span className="text-[8px] text-[var(--text-secondary)] font-mono block mt-0.5">
                          Assigned to: {iss.assignee}
                        </span>
                      </div>
                      <span className="px-2 py-0.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded text-[8px] font-black uppercase italic text-[var(--text-secondary)]">
                        {iss.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Col-1 right stats breakdown */}
            <div className="space-y-6">
              {/* Priorities distribution pie */}
              <div className="premium-card p-6 space-y-4">
                <span className="text-[10px] font-black uppercase italic tracking-widest text-[var(--text-primary)] border-b border-[var(--border-subtle)] pb-2 block">
                  Backlog Priority Allocation
                </span>

                <div className="h-56 flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Critical', value: issues.filter(i => i.priority === 'critical').length, color: '#ef4444' },
                          { name: 'High', value: issues.filter(i => i.priority === 'high').length, color: '#f97316' },
                          { name: 'Medium', value: issues.filter(i => i.priority === 'medium').length, color: '#eab308' },
                          { name: 'Low', value: issues.filter(i => i.priority === 'low').length, color: '#10b981' }
                        ].filter(p => p.value > 0)}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {
                          [
                            { name: 'Critical', color: '#ef4444' },
                            { name: 'High', color: '#f97316' },
                            { name: 'Medium', color: '#eab308' },
                            { name: 'Low', color: '#10b981' }
                          ].map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))
                        }
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', fontSize: 9 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[9px] font-black uppercase italic">
                  <span className="text-red-500">Critical: {issues.filter(i => i.priority === 'critical').length}</span>
                  <span className="text-orange-500">High: {issues.filter(i => i.priority === 'high').length}</span>
                  <span className="text-yellow-500">Medium: {issues.filter(i => i.priority === 'medium').length}</span>
                  <span className="text-green-500">Low: {issues.filter(i => i.priority === 'low').length}</span>
                </div>
              </div>

              {/* Rule engine snapshot */}
              <div className="premium-card p-5 space-y-4">
                <span className="text-[10px] font-black uppercase italic tracking-widest text-[var(--text-primary)] border-b border-[var(--border-subtle)] pb-2 block">
                  Active Automation Engine
                </span>

                <div className="space-y-3">
                  {automationRules.map(rule => (
                    <div key={rule.$id} className="flex items-center gap-2.5 text-[9px] font-bold text-[var(--text-secondary)] font-mono">
                      <Zap size={12} className="text-[var(--accent-primary)] shrink-0" />
                      <span className="truncate">
                        IF <span className="text-[var(--text-primary)]">{rule.trigger.toUpperCase()}</span> THEN <span className="text-[var(--text-primary)]">{rule.action.toUpperCase()}</span>
                      </span>
                    </div>
                  ))}
                  {automationRules.length === 0 && (
                    <div className="text-center py-2 text-[9px] uppercase italic text-[var(--text-secondary)] opacity-50">
                      No automation rules active.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SETTINGS & RULES TAB ── */}
        {activeTab === 'settings' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Automation Rules */}
            <div className="premium-card p-6 space-y-5">
              <div>
                <h3 className="text-xs font-black uppercase italic tracking-wider text-[var(--text-primary)]">
                  Scorpion DevSecOps Automation Rules
                </h3>
                <span className="text-[8px] font-bold text-[var(--text-secondary)] uppercase tracking-wider font-mono">
                  Trigger-Action events linking scanners and project management
                </span>
              </div>

              <form onSubmit={handleCreateRule} className="space-y-4 border-b border-[var(--border-subtle)] pb-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Trigger</label>
                    <select
                      value={ruleTrigger}
                      onChange={e => setRuleTrigger(e.target.value)}
                      className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl p-2.5 text-xs text-[var(--text-primary)] outline-none"
                    >
                      <option value="vuln_resolved">Vulnerability Scanned Resolved</option>
                      <option value="sprint_ended">Sprint Iteration Concluded</option>
                      <option value="critical_vuln">Critical Issue Created</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Action</label>
                    <select
                      value={ruleAction}
                      onChange={e => setRuleAction(e.target.value)}
                      className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl p-2.5 text-xs text-[var(--text-primary)] outline-none"
                    >
                      <option value="auto_create_task">Auto-Create & Close Task</option>
                      <option value="move_to_backlog">Roll Unfinished to Backlog</option>
                      <option value="slack_notify">Post Notification Slack Channels</option>
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  className="btn-premium py-2 px-6 flex items-center gap-1.5"
                >
                  <Plus size={12} /> Add Rule
                </button>
              </form>

              {/* Active Rules List */}
              <div className="space-y-3">
                <h4 className="text-[10px] font-black uppercase italic tracking-widest text-[var(--text-secondary)]">
                  Registered Logic Rules
                </h4>

                <div className="space-y-2">
                  {automationRules.map(rule => (
                    <div key={rule.$id} className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] px-4 py-3 rounded-xl flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <Zap size={14} className="text-yellow-500 shrink-0" />
                        <div className="text-[10px] font-bold text-[var(--text-secondary)] font-mono">
                          IF <span className="text-[var(--text-primary)] font-black uppercase">{rule.trigger}</span> THEN <span className="text-[var(--text-primary)] font-black uppercase">{rule.action}</span>
                        </div>
                      </div>
                      <button className="text-[var(--status-error)] opacity-60 hover:opacity-100 transition-opacity">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Custom Workflow Columns Settings */}
            <div className="premium-card p-6 space-y-5">
              <div>
                <h3 className="text-xs font-black uppercase italic tracking-wider text-[var(--text-primary)]">
                  Custom Board Workflows & Columns
                </h3>
                <span className="text-[8px] font-bold text-[var(--text-secondary)] uppercase tracking-wider font-mono">
                  Modify available status steps in this project lifecycle
                </span>
              </div>

              <div className="space-y-4">
                {[
                  { name: 'Backlog', default: true },
                  { name: 'To Do', default: true },
                  { name: 'In Progress', default: true },
                  { name: 'In Review', default: true },
                  { name: 'Done', default: true }
                ].map((col, i) => (
                  <div key={i} className="flex items-center justify-between bg-[var(--bg-secondary)] border border-[var(--border-subtle)] px-4 py-3 rounded-xl">
                    <span className="text-[10px] font-black uppercase italic text-[var(--text-primary)]">
                      {col.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[8px] text-[var(--text-secondary)] font-bold uppercase tracking-widest italic">
                        {col.default ? 'System Default' : 'Custom'}
                      </span>
                      <MoreVertical
                        size={14}
                        className="text-[var(--text-secondary)] cursor-pointer"
                        onClick={() => toast('Editing default status columns is coming soon!', { icon: '🚧' })}
                      />
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => toast('Custom status columns are coming soon!', { icon: '🚧' })}
                  className="w-full py-3 border border-dashed border-[var(--border-subtle)] hover:border-[var(--accent-primary)] text-[10px] font-black uppercase italic tracking-wider text-[var(--text-secondary)] hover:text-[var(--accent-primary)] rounded-xl flex items-center justify-center gap-1.5 transition-all"
                >
                  <Plus size={14} /> Add Custom Status Column
                </button>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ── MODALS ── */}

      {/* Create Project Modal */}
      {createProjectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <form onSubmit={handleCreateProject} className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
              <span className="font-black uppercase italic text-xs tracking-wider text-[var(--text-primary)]">
                Create New Plan Project
              </span>
              <button type="button" onClick={() => setCreateProjectOpen(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Project Name</label>
                <input
                  type="text"
                  required
                  value={newProjName}
                  onChange={e => setNewProjName(e.target.value)}
                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-xs text-[var(--text-primary)] outline-none"
                  placeholder="e.g. Q3 Compliance & Audit"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Board Methodology</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setNewProjType('scrum')}
                    className={`py-3 border rounded-xl text-[10px] font-black uppercase italic tracking-widest transition-all ${
                      newProjType === 'scrum'
                        ? 'border-[var(--accent-primary)] text-[var(--accent-primary)] bg-[var(--accent-primary)]/5'
                        : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'
                    }`}
                  >
                    Scrum (Sprint-based)
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewProjType('kanban')}
                    className={`py-3 border rounded-xl text-[10px] font-black uppercase italic tracking-widest transition-all ${
                      newProjType === 'kanban'
                        ? 'border-[var(--accent-primary)] text-[var(--accent-primary)] bg-[var(--accent-primary)]/5'
                        : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'
                    }`}
                  >
                    Kanban (Continuous)
                  </button>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-[var(--border-subtle)] flex justify-end gap-2 bg-[var(--bg-primary)]/20">
              <button type="button" onClick={() => setCreateProjectOpen(false)} className="px-4 py-2 text-[10px] font-black uppercase italic text-[var(--text-secondary)]">Cancel</button>
              <button type="submit" className="btn-premium py-2 px-6">Create</button>
            </div>
          </form>
        </div>
      )}

      {/* Create Sprint Modal */}
      {createSprintOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <form onSubmit={handleCreateSprint} className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
              <span className="font-black uppercase italic text-xs tracking-wider text-[var(--text-primary)]">
                Create Sprint Iteration
              </span>
              <button type="button" onClick={() => setCreateSprintOpen(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Sprint Name</label>
                <input
                  type="text"
                  required
                  value={newSprintName}
                  onChange={e => setNewSprintName(e.target.value)}
                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-xs text-[var(--text-primary)] outline-none"
                  placeholder="e.g. Sprint 3 - Security Ingestion"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Sprint Goal</label>
                <textarea
                  value={newSprintGoal}
                  onChange={e => setNewSprintGoal(e.target.value)}
                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-xs text-[var(--text-primary)] outline-none h-20 resize-none"
                  placeholder="Summarize objectives for this sprint..."
                />
              </div>
            </div>
            <div className="p-4 border-t border-[var(--border-subtle)] flex justify-end gap-2 bg-[var(--bg-primary)]/20">
              <button type="button" onClick={() => setCreateSprintOpen(false)} className="px-4 py-2 text-[10px] font-black uppercase italic text-[var(--text-secondary)]">Cancel</button>
              <button type="submit" className="btn-premium py-2 px-6">Create Sprint</button>
            </div>
          </form>
        </div>
      )}

      {/* Create Epic Modal */}
      {createEpicOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <form onSubmit={handleCreateEpic} className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
              <span className="font-black uppercase italic text-xs tracking-wider text-[var(--text-primary)]">
                Create Epic Parent Item
              </span>
              <button type="button" onClick={() => setCreateEpicOpen(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Epic Title</label>
                <input
                  type="text"
                  required
                  value={newEpicTitle}
                  onChange={e => setNewEpicTitle(e.target.value)}
                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-xs text-[var(--text-primary)] outline-none"
                  placeholder="e.g. Mitigate SQLi Vulnerability"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Color Tag</label>
                <div className="flex gap-2.5">
                  {['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#a855f7'].map(col => (
                    <button
                      key={col}
                      type="button"
                      onClick={() => setNewEpicColor(col)}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${
                        newEpicColor === col ? 'border-white scale-110 shadow-lg' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: col }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-[var(--border-subtle)] flex justify-end gap-2 bg-[var(--bg-primary)]/20">
              <button type="button" onClick={() => setCreateEpicOpen(false)} className="px-4 py-2 text-[10px] font-black uppercase italic text-[var(--text-secondary)]">Cancel</button>
              <button type="submit" className="btn-premium py-2 px-6">Create Epic</button>
            </div>
          </form>
        </div>
      )}

      {/* Create Issue Modal */}
      {createIssueOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <form onSubmit={handleCreateIssue} className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
              <span className="font-black uppercase italic text-xs tracking-wider text-[var(--text-primary)]">
                Create Security Task / Issue
              </span>
              <button type="button" onClick={() => setCreateIssueOpen(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="space-y-1.5">
                <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Issue Title</label>
                <input
                  type="text"
                  required
                  value={newIssueTitle}
                  onChange={e => setNewIssueTitle(e.target.value)}
                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-xs text-[var(--text-primary)] outline-none"
                  placeholder="Describe the task or vulnerability fix needed..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Issue Type</label>
                  <select
                    value={newIssueType}
                    onChange={e => setNewIssueType(e.target.value as any)}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl p-2.5 text-xs text-[var(--text-primary)] outline-none"
                  >
                    <option value="task">Task</option>
                    <option value="bug">Bug (Vulnerability)</option>
                    <option value="story">User Story</option>
                    <option value="subtask">Subtask</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Priority</label>
                  <select
                    value={newIssuePriority}
                    onChange={e => setNewIssuePriority(e.target.value as any)}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl p-2.5 text-xs text-[var(--text-primary)] outline-none"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Story Points (Difficulty)</label>
                  <input
                    type="number"
                    min={0}
                    value={newIssuePoints}
                    onChange={e => setNewIssuePoints(Number(e.target.value))}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl p-2 text-xs text-[var(--text-primary)] outline-none font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Link Existing Scan Finding (Optional)</label>
                  <select
                    value={newIssueVulnId}
                    onChange={e => setNewIssueVulnId(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl p-2 text-xs text-[var(--text-primary)] outline-none"
                  >
                    <option value="">No linked vulnerability</option>
                    {vulnerabilities.map(v => (
                      <option key={v.$id} value={v.$id}>{v.title}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Description / Scope Details</label>
                <textarea
                  value={newIssueDesc}
                  onChange={e => setNewIssueDesc(e.target.value)}
                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-xs text-[var(--text-primary)] outline-none h-24 resize-none"
                  placeholder="Enter details, reproduction steps, or code pointers..."
                />
              </div>
            </div>
            <div className="p-4 border-t border-[var(--border-subtle)] flex justify-end gap-2 bg-[var(--bg-primary)]/20">
              <button type="button" onClick={() => setCreateIssueOpen(false)} className="px-4 py-2 text-[10px] font-black uppercase italic text-[var(--text-secondary)]">Cancel</button>
              <button type="submit" className="btn-premium py-2 px-6">Create Issue</button>
            </div>
          </form>
        </div>
      )}

      {/* Task / Issue Detail Drawer/Modal */}
      {selectedIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 backdrop-blur-sm">
          <div className="bg-[var(--bg-secondary)] border-l border-[var(--border-color)] h-full w-full max-w-2xl flex flex-col shadow-2xl animate-slide-in">
            {/* Header */}
            <div className="p-5 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-primary)]/30">
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg text-[10px] font-mono text-[var(--text-secondary)]">
                  {selectedIssue.$id}
                </span>
                <span className="text-[10px] font-black uppercase italic tracking-widest text-[var(--text-secondary)]">
                  Edit Issue Detail
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDeleteIssue(selectedIssue.$id)}
                  title="Delete Issue"
                  className="p-2 text-[var(--status-error)] hover:bg-[var(--status-error)]/10 rounded-xl transition-colors"
                >
                  <Trash2 size={16} />
                </button>
                <button
                  onClick={() => setSelectedIssue(null)}
                  className="p-2 text-[var(--text-secondary)] hover:text-white rounded-xl"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Content Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">

              {/* Title & Description */}
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="block text-[8px] font-black uppercase italic text-[var(--text-secondary)]">Title</label>
                  <input
                    type="text"
                    value={selectedIssue.title}
                    onChange={e => handleUpdateIssue(selectedIssue.$id, { title: e.target.value })}
                    className="w-full bg-transparent border-b border-transparent hover:border-[var(--border-subtle)] focus:border-[var(--accent-primary)] focus:outline-none py-1.5 text-base font-black uppercase italic text-[var(--text-primary)]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[8px] font-black uppercase italic text-[var(--text-secondary)]">Description</label>
                  <textarea
                    value={selectedIssue.description || ''}
                    onChange={e => handleUpdateIssue(selectedIssue.$id, { description: e.target.value })}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl p-3 text-xs text-[var(--text-primary)] outline-none h-24 resize-none focus:ring-1 focus:ring-[var(--accent-primary)]"
                    placeholder="Provide full description details..."
                  />
                </div>
              </div>

              {/* Fields Table */}
              <div className="grid grid-cols-2 gap-4 border-t border-b border-[var(--border-subtle)] py-4">
                {/* Left col */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Status</span>
                    <select
                      value={selectedIssue.status}
                      onChange={e => handleUpdateIssue(selectedIssue.$id, { status: e.target.value as any })}
                      className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1 text-[10px] font-bold text-[var(--text-primary)]"
                    >
                      <option value="backlog">Backlog</option>
                      <option value="todo">To Do</option>
                      <option value="inprogress">In Progress</option>
                      <option value="inreview">In Review</option>
                      <option value="done">Done</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Priority</span>
                    <select
                      value={selectedIssue.priority}
                      onChange={e => handleUpdateIssue(selectedIssue.$id, { priority: e.target.value as any })}
                      className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1 text-[10px] font-bold text-[var(--text-primary)]"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Assignee</span>
                    <input
                      type="text"
                      value={selectedIssue.assignee || ''}
                      onChange={e => handleUpdateIssue(selectedIssue.$id, { assignee: e.target.value })}
                      className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1 text-[10px] text-[var(--text-primary)] max-w-[150px] outline-none"
                    />
                  </div>
                </div>

                {/* Right col */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Story Points</span>
                    <input
                      type="number"
                      value={selectedIssue.storyPoints || 0}
                      onChange={e => handleUpdateIssue(selectedIssue.$id, { storyPoints: Number(e.target.value) })}
                      className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg px-2 py-0.5 text-[10px] text-[var(--text-primary)] w-16 text-center outline-none font-mono"
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Linked Epic</span>
                    <select
                      value={selectedIssue.epicId || ''}
                      onChange={e => handleUpdateIssue(selectedIssue.$id, { epicId: e.target.value || null })}
                      className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1 text-[10px] text-[var(--text-primary)] max-w-[150px]"
                    >
                      <option value="">No Epic Link</option>
                      {epics.map(ep => (
                        <option key={ep.$id} value={ep.$id}>{ep.title}</option>
                      ))}
                    </select>
                  </div>

                  {currentProject?.type === 'scrum' && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Sprint</span>
                      <select
                        value={selectedIssue.sprintId || ''}
                        onChange={e => handleUpdateIssue(selectedIssue.$id, { sprintId: e.target.value || null })}
                        className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-1 text-[10px] text-[var(--text-primary)] max-w-[150px]"
                      >
                        <option value="">No Sprint Link</option>
                        {sprints.map(sp => (
                          <option key={sp.$id} value={sp.$id}>{sp.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Comments Feed */}
              <div className="space-y-4">
                <span className="text-[10px] font-black uppercase italic tracking-widest text-[var(--text-primary)] border-b border-[var(--border-subtle)] pb-2 block">
                  Comments & Audit Activity
                </span>

                <form onSubmit={handleCreateComment} className="flex gap-2">
                  <input
                    type="text"
                    value={newCommentBody}
                    onChange={e => setNewCommentBody(e.target.value)}
                    placeholder="Write a comment..."
                    className="flex-grow bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-xs text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
                  />
                  <button type="submit" className="btn-premium px-4 py-2 text-[9px]">
                    Post
                  </button>
                </form>

                <div className="space-y-3 mt-4">
                  {commentLoading ? (
                    <div className="text-center py-2 text-[9px] uppercase italic text-[var(--text-secondary)] animate-pulse">
                      Syncing comments feed...
                    </div>
                  ) : comments.map(c => (
                    <div key={c.$id} className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] p-3 rounded-xl space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-black uppercase italic text-[var(--accent-primary)]">
                          {c.author.split('@')[0]}
                        </span>
                        <span className="text-[8px] text-[var(--text-secondary)] font-mono">
                          {new Date(c.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-[10px] text-[var(--text-primary)] leading-relaxed">
                        {c.body}
                      </p>
                    </div>
                  ))}

                  {comments.length === 0 && !commentLoading && (
                    <div className="text-center py-4 text-[9px] uppercase italic text-[var(--text-secondary)] opacity-50">
                      No comments posted.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Threat Modal */}
      {createThreatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <form onSubmit={handleCreateThreat} className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
              <span className="font-black uppercase italic text-xs tracking-wider text-[var(--text-primary)]">
                Log New Threat Finding
              </span>
              <button type="button" onClick={() => setCreateThreatOpen(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Threat Title</label>
                <input
                  type="text"
                  required
                  value={newThreatTitle}
                  onChange={e => setNewThreatTitle(e.target.value)}
                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-xs text-[var(--text-primary)] outline-none"
                  placeholder="e.g. CSRF token validation bypass in admin dashboard"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)]">STRIDE Category</label>
                  <select
                    value={newThreatStride}
                    onChange={e => setNewThreatStride(e.target.value as any)}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl p-2.5 text-xs text-[var(--text-primary)] outline-none"
                  >
                    <option value="Spoofing">Spoofing (Identity)</option>
                    <option value="Tampering">Tampering (Data)</option>
                    <option value="Repudiation">Repudiation</option>
                    <option value="Information Disclosure">Information Disclosure</option>
                    <option value="Denial of Service">Denial of Service</option>
                    <option value="Elevation of Privilege">Elevation of Privilege</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Severity</label>
                  <select
                    value={newThreatSeverity}
                    onChange={e => setNewThreatSeverity(e.target.value as any)}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl p-2.5 text-xs text-[var(--text-primary)] outline-none"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Description / Attack Vector</label>
                <textarea
                  value={newThreatDesc}
                  onChange={e => setNewThreatDesc(e.target.value)}
                  rows={3}
                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-xs text-[var(--text-primary)] outline-none resize-none"
                  placeholder="Describe how an attacker could exploit this threat..."
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-[9px] font-black uppercase italic text-[var(--text-secondary)]">Proposed Countermeasure / Mitigation</label>
                <textarea
                  value={newThreatMitigation}
                  onChange={e => setNewThreatMitigation(e.target.value)}
                  rows={2}
                  className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-2.5 text-xs text-[var(--text-primary)] outline-none resize-none"
                  placeholder="Describe the proposed fix or security controls..."
                />
              </div>
            </div>
            <div className="p-4 border-t border-[var(--border-subtle)] flex justify-end gap-2 bg-[var(--bg-primary)]/20">
              <button type="button" onClick={() => setCreateThreatOpen(false)} className="px-4 py-2 text-[10px] font-black uppercase italic text-[var(--text-secondary)]">Cancel</button>
              <button type="submit" className="btn-premium py-2 px-6">Log Threat</button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}
