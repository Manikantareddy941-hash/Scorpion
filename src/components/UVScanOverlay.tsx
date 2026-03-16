import { useEffect, useState } from 'react';
import { Shield, Radio, Zap } from 'lucide-react';

export default function UVScanOverlay({ isScanning, onClose }: { isScanning: boolean; onClose: () => void }) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (isScanning) {
      setActive(true);
      const timer = setTimeout(() => {
        setActive(false);
        onClose();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [isScanning, onClose]);

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-[#E8440A]/10 backdrop-blur-sm flex items-center justify-center overflow-hidden animate-in fade-in duration-500">
      {/* Sweeping Beam */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-[30%] bg-gradient-to-b from-transparent via-[#E8440A]/20 to-transparent animate-scan" style={{ top: '-100%' }} />
      </div>

      <div className="relative z-10 flex flex-col items-center">
        <div className="relative mb-12">
            <div className="absolute inset-0 bg-[#E8440A] blur-[100px] opacity-20 animate-pulse" />
            <div className="relative bg-[#0D0D0D] p-12 rounded-[3.5rem] border border-[#E8440A]/30 shadow-[0_0_100px_rgba(232,68,10,0.2)]">
                <Shield className="w-24 h-24 text-[#E8440A] animate-spin-slow" />
            </div>
            {/* Pulsing Rings */}
            <div className="absolute inset-0 border-2 border-[#E8440A]/20 rounded-[3.5rem] scale-110 animate-ping opacity-20" />
            <div className="absolute inset-0 border-2 border-[#E8440A]/10 rounded-[4.5rem] scale-125 animate-ping opacity-10" style={{ animationDelay: '0.5s' }} />
        </div>

        <div className="text-center space-y-6">
            <h2 className="text-6xl font-black text-white italic tracking-tighter uppercase leading-none">Initializing UV Mode</h2>
            <div className="flex items-center justify-center gap-6">
                <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-[#E8440A] animate-pulse" />
                    <span className="text-[10px] font-black text-[#666666] uppercase tracking-[0.3em]">Neural Scanning</span>
                </div>
                <div className="w-1 h-1 bg-[#444444] rounded-full" />
                <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-[#E8440A] animate-pulse" />
                    <span className="text-[10px] font-black text-[#666666] uppercase tracking-[0.3em]">Perimeter Integrity</span>
                </div>
            </div>
            
            <div className="max-w-md mx-auto mt-12 bg-[#0D0D0D]/50 border border-[#1E1E1E] p-2 rounded-full overflow-hidden">
                <div className="h-1 bg-[#E8440A] rounded-full animate-loading-bar" style={{ width: '40%' }} />
            </div>
            <p className="text-[10px] font-black text-[#444444] uppercase tracking-widest italic mt-4 animate-pulse">Analyzing codebase for dormant entropy clusters...</p>
        </div>
      </div>
    </div>
  );
}
