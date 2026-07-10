import { Siren } from 'lucide-react';
import SoarPendingApprovals from './soar/SoarPendingApprovals';
import SoarPlaybooks from './soar/SoarPlaybooks';

export default function SoarPanel() {
  return (
    <div className="premium-card p-6 mt-8">
      <div className="flex items-center gap-3 mb-4">
        <Siren className="w-5 h-5 text-red-400" />
        <div>
          <h2 className="text-sm font-black uppercase italic tracking-wider text-[var(--text-primary)]">SOAR Response</h2>
          <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider font-mono mt-0.5">
            Falco-triggered playbooks — destructive actions require approval by default
          </p>
        </div>
      </div>

      <div className="mb-6">
        <SoarPendingApprovals />
      </div>
      <SoarPlaybooks />
    </div>
  );
}
