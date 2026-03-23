import { useEffect, useState } from 'react';
import { databases, DB_ID, ID, Query, COLLECTIONS } from '../lib/appwrite';
import { useAuth } from '../contexts/AuthContext';
import { Bell, Loader2, Save, Send } from 'lucide-react';

export default function Alerts() {
    const { user } = useAuth();
    const [webhookUrl, setWebhookUrl] = useState('');
    const [isEnabled, setIsEnabled] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [docId, setDocId] = useState<string | null>(null);

    useEffect(() => {
        if (!user) return;
        const fetchIntegrations = async () => {
            try {
                const res = await databases.listDocuments(DB_ID, COLLECTIONS.INTEGRATIONS, [
                    Query.equal('userId', user.$id)
                ]);
                if (res.total > 0) {
                    setDocId(res.documents[0].$id);
                    setWebhookUrl(res.documents[0].webhookUrl);
                    setIsEnabled(res.documents[0].isEnabled);
                }
            } catch (e) {
                console.error('Error fetching integration', e);
            }
        };
        fetchIntegrations();
    }, [user]);

    const handleSave = async () => {
        if (!user) return;
        if (!webhookUrl) return alert('Please enter a Webhook URL.');
        setSaving(true);
        try {
            if (docId) {
                await databases.updateDocument(DB_ID, COLLECTIONS.INTEGRATIONS, docId, {
                    webhookUrl,
                    isEnabled
                });
            } else {
                const res = await databases.createDocument(DB_ID, COLLECTIONS.INTEGRATIONS, ID.unique(), {
                    userId: user.$id,
                    webhookUrl,
                    isEnabled
                });
                setDocId(res.$id);
            }
            alert('Discord Integration configuration saved successfully.');
        } catch (error) {
            console.error('Failed to commit integration', error);
            alert('Failed to save integration settings.');
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async () => {
        if (!webhookUrl) return alert('Please input and save a valid Discord Webhook URL first.');
        setTesting(true);
        try {
            const payload = {
                embeds: [{
                    title: "🦂 SCORPION: Secure Comlink Established",
                    description: "The realtime security telemetry bridge between SCORPION and this Discord channel is fully operational.",
                    color: 3652856
                }]
            };
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (response.ok || response.status === 204) {
                alert('Test payload dispatched successfully. Check your Discord channel!');
            } else {
                alert(`Test transmission failed. Server responded with HTTP ${response.status}.`);
            }
        } catch (err: any) {
            alert('Test payload dispatch failed. Verify CORS compatibility or invalid string: ' + err.message);
        } finally {
            setTesting(false);
        }
    };

    return (
        <div className="min-h-screen bg-[var(--bg-primary)] p-8 text-[var(--text-primary)] transition-colors duration-300">
            <div className="max-w-4xl mx-auto">
                <div className="mb-12">
                    <h1 className="text-3xl font-black tracking-tighter italic uppercase leading-none">Security Alerts Pipeline</h1>
                    <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] mt-1 italic font-mono">
                        Discord Webhook Integration
                    </p>
                </div>

                <div className="premium-card p-10">
                    <h3 className="text-xs font-black text-[var(--text-primary)] mb-8 uppercase tracking-[0.2em] italic flex items-center gap-3">
                        <Bell className="w-4 h-4 text-[var(--accent-secondary)]" /> Webhook Integrations
                    </h3>
                    <div className="mb-6">
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic leading-relaxed max-w-2xl mb-8">
                            Configure an active Discord Webhook below. SCORPION will instantly broadcast aggressive "Rich Embed" payloads directly into your channel the exact second a Critical Vulnerability or active Guardrail Policy Breach is detected across your infrastructure surface.
                        </p>
                        
                        <label className="flex items-center gap-3 mb-6 cursor-pointer w-fit opacity-80 hover:opacity-100 transition-opacity">
                            <input 
                                type="checkbox" 
                                checked={isEnabled} 
                                onChange={(e) => setIsEnabled(e.target.checked)} 
                                className="accent-[var(--accent-primary)] w-5 h-5"
                            />
                            <span className="text-sm font-black uppercase italic tracking-widest">Enable Realtime Event Broadcasts</span>
                        </label>

                        <input 
                            type="text" 
                            value={webhookUrl} 
                            onChange={(e) => setWebhookUrl(e.target.value)} 
                            className="w-full bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl px-4 py-4 text-xs font-black italic tracking-widest text-[var(--text-primary)] outline-none focus:border-[var(--accent-secondary)]/50 transition-colors"
                            placeholder="https://discord.com/api/webhooks/..."
                        />
                    </div>
                    
                    <div className="flex flex-col sm:flex-row justify-between items-center mt-8 gap-4">
                        <button 
                            onClick={handleTest} 
                            disabled={testing || !webhookUrl}
                            className="w-full sm:w-auto px-6 py-3 bg-[var(--bg-secondary)] border-2 border-[var(--border-subtle)] hover:border-[var(--accent-primary)] hover:text-white rounded-xl font-black uppercase italic tracking-widest text-[11px] transition-all flex items-center justify-center gap-3"
                        >
                            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            Test Transmission
                        </button>

                        <button 
                            onClick={handleSave} 
                            disabled={saving}
                            className="w-full sm:w-auto btn-premium flex items-center justify-center gap-3 disabled:opacity-50"
                        >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Commit Configuration
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
