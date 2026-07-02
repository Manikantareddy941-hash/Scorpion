import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { saveJiraConfig, testJiraConnection } from '../hooks/useTickets';
import { JiraConfig } from '../../shared/types';
import {
  ArrowLeft, Key, Globe, Mail,
  Cpu, Save, Loader2, Link2, CheckCircle2, AlertCircle
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function JiraSettings() {
  const navigate = useNavigate();
  const { getJWT } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; projectName?: string; error?: string } | null>(null);

  const [form, setForm] = useState<JiraConfig>({
    baseUrl: '',
    email: '',
    apiToken: '',
    projectKey: '',
    defaultIssueType: 'Task'
  });

  // Fetch current config on mount
  useEffect(() => {
    const fetchConfig = async () => {
      setLoading(true);
      try {
        const token = await getJWT();
        const response = await fetch('/api/tickets/jira/config', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.configured) {
            setConfigured(true);
            setForm({
              baseUrl: data.baseUrl || '',
              email: data.email || '',
              apiToken: '', // Keep token field blank for input
              projectKey: data.projectKey || '',
              defaultIssueType: data.defaultIssueType || 'Task'
            });
          }
        }
      } catch (err) {
        console.error('Error fetching Jira config:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, [getJWT]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.baseUrl || !form.email || !form.apiToken || !form.projectKey || !form.defaultIssueType) {
      toast.error('All configuration fields are required.');
      return;
    }

    setSaving(true);
    setTestResult(null);
    try {
      await saveJiraConfig(getJWT, form);
      toast.success('Jira configuration saved successfully');
      setConfigured(true);
      // Clear token input but keep it marked as configured
      setForm(prev => ({ ...prev, apiToken: '' }));
    } catch (err: any) {
      console.error('Save configuration error:', err);
      toast.error(err.message || 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // If the user has entered a new token, save it first
      if (form.apiToken) {
        await saveJiraConfig(getJWT, form);
        setConfigured(true);
      }

      const res = await testJiraConnection(getJWT);
      if (res.ok) {
        setTestResult({ ok: true, projectName: res.projectName });
        toast.success('Jira connection verified successfully!');
      } else {
        setTestResult({ ok: false, error: res.error });
        toast.error('Jira connection check failed');
      }
    } catch (err: any) {
      console.error('Connection test error:', err);
      setTestResult({ ok: false, error: err.message });
      toast.error(err.message || 'Failed to establish connection to Jira');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col items-center justify-center py-32">
        <Loader2 className="w-12 h-12 text-[var(--accent-primary)] animate-spin mb-4" />
        <p className="text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] italic">
          Verifying integration credentials...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-8">
        
        {/* Header Title bar */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/tickets')}
            className="p-3 bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white rounded-xl transition-all"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[var(--accent-primary)] rounded-2xl flex items-center justify-center text-black shadow-lg shadow-[var(--accent-primary)]/20">
              <Link2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-[var(--text-primary)] uppercase italic tracking-tighter">
                Atlassian Jira Integration
              </h1>
              <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-widest italic mt-0.5 font-mono">
                Establish secure bidirectional synchronization links
              </p>
            </div>
          </div>
        </div>

        {/* Configuration Status Banner */}
        {configured && (
          <div className="p-5 rounded-2xl bg-green-500/10 border border-green-500/25 flex items-start gap-4">
            <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-black text-green-400 uppercase italic">
                Jira Integration Active
              </p>
              <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase italic mt-0.5">
                The connection is active. Tickets created or updated will automatically synchronize.
              </p>
            </div>
          </div>
        )}

        {/* Credentials Form */}
        <form onSubmit={handleSave} className="premium-card p-8 space-y-6 bg-[var(--bg-card)]">
          <h3 className="text-xs font-black uppercase italic tracking-wider text-[var(--text-primary)] pb-3 border-b border-[var(--border-subtle)]/50">
            Jira Endpoint Configuration
          </h3>

          <div className="space-y-4">
            {/* Base URL */}
            <div className="space-y-1">
              <label className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-wider block">
                Jira Base URL *
              </label>
              <div className="relative">
                <Globe size={12} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  type="url"
                  required
                  placeholder="https://your-company.atlassian.net"
                  value={form.baseUrl}
                  onChange={e => setForm({ ...form, baseUrl: e.target.value })}
                  className="w-full pl-9 pr-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all font-semibold font-mono"
                />
              </div>
            </div>

            {/* Email Address */}
            <div className="space-y-1">
              <label className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-wider block">
                Atlassian Email Address *
              </label>
              <div className="relative">
                <Mail size={12} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className="w-full pl-9 pr-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all font-semibold"
                />
              </div>
            </div>

            {/* API Token */}
            <div className="space-y-1">
              <label className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-wider block">
                Jira API Token *
              </label>
              <div className="relative">
                <Key size={12} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  type="password"
                  required={!configured} // Required if not configured, optional to re-enter if editing
                  placeholder={configured ? '•••••••••••••••••••••••• (Enter new token to overwrite)' : 'Enter your Atlassian API Token'}
                  value={form.apiToken}
                  onChange={e => setForm({ ...form, apiToken: e.target.value })}
                  className="w-full pl-9 pr-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all font-mono"
                />
              </div>
              <p className="text-[8px] text-[var(--text-secondary)] italic mt-1 font-mono uppercase">
                * Note: Credential stored in-memory only. Must be re-entered after backend server restarts.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Project Key */}
              <div className="space-y-1">
                <label className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-wider block">
                  Project Key *
                </label>
                <div className="relative">
                  <Cpu size={12} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                  <input
                    type="text"
                    required
                    placeholder="e.g. SEC"
                    value={form.projectKey}
                    onChange={e => setForm({ ...form, projectKey: e.target.value.toUpperCase() })}
                    className="w-full pl-9 pr-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all font-mono font-bold uppercase"
                  />
                </div>
              </div>

              {/* Default Issue Type */}
              <div className="space-y-1">
                <label className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-wider block">
                  Default Issue Type *
                </label>
                <select
                  value={form.defaultIssueType}
                  onChange={e => setForm({ ...form, defaultIssueType: e.target.value })}
                  className="w-full px-4 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] transition-all font-bold uppercase italic cursor-pointer"
                >
                  <option value="Task">Task</option>
                  <option value="Bug">Bug</option>
                  <option value="Story">Story</option>
                  <option value="Vulnerability">Vulnerability</option>
                </select>
              </div>
            </div>
          </div>

          {/* Test results indicator */}
          {testResult && (
            <div className={`p-4 rounded-xl border flex items-start gap-3 text-xs font-semibold
              ${testResult.ok 
                ? 'bg-green-500/5 border-green-500/20 text-green-400' 
                : 'bg-red-500/5 border-red-500/20 text-red-400'
              }`}
          >
            {testResult.ok ? (
              <>
                <CheckCircle2 size={16} className="text-green-500 shrink-0" />
                <span>Connected successfully to project: <strong>{testResult.projectName}</strong></span>
              </>
            ) : (
              <>
                <AlertCircle size={16} className="text-red-500 shrink-0" />
                <span>Connection error: {testResult.error || 'Unknown endpoint response.'}</span>
              </>
            )}
          </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--border-subtle)]/50">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing || (!form.baseUrl || !form.email || !form.projectKey)}
              className="px-5 py-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] hover:border-[var(--accent-primary)]/40 text-[var(--text-secondary)] hover:text-white text-[10px] font-black uppercase italic tracking-widest rounded-xl transition-all flex items-center gap-2"
            >
              {testing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Link2 size={12} />
              )}
              Test Connection
            </button>
            
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-3 bg-[var(--accent-primary)] hover:bg-opacity-95 text-black text-[10px] font-black uppercase italic tracking-widest rounded-xl transition-all flex items-center gap-2"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save size={12} />
              )}
              Save Configuration
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
