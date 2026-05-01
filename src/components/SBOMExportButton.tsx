import React, { useState } from 'react';
import { Download, ChevronDown, Loader2, FileJson, FileSpreadsheet } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

interface SBOMExportButtonProps {
    repoId: string;
    repoName: string;
}

export default function SBOMExportButton({ repoId, repoName }: SBOMExportButtonProps) {
    const [loading, setLoading] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const { getJWT } = useAuth();

    const handleDownload = async (format: 'json' | 'csv') => {
        setLoading(true);
        setShowMenu(false);
        try {
            const jwt = await getJWT();
            const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/sbom/${repoId}?format=${format}`, {
                headers: {
                    'Authorization': `Bearer ${jwt}`
                }
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to generate SBOM');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `sbom_${repoName.replace(/\s+/g, '_')}.${format}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            toast.success(`SBOM (${format.toUpperCase()}) exported successfully`);
        } catch (err: any) {
            console.error('SBOM Export Error:', err);
            toast.error(err.message || 'Failed to export SBOM');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative inline-flex h-10">
            <button
                onClick={() => handleDownload('json')}
                disabled={loading}
                className="flex items-center gap-2 px-4 h-full bg-[var(--accent-primary)] text-white text-[10px] font-black uppercase tracking-widest rounded-l-xl hover:opacity-90 disabled:opacity-50 transition-all border-r border-white/20"
            >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {loading ? 'Generating...' : 'Export SBOM'}
            </button>
            <button
                onClick={() => setShowMenu(!showMenu)}
                disabled={loading}
                className="px-2 h-full bg-[var(--accent-primary)] text-white rounded-r-xl hover:opacity-90 disabled:opacity-50 transition-all"
            >
                <ChevronDown className={`w-4 h-4 transition-transform ${showMenu ? 'rotate-180' : ''}`} />
            </button>

            {showMenu && (
                <div className="absolute top-full left-0 mt-2 w-48 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl shadow-2xl z-[100] overflow-hidden animate-in fade-in slide-in-from-top-2">
                    <button
                        onClick={() => handleDownload('json')}
                        className="w-full flex items-center gap-3 px-4 py-3 text-[10px] font-bold text-[var(--text-primary)] hover:bg-[var(--accent-primary)]/10 transition-colors border-b border-[var(--border-subtle)]"
                    >
                        <FileJson className="w-4 h-4 text-amber-400" />
                        JSON Format (CycloneDX)
                    </button>
                    <button
                        onClick={() => handleDownload('csv')}
                        className="w-full flex items-center gap-3 px-4 py-3 text-[10px] font-bold text-[var(--text-primary)] hover:bg-[var(--accent-primary)]/10 transition-colors"
                    >
                        <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                        CSV Summary
                    </button>
                </div>
            )}
        </div>
    );
}
