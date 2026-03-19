import { useState } from 'react';
import { X, Github, Upload, FolderOpen, Loader2 } from 'lucide-react';
import { functions, FUNCTION_ID } from '../lib/appwrite';
import { ExecutionMethod } from 'appwrite';

interface Props {
  onClose: () => void;
  onScan: (data: { type: 'github' | 'upload'; value: string | File[] }) => void;
}

export default function NewScanModal({ onClose, onScan }: Props) {
  const [tab, setTab] = useState<'github' | 'upload'>('github');
  const [repoUrl, setRepoUrl] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    if (tab === 'upload' && files.length > 0) {
      onScan({ type: 'upload', value: files });
      return;
    }

    if (!repoUrl.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const execution = await functions.createExecution(
        FUNCTION_ID,
        JSON.stringify({ repoUrl: repoUrl.trim(), visibility }),
        false,
        '/',
        ExecutionMethod.POST,
        { 'Content-Type': 'application/json' }
      );

      // The function responded — check if it returned an error payload
      if (execution.responseStatusCode && execution.responseStatusCode >= 400) {
        let msg = `Scan failed (HTTP ${execution.responseStatusCode})`;
        try {
          const body = JSON.parse(execution.responseBody);
          if (body?.error) msg = body.error;
        } catch (_) {}
        setError(msg);
        setLoading(false);
        return;
      }

      // Parse the response body for any application-level error
      try {
        const body = JSON.parse(execution.responseBody);
        if (body?.success === false) {
          setError(body.error || 'Scan failed with an unknown error.');
          setLoading(false);
          return;
        }
      } catch (_) {}

      // Success — propagate up and close
      onScan({ type: 'github', value: repoUrl.trim() });
      onClose();
    } catch (err: any) {
      const message =
        err?.response?.message ||
        err?.message ||
        'An unexpected error occurred. Please try again.';
      setError(message);
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
            <h2 style={{ color: 'var(--accent-primary)', fontWeight: 800, fontSize: '1.2rem', letterSpacing: '0.1em', margin: 0 }}>NEW SCAN</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '4px 0 0' }}>Upload code or connect a GitHub repository</p>
          </div>
          <button onClick={onClose} disabled={loading} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: loading ? 'not-allowed' : 'pointer' }}><X size={20} /></button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          {(['github', 'upload'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setError(null); }}
              disabled={loading}
              style={{ flex: 1, padding: '10px', borderRadius: '8px', border: `1px solid ${tab === t ? 'var(--accent-primary)' : 'var(--border-subtle)'}`, background: tab === t ? 'var(--accent-primary)0D' : 'transparent', color: tab === t ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: 700, fontSize: '0.8rem', letterSpacing: '0.1em', cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              {t === 'github' ? <><Github size={16} /> GITHUB REPO</> : <><Upload size={16} /> LOCAL FILES</>}
            </button>
          ))}
        </div>

        {/* GitHub Tab */}
        {tab === 'github' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', letterSpacing: '0.1em', display: 'block', marginBottom: '8px' }}>REPOSITORY URL</label>
              <input
                type="text"
                placeholder="https://github.com/username/repository"
                value={repoUrl}
                onChange={e => { setRepoUrl(e.target.value); setError(null); }}
                disabled={loading}
                style={{ width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '12px', color: 'var(--text-primary)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box', opacity: loading ? 0.6 : 1 }}
              />
            </div>
            <div>
              <label style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', letterSpacing: '0.1em', display: 'block', marginBottom: '8px' }}>VISIBILITY</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {(['public', 'private'] as const).map(v => (
                  <button key={v} onClick={() => setVisibility(v)} disabled={loading}
                    style={{ flex: 1, padding: '10px', borderRadius: '8px', border: `1px solid ${visibility === v ? 'var(--accent-primary)' : 'var(--border-subtle)'}`, background: visibility === v ? 'var(--accent-primary)0D' : 'transparent', color: visibility === v ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: 700, fontSize: '0.78rem', letterSpacing: '0.1em', cursor: loading ? 'not-allowed' : 'pointer', textTransform: 'uppercase' }}>
                    {v}
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
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 4px' }}>Drag & drop files or click to browse</p>
            <p style={{ color: 'var(--text-secondary)', opacity: 0.6, fontSize: '0.75rem', margin: 0 }}>Supports .js .ts .py .java .go .rs and more</p>
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
            <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> SCANNING...</>
          ) : (
            <>⚡ INITIATE SCAN</>
          )}
        </button>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
