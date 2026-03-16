import { useState } from 'react';
import { X, Github, Upload, FolderOpen } from 'lucide-react';

interface Props {
  onClose: () => void;
  onScan: (data: { type: 'github' | 'upload'; value: string | File[] }) => void;
}

export default function NewScanModal({ onClose, onScan }: Props) {
  const [tab, setTab] = useState<'github' | 'upload'>('github');
  const [repoUrl, setRepoUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  const handleScan = () => {
    if (tab === 'github' && repoUrl.trim()) {
      onScan({ type: 'github', value: repoUrl.trim() });
    } else if (tab === 'upload' && files.length > 0) {
      onScan({ type: 'upload', value: files });
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#141414', border: '1px solid #1E1E1E', borderRadius: '16px', width: '520px', maxWidth: '95vw', padding: '32px', position: 'relative' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h2 style={{ color: '#E8440A', fontWeight: 800, fontSize: '1.2rem', letterSpacing: '0.1em', margin: 0 }}>NEW SCAN</h2>
            <p style={{ color: '#666', fontSize: '0.8rem', margin: '4px 0 0' }}>Upload code or connect a GitHub repository</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={20} /></button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          {(['github', 'upload'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ flex: 1, padding: '10px', borderRadius: '8px', border: `1px solid ${tab === t ? '#E8440A' : '#1E1E1E'}`, background: tab === t ? 'rgba(232,68,10,0.1)' : 'transparent', color: tab === t ? '#E8440A' : '#666', fontWeight: 700, fontSize: '0.8rem', letterSpacing: '0.1em', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              {t === 'github' ? <><Github size={16} /> GITHUB REPO</> : <><Upload size={16} /> LOCAL FILES</>}
            </button>
          ))}
        </div>

        {/* GitHub Tab */}
        {tab === 'github' && (
          <div>
            <label style={{ color: '#666', fontSize: '0.75rem', letterSpacing: '0.1em', display: 'block', marginBottom: '8px' }}>REPOSITORY URL</label>
            <input
              type="text"
              placeholder="https://github.com/username/repository"
              value={repoUrl}
              onChange={e => setRepoUrl(e.target.value)}
              style={{ width: '100%', background: '#0D0D0D', border: '1px solid #1E1E1E', borderRadius: '8px', padding: '12px', color: '#fff', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
            />
            <p style={{ color: '#444', fontSize: '0.75rem', marginTop: '8px' }}>Supports public and private repositories</p>
          </div>
        )}

        {/* Upload Tab */}
        {tab === 'upload' && (
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); setFiles(Array.from(e.dataTransfer.files)); }}
            style={{ border: `2px dashed ${dragging ? '#E8440A' : '#1E1E1E'}`, borderRadius: '12px', padding: '40px', textAlign: 'center', background: dragging ? 'rgba(232,68,10,0.05)' : 'transparent', transition: 'all 0.2s', cursor: 'pointer' }}
            onClick={() => document.getElementById('file-input')?.click()}
          >
            <FolderOpen size={32} color={dragging ? '#E8440A' : '#444'} style={{ marginBottom: '12px' }} />
            <p style={{ color: '#666', fontSize: '0.85rem', margin: '0 0 4px' }}>Drag & drop files or click to browse</p>
            <p style={{ color: '#444', fontSize: '0.75rem', margin: 0 }}>Supports .js .ts .py .java .go .rs and more</p>
            <input id="file-input" type="file" multiple style={{ display: 'none' }} onChange={e => setFiles(Array.from(e.target.files || []))} />
          </div>
        )}

        {/* Selected files list */}
        {tab === 'upload' && files.length > 0 && (
          <div style={{ marginTop: '12px', maxHeight: '100px', overflowY: 'auto' }}>
            {files.map((f, i) => (
              <div key={i} style={{ color: '#E8440A', fontSize: '0.75rem', padding: '4px 0', borderBottom: '1px solid #1E1E1E' }}>📄 {f.name}</div>
            ))}
          </div>
        )}

        {/* Scan Button */}
        <button
          onClick={handleScan}
          disabled={tab === 'github' ? !repoUrl.trim() : files.length === 0}
          style={{ width: '100%', marginTop: '24px', padding: '14px', background: '#E8440A', border: 'none', borderRadius: '8px', color: 'white', fontWeight: 800, fontSize: '0.9rem', letterSpacing: '0.15em', cursor: 'pointer', opacity: (tab === 'github' ? !repoUrl.trim() : files.length === 0) ? 0.4 : 1, transition: 'opacity 0.2s' }}>
          ⚡ INITIATE SCAN
        </button>
      </div>
    </div>
  );
}
