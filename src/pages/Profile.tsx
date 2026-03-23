import { useAuth } from '../contexts/AuthContext';
import { User, Mail, Shield, ShieldCheck, LogOut, ArrowLeft, Calendar, Edit3, Terminal } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Profile() {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] p-8 text-[var(--text-primary)] transition-colors duration-300">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-5">
            <div className="w-14 h-14 bg-[var(--accent-primary)] rounded-2xl flex items-center justify-center text-white shadow-xl shadow-[var(--accent-primary)]/20">
                <User className="w-7 h-7" />
            </div>
            <div>
                <h1 className="text-3xl font-black tracking-tighter italic uppercase leading-none">Operator Profile</h1>
                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-[0.2em] mt-1 italic font-mono">Neural Identity & Access Rights</p>
            </div>
          </div>
          <Link to="/" className="flex items-center gap-2 text-xs font-black text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-all uppercase tracking-widest italic leading-none">
            <ArrowLeft className="w-4 h-4" />
            Control Deck
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Left Col: Avatar & Status */}
          <div className="md:col-span-1 space-y-6">
            <div className="premium-card p-10 flex flex-col items-center text-center">
              <div className="w-24 h-24 rounded-[2rem] bg-[var(--accent-primary)] flex items-center justify-center text-white text-4xl font-black italic shadow-2xl shadow-[var(--accent-primary)]/40 mb-6 relative group overflow-hidden">
                {user?.name?.charAt(0).toUpperCase()}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
                  <Edit3 className="w-6 h-6 text-white" />
                </div>
              </div>
              <h2 className="text-xl font-black tracking-tight uppercase italic mb-1">{user?.name}</h2>
              <p className="text-[10px] font-black text-[var(--accent-primary)] uppercase tracking-widest italic mb-6">Security Operator</p>
              
              <div className="w-full pt-6 border-t border-[var(--border-subtle)]">
                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest italic mb-2">
                  <span className="text-[var(--text-secondary)]">Trust Level</span>
                  <span className="text-[var(--status-success)]">Verified</span>
                </div>
                <div className="w-full h-1.5 bg-[var(--bg-secondary)] rounded-full overflow-hidden border border-[var(--border-subtle)]">
                  <div className="h-full bg-[var(--status-success)] w-full shadow-[0_0_8px_var(--status-success)]" />
                </div>
              </div>
            </div>

            <button onClick={signOut} className="w-full p-4 bg-[var(--status-error)]/10 text-[var(--status-error)] border border-[var(--status-error)]/20 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-[var(--status-error)] hover:text-white transition-all shadow-xl shadow-[var(--status-error)]/5 flex items-center justify-center gap-3 group">
              <LogOut className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              Terminate Session
            </button>
          </div>

          {/* Right Col: Details */}
          <div className="md:col-span-2 space-y-6">
            <div className="premium-card p-10">
              <h3 className="text-xs font-black text-[var(--text-secondary)] uppercase tracking-[0.2em] mb-8 italic flex items-center gap-3">
                <ShieldCheck className="w-4 h-4 text-[var(--accent-primary)]" /> System Identification
              </h3>
              
              <div className="space-y-6">
                {[
                  { label: 'Operator ID', value: user?.$id, icon: Terminal },
                  { label: 'Comm Channel', value: user?.email, icon: Mail },
                  { label: 'Registry Name', value: user?.name, icon: User },
                  { label: 'Initial Uplink', value: user?.$createdAt ? new Date(user.$createdAt).toLocaleDateString() : 'N/A', icon: Calendar },
                  { label: 'Last Sync', value: user?.$updatedAt ? new Date(user.$updatedAt).toLocaleDateString() : 'N/A', icon: Shield },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="flex items-center justify-between p-5 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-subtle)] group hover:border-[var(--accent-primary)]/30 transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-[var(--bg-primary)] flex items-center justify-center text-[var(--text-secondary)] group-hover:text-[var(--accent-primary)] transition-colors border border-[var(--border-subtle)]">
                        <Icon size={18} />
                      </div>
                      <div>
                        <p className="text-[9px] font-black text-[var(--text-secondary)] uppercase tracking-widest mb-0.5">{label}</p>
                        <p className="text-xs font-black text-[var(--text-primary)] lowercase tracking-tight font-mono">{value}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="premium-card p-10 border-dashed">
              <div className="flex items-center gap-6">
                <div className="w-12 h-12 bg-[var(--accent-primary)]/10 rounded-2xl flex items-center justify-center text-[var(--accent-primary)] border border-[var(--accent-primary)]/20">
                  <Shield size={24} />
                </div>
                <div>
                  <h4 className="text-sm font-black uppercase italic tracking-tight mb-1">Clearance Protocol</h4>
                  <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic leading-relaxed">Level 4 access granted. All encrypted vectors are visible. Standard monitoring applies.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
