import { useState } from 'react';
import { X, Github, Upload, FolderOpen, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import UVScanOverlay from './UVScanOverlay';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

interface Props {
  onClose: () => void;
  onScan: (data: { type: 'github' | 'upload'; value: string | File[] }) => void;
}

export default function NewScanModal({ onClose, onScan }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'github' | 'upload'>('github');
  const [repoUrl, setRepoUrl] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // UV Scan State
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scanId, setScanId] = useState<string | null>(null);
  
  const { user, getJWT } = useAuth();
  const navigate = useNavigate();

  const pollScanStatus = async (id: string, token: string) => {
    const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    let pollCount = 0;
    
    const interval = setInterval(async () => {
      try {
        pollCount++;
        const res = await fetch(`${apiBase}/api/repos/scans/${id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        // Progress mapping based on status
        if (data.status === 'completed') {
          setProgress(100);
          clearInterval(interval);
          setTimeout(() => {
            setIsScanning(false);
            onClose();
          }, 1000);
        } else if (data.status === 'failed') {
          clearInterval(interval);
          setIsScanning(false);
          setError(data.error || t('dashboard.modal.scan_execution_failed', 'Scan execution failed'));
        } else {
          // Dynamic progress based on status strings from backend
          switch(data.status) {
            case 'queued': setProgress(Math.min(15 + pollCount, 25)); break;
            case 'cloning': setProgress(Math.min(30 + pollCount, 45)); break;
            case 'scanning': setProgress(Math.min(50 + pollCount, 75)); break;
            case 'analyzing': setProgress(Math.min(80 + pollCount, 95)); break;
            default: setProgress(prev => Math.min(prev + 1, 90));
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
    setIsScanning(true);
    setProgress(5);
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
      
      if (scanData.scanId) {
        setScanId(scanData.scanId);
        setProgress(15);
        pollScanStatus(scanData.scanId, token);
      } else {
        throw new Error(scanData.error || t('dashboard.modal.scan_initiate_failed', 'Failed to initiate scan'));
      }
    } catch (err: any) {
      setError(err.message || t('dashboard.modal.scan_start_failed', 'Failed to start scan'));
      setIsScanning(false);
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = tab === 'github' ? !!repoUrl.trim() : files.length > 0;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '16px', width: '520px', maxWidth: '95vw', padding: '32px', position: 'relative' }}>

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
          style={{ width: '100%', marginTop: '24px', padding: '14px', background: 'var(--accent-primary)', border: 'none', borderRadius: '8px', color: 'white', fontWeight: 800, fontSize: '0.9rem', letterSpacing: '0.15em', cursor: (!canSubmit || loading) ? 'not-allowed' : 'pointer', opacity: (!canSubmit || loading) ? 0.5 : 1, transition: 'opacity 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
          {loading ? (
            <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> {t('dashboard.modal.scanning_button', 'SCANNING...')}</>
          ) : (
            <>⚡ {t('dashboard.modal.initiate_scan_button', 'INITIATE SCAN')}</>
          )}
        </button>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      
      {/* UV Scan Progress Overlay */}
      <UVScanOverlay isScanning={isScanning} progress={progress} />
    </div>
  );
}
