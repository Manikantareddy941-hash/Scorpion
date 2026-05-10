import { useState, useEffect } from 'react';
import { X, Github, Upload, FolderOpen, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import UVScanOverlay from './UVScanOverlay';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../contexts/ThemeContext';
import { useScan } from '../contexts/ScanContext';
import { databases, DB_ID, COLLECTIONS, ID } from '../lib/appwrite';

interface Props {
  onClose: () => void;
  onScan: (data: { type: 'github' | 'upload'; value: string | File[] }) => void;
}

export default function NewScanModal({ onClose, onScan }: Props) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const [tab, setTab] = useState<'github' | 'upload'>('github');
  const [repoUrl, setRepoUrl] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const { activeScan, startScan, updateScan, addLog, completeScan, failScan, clearScan } = useScan();
  
  const { user, getJWT } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let interval: any;
    if (activeScan?.isScanning && activeScan.stats.status !== 'COMPLETE') {
      const startTime = Date.now();
      interval = setInterval(() => {
        const diff = Math.floor((Date.now() - startTime) / 1000);
        const mins = Math.floor(diff / 60).toString().padStart(2, '0');
        const secs = (diff % 60).toString().padStart(2, '0');
        updateScan({ duration: `${mins}:${secs}` });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [activeScan?.isScanning, activeScan?.stats.status]);

  const pollScanStatus = async (id: string, token: string) => {
    const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    let pollCount = 0;
    let lastStatus = "";
    
    const interval = setInterval(async () => {
      try {
        pollCount++;
        const res = await fetch(`${apiBase}/api/repos/scans/${id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        if (data.status !== lastStatus) {
            lastStatus = data.status;
            switch(data.status) {
                case 'queued': addLog('Initializing scanner...', 'progress'); break;
                case 'cloning': addLog(`Connecting to repository: ${repoUrl.split('/').pop()}`, 'success'); addLog('Fetching source files...', 'progress'); break;
                case 'scanning': addLog('Analyzing code quality...', 'progress'); break;
                case 'analyzing': addLog('Running vulnerability detection...', 'progress'); addLog('Checking security policies...', 'progress'); break;
            }
        }

        updateScan({
            stats: {
                filesScanned: data.files_scanned || Math.min(100 + pollCount * 5, 250),
                issuesFound: data.vulnerabilities || data.critical + data.high + data.medium + data.low || 0,
                status: data.status === 'completed' ? 'COMPLETE' : data.status === 'failed' ? 'FAILED' : 'RUNNING'
            }
        });

        if (data.status === 'completed') {
          clearInterval(interval);
          addLog('Scan complete.', 'success');
          
          completeScan({
            critical: data.critical || 0, high: data.high || 0, medium: data.medium || 0, low: data.low || 0, score: data.security_score || 100, policy: data.gateStatus === 'failed' ? 'FAIL' : 'PASS'
          });

          await createNotification(
            'Scan Completed',
            `Scan for ${repoUrl.split('/').pop() || 'repository'} finished successfully.`,
            'info',
            id
          );
        } else if (data.status === 'failed') {
          clearInterval(interval);
          failScan(data.error || t('dashboard.modal.scan_execution_failed', 'Scan execution failed'));

          await createNotification(
            'Scan Failed',
            `Scan for ${repoUrl.split('/').pop() || 'repository'} failed: ${data.error}`,
            'critical',
            id
          );
        } else {
          switch(data.status) {
            case 'queued': updateScan({ progress: Math.min(15 + pollCount, 25) }); break;
            case 'cloning': updateScan({ progress: Math.min(30 + pollCount, 45) }); break;
            case 'scanning': updateScan({ progress: Math.min(50 + pollCount, 75) }); break;
            case 'analyzing': updateScan({ progress: Math.min(80 + pollCount, 95) }); break;
            default: updateScan({ progress: Math.min((activeScan?.progress || 0) + 1, 90) });
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 2000);
  };

  const handleScan = async () => {
    if (tab === 'upload' && files.length > 0) {
      toast.error(t('dashboard.modal.upload_coming_soon', 'Local file upload scanning is coming soon. Please use GitHub URL.'));
      return;
    }

    if (!repoUrl.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const token = await getJWT();
      if (!token) throw new Error(t('common.auth_required', 'Authentication required'));

      // 1. Register/Find Repo
      const repoRes = await fetch(`${apiBase}/api/repos`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ url: repoUrl.trim(), visibility })
      });
      const repo = await repoRes.json();
      if (!repo.$id) throw new Error(repo.error || t('dashboard.modal.repo_register_failed', 'Failed to register repository'));

      // 2. Start Scan
      const scanRes = await fetch(`${apiBase}/api/repos/${repo.$id}/scan`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ visibility })
      });
      const scanData = await scanRes.json();
      
      const { auditLogger } = await import("../lib/auditLogger");
      auditLogger.log({
        userId: user.$id,
        action: 'trigger_scan',
        resource: 'repository',
        resourceId: repo.$id,
        details: `Triggered scan for repo: ${repoUrl}`,
        status: 'success'
      });
      
      if (scanData.scanId) {
        startScan(repoUrl.split('/').pop() || 'Repository', scanData.scanId);
        pollScanStatus(scanData.scanId, token);
      } else {
        throw new Error(scanData.error || t('dashboard.modal.scan_initiate_failed', 'Failed to initiate scan'));
      }
    } catch (err: any) {
      setError(err.message || t('dashboard.modal.scan_start_failed', 'Failed to start scan'));
      addLog(`Initialization failed: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const createNotification = async (title: string, message: string, severity: string, scanId?: string) => {
    if (!user?.$id) return;
    try {
      await databases.createDocument(DB_ID, COLLECTIONS.NOTIFICATIONS, ID.unique(), {
        userId: user.$id,
        title,
        message,
        severity,
        isRead: false,
        type: 'scan',
        relatedScanId: scanId || '',
        createdAt: new Date().toISOString()
      });
    } catch (err) {
      console.error('Failed to create notification:', err);
    }
  };

  const canSubmit = tab === 'github' ? !!repoUrl.trim() : files.length > 0;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className={theme === 'liquid-glass' ? 'liquid-glass' : ''} style={{ background: theme === 'liquid-glass' ? 'transparent' : 'var(--bg-card)', border: theme === 'liquid-glass' ? 'none' : '1px solid var(--border-subtle)', borderRadius: '16px', width: '520px', maxWidth: '95vw', padding: '32px', position: 'relative' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h2 style={{ color: 'var(--accent-primary)', fontWeight: 800, fontSize: '1.2rem', letterSpacing: '0.1em', margin: 0 }}>
              {t('dashboard.modal.new_scan_title', 'NEW SCAN')}
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '4px 0 0' }}>
              {t('dashboard.modal.new_scan_subtitle', 'Upload code or connect a GitHub repository')}
            </p>
          </div>
          <button onClick={onClose} disabled={loading} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: loading ? 'not-allowed' : 'pointer' }}><X size={20} /></button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          {(['github', 'upload'] as const).map(t_val => (
            <button key={t_val} onClick={() => { setTab(t_val); setError(null); }}
              disabled={loading}
              style={{ flex: 1, padding: '10px', borderRadius: '8px', border: `1px solid ${tab === t_val ? 'var(--accent-primary)' : 'var(--border-subtle)'}`, background: tab === t_val ? 'var(--accent-primary)0D' : 'transparent', color: tab === t_val ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: 700, fontSize: '0.8rem', letterSpacing: '0.1em', cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              {t_val === 'github' ? <><Github size={16} /> {t('dashboard.modal.tab_github', 'GITHUB REPO')}</> : <><Upload size={16} /> {t('dashboard.modal.tab_upload', 'LOCAL FILES')}</>}
            </button>
          ))}
        </div>

        {/* GitHub Tab */}
        {tab === 'github' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', letterSpacing: '0.1em', display: 'block', marginBottom: '8px' }}>
                {t('dashboard.modal.repo_url_label', 'REPOSITORY URL')}
              </label>
              <input
                type="text"
                placeholder={t('dashboard.modal.repo_url_placeholder', 'https://github.com/username/repository')}
                value={repoUrl}
                onChange={e => { setRepoUrl(e.target.value); setError(null); }}
                disabled={loading}
                style={{ width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '12px', color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box', opacity: loading ? 0.6 : 1 }}
              />
            </div>
            <div>
              <label style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', letterSpacing: '0.1em', display: 'block', marginBottom: '8px' }}>
                {t('dashboard.modal.visibility_label', 'VISIBILITY')}
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {(['public', 'private'] as const).map(v => (
                  <button key={v} onClick={() => setVisibility(v)} disabled={loading}
                    style={{ flex: 1, padding: '10px', borderRadius: '8px', border: `1px solid ${visibility === v ? 'var(--accent-primary)' : 'var(--border-subtle)'}`, background: visibility === v ? 'var(--accent-primary)0D' : 'transparent', color: visibility === v ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: 700, fontSize: '0.78rem', letterSpacing: '0.1em', cursor: loading ? 'not-allowed' : 'pointer', textTransform: 'uppercase' }}>
                    {t(`dashboard.modal.visibility_${v}`, v)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Upload Tab */}
        {tab === 'upload' && (
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); setFiles(Array.from(e.dataTransfer.files)); }}
            style={{ border: `2px dashed ${dragging ? 'var(--accent-primary)' : 'var(--border-subtle)'}`, borderRadius: '12px', padding: '40px', textAlign: 'center', background: dragging ? 'var(--accent-primary)0D' : 'transparent', transition: 'all 0.2s', cursor: 'pointer' }}
            onClick={() => document.getElementById('file-input')?.click()}
          >
            <FolderOpen size={32} color={dragging ? 'var(--accent-primary)' : 'var(--text-secondary)'} style={{ marginBottom: '12px' }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 4px' }}>
              {t('dashboard.modal.upload_drag_drop', 'Drag & drop files or click to browse')}
            </p>
            <p style={{ color: 'var(--text-secondary)', opacity: 0.6, fontSize: '0.75rem', margin: 0 }}>
              {t('dashboard.modal.upload_supported_formats', 'Supports .js .ts .py .java .go .rs and more')}
            </p>
            <input id="file-input" type="file" multiple style={{ display: 'none' }} onChange={e => setFiles(Array.from(e.target.files || []))} />
          </div>
        )}

        {/* Selected files list */}
        {tab === 'upload' && files.length > 0 && (
          <div style={{ marginTop: '12px', maxHeight: '100px', overflowY: 'auto' }}>
            {files.map((f, i) => (
              <div key={i} style={{ color: 'var(--accent-primary)', fontSize: '0.75rem', padding: '4px 0', borderBottom: '1px solid var(--border-subtle)' }}>📄 {f.name}</div>
            ))}
          </div>
        )}

        {/* Inline Error */}
        {error && (
          <div style={{ marginTop: '16px', padding: '12px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '8px', color: '#f87171', fontSize: '0.82rem', lineHeight: 1.5, wordBreak: 'break-word' }}>
            ⚠️ {error}
          </div>
        )}

        {/* Scan Button */}
        <button
          onClick={handleScan}
          disabled={!canSubmit || loading}
          className="btn-premium"
          style={{ width: '100%', marginTop: '24px', padding: '14px', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', opacity: (!canSubmit || loading) ? 0.5 : 1 }}>
          {loading ? (
            <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> {t('dashboard.modal.scanning_button', 'SCANNING...')}</>
          ) : (
            <>⚡ {t('dashboard.modal.initiate_scan_button', 'INITIATE SCAN')}</>
          )}
        </button>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      
      {/* UV Scan Progress Overlay */}
      <UVScanOverlay 
        isScanning={activeScan?.isScanning || false} 
        progress={activeScan?.progress || 0} 
        repoName={activeScan?.repoName || 'Repository'}
        scanId={activeScan?.scanId || ''}
        logs={activeScan?.logs || []}
        stats={activeScan?.stats || { filesScanned: 0, issuesFound: 0, status: 'PENDING', duration: '00:00' }}
        resultsSummary={activeScan?.resultsSummary}
        onClose={() => {
            clearScan();
            onClose();
        }}
        onRunInBackground={() => {
            updateScan({ isScanning: false });
            toast.success('Scan continuing in background. Check notifications for completion.', {
                icon: '🚀',
                duration: 5000
            });
            onClose();
        }}
        onCancel={() => {
            if (window.confirm('Are you sure you want to abort the current security scan?')) {
                failScan('Scan aborted by user.');
                toast.error('Scan protocol terminated.');
            }
        }}
      />
    </div>
  );
}
