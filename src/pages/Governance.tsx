import { useEffect, useState } from 'react';
import { databases, DB_ID, ID, Query, COLLECTIONS } from '../lib/appwrite';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Code, Loader2, Save, ArrowLeft } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import Editor from '@monaco-editor/react';

export default function Governance() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { theme } = useTheme();
    const [policyCode, setPolicyCode] = useState<string>('');
    const [policyName, setPolicyName] = useState<string>('Custom Guardrails');
    const [savingPolicy, setSavingPolicy] = useState(false);
    const [policyDocId, setPolicyDocId] = useState<string | null>(null);

    const defaultPolicy = `check:\n  id: CKV_AWS_19\n  name: "Ensure all data stored in the S3 bucket is securely encrypted at rest"\n  supported_resources:\n    - aws_s3_bucket\n  categories:\n    - ENCRYPTION\n  type: Terraform\n  guideline: "It is a best practice to encrypt all data at rest in S3."\n`;

    useEffect(() => {
        if (!user) return;
        const fetchPolicies = async () => {
            try {
                const res = await databases.listDocuments(DB_ID, COLLECTIONS.POLICIES, [
                    Query.equal('userId', user.$id)
                ]);
                if (res.total > 0) {
                    setPolicyDocId(res.documents[0].$id);
                    setPolicyCode(res.documents[0].code);
                    setPolicyName(res.documents[0].name || 'Custom Guardrails');
                }
            } catch (e) {
                console.error('Error fetching policies', e);
            }
        };
        fetchPolicies();
    }, [user]);

    const handleSavePolicy = async () => {
        if (!user) return;
        setSavingPolicy(true);
        try {
            if (policyDocId) {
                await databases.updateDocument(DB_ID, COLLECTIONS.POLICIES, policyDocId, {
                    name: policyName,
                    code: policyCode,
                    isActive: true
                });
            } else {
                const res = await databases.createDocument(DB_ID, COLLECTIONS.POLICIES, ID.unique(), {
                    userId: user.$id,
                    name: policyName,
                    code: policyCode,
                    isActive: true
                });
                setPolicyDocId(res.$id);
            }
            alert('Security Policy committed successfully');
        } catch (error) {
            console.error('Failed to commit policy', error);
            alert('Failed to commit policy');
        } finally {
            setSavingPolicy(false);
        }
    };

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] p-8 text-[var(--text-primary)] transition-colors duration-300">
            <div className="max-w-6xl mx-auto">
                <div className="mb-12">
                    <button onClick={() => navigate('/')} className="mb-6 px-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-primary)]/50 transition-all flex items-center gap-2 group/btn w-fit">
                        <ArrowLeft className="w-3.5 h-3.5 group-hover/btn:-translate-x-1 transition-transform" />
                        Back to Dashboard
                    </button>
                    <h1 className="text-3xl font-black tracking-tighter italic uppercase leading-none">Infrastructure Governance</h1>
                    <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] mt-1 italic font-mono">
                        Global Security Policies
                    </p>
                </div>

                <div className="premium-card p-10">
                    <h3 className="text-xs font-black text-[var(--text-primary)] mb-8 uppercase tracking-[0.2em] italic flex items-center gap-3">
                        <Code className="w-4 h-4 text-[var(--accent-secondary)]" /> Global Security Policies
                    </h3>
                    <div className="flex justify-between items-center mb-6">
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic leading-relaxed max-w-2xl">
                            Define custom access control policies using a YAML-based checkov schema. These policies will be enforced across all connected repositories during routine scans.
                        </p>
                        <button onClick={() => setPolicyCode(defaultPolicy)} className="px-4 py-2 bg-[var(--text-primary)]/5 border border-[var(--border-subtle)] rounded-xl text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                            Load AWS S3 Template
                        </button>
                    </div>
                    <div className="mb-4">
                        <input 
                            type="text" 
                            value={policyName} 
                            onChange={(e) => setPolicyName(e.target.value)} 
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-3 text-xs font-black uppercase italic tracking-widest text-[var(--text-primary)] outline-none focus:border-[var(--accent-secondary)]/50 transition-colors"
                            placeholder="Policy Name"
                        />
                    </div>
                    <div className="h-[500px] mb-6 rounded-xl overflow-hidden border border-[var(--border-subtle)]">
                        <Editor
                            height="100%"
                            defaultLanguage="yaml"
                            value={policyCode}
                            onChange={(value) => setPolicyCode(value || '')}
                            theme={theme === 'dark' || theme === 'snow-dark' ? 'vs-dark' : 'vs-light'}
                            options={{
                                minimap: { enabled: false },
                                fontSize: 13,
                                wordWrap: 'on',
                                scrollBeyondLastLine: false,
                                automaticLayout: true,
                                tabSize: 2,
                                lineNumbersMinChars: 3,
                            }}
                        />
                    </div>
                    <div className="flex justify-end">
                        <button onClick={handleSavePolicy} className="btn-premium flex items-center gap-3">
                            {savingPolicy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Commit Policy
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
