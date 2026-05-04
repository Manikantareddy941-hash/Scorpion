import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Shield, Clock, User, HardDrive, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function AuditLog() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/api/audit`, {
          headers: { 
            'x-user-id': user?.$id || '', 
            'x-tenant-id': 'default' 
          }
        });
        const data = await response.json();
        setLogs(data.documents ?? []);
      } catch (err) {
        console.error('Failed to fetch audit logs:', err);
      } finally {
        setLoading(false);
      }
    };

    if (user) fetchLogs();
  }, [user]);

  const actionColor: Record<string, string> = {
    'gate.blocked':       '#ff5252',
    'rollback.triggered': '#ff8a80',
    'incident.created':   '#ffd740',
    'scan.created':       '#00ffa3',
    'evidence.exported':  '#38bdf8'
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-black uppercase italic tracking-tighter flex items-center gap-3">
          <Shield className="w-8 h-8 text-[var(--accent-primary)]" />
          {t('audit.title')}
        </h1>
        <p className="text-[var(--text-secondary)] text-sm mt-2 font-medium uppercase tracking-widest opacity-70">
          {t('audit.subtitle')}
        </p>
      </div>

      <div className="premium-card overflow-hidden">
        <div className="bg-[var(--bg-primary)]/50 border-b border-[var(--border-subtle)] px-6 py-3 grid grid-cols-12 gap-4">
          <div className="col-span-2 text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">{t('audit.action')}</div>
          <div className="col-span-4 text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">{t('audit.resource')}</div>
          <div className="col-span-3 text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">{t('audit.actor')}</div>
          <div className="col-span-3 text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] text-right">{t('audit.timestamp')}</div>
        </div>

        {loading ? (
          <div className="p-20 flex flex-col items-center justify-center gap-4">
            <div className="w-10 h-10 border-4 border-[var(--accent-primary)]/20 border-t-[var(--accent-primary)] rounded-full animate-spin" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--text-secondary)] animate-pulse">{t('audit.decrypting')}</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-20 flex flex-col items-center justify-center gap-4 opacity-50">
            <Clock className="w-12 h-12 text-[var(--text-secondary)]" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--text-secondary)]">{t('audit.no_events')}</span>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {logs.map(log => (
              <div key={log.$id}
                className="grid grid-cols-12 gap-4 px-6 py-5 items-center hover:bg-[var(--bg-primary)]/40 transition-all group">
                
                <div className="col-span-2">
                  <span className="text-[9px] font-black px-2 py-1 rounded uppercase block text-center truncate"
                    style={{
                      background: `${actionColor[log.action] ?? '#888'}20`,
                      color: actionColor[log.action] ?? '#888',
                      border: `1px solid ${actionColor[log.action] ?? '#888'}30`
                    }}>
                    {log.action}
                  </span>
                </div>

                <div className="col-span-4 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)] flex items-center justify-center shrink-0 group-hover:border-[var(--accent-primary)]/50 transition-colors">
                    <HardDrive className="w-4 h-4 text-[var(--text-secondary)]" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-tighter text-[var(--text-primary)] truncate">
                      {log.resource}
                    </p>
                    {log.resourceId && (
                      <p className="text-[9px] font-mono text-[var(--text-secondary)] truncate">
                        ID: {log.resourceId}
                      </p>
                    )}
                  </div>
                </div>

                <div className="col-span-3 flex items-center gap-2">
                  <User className="w-3 h-3 text-[var(--text-secondary)]" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-[var(--text-primary)] truncate">{log.actorEmail}</p>
                    <p className="text-[8px] font-medium text-[var(--text-secondary)] uppercase tracking-widest">{log.actor === 'system' ? t('audit.automated') : t('audit.manual')}</p>
                  </div>
                </div>

                <div className="col-span-3 text-right">
                  <p className="text-[10px] font-bold text-[var(--text-primary)]">
                    {new Date(log.timestamp).toLocaleDateString()}
                  </p>
                  <p className="text-[9px] font-medium text-[var(--text-secondary)]">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      <div className="mt-6 flex justify-end">
        <button className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors">
          {t('audit.download')} <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
