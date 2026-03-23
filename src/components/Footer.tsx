
export default function Footer() {
  return (
    <footer className="w-full relative bg-[#010c0f] overflow-hidden" style={{ minHeight: '400px' }}>
      {/* 1. BACKGROUND LAYER: Target Atmosphere */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_#0a2d34_0%,_#031d24_55%,_#000000_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_75%,_rgba(34,211,238,0.15)_0%,_transparent_60%)]" />

      <style>{`
        .scorpion-text-base {
          font-family: 'Inter', sans-serif;
          font-weight: 900;
          font-style: italic;
          color: #000000; /* TARGET MATCH: PURE BLACK */
          font-size: 8vw;
          line-height: 1;
          letter-spacing: -0.05em;
          text-align: center;
          width: 100%;
          pointer-events: none;
        }
      `}</style>

      {/* 2. TOP UI LAYER (Slogan & Nav) */}
      <div className="relative z-50 flex justify-between p-12 lg:p-24 items-start">
        <h2 className="text-white font-black text-7xl uppercase italic leading-[0.8] tracking-tighter">
          Automate<br />everything…<br />except your job!
        </h2>
        <div className="flex gap-20 text-right text-white font-bold uppercase italic text-sm tracking-widest">
          <div className="space-y-4">
            <p className="text-white/20 text-[10px] tracking-[0.5em]">Interface</p>
            <p className="cursor-pointer hover:text-cyan-400">Dashboard</p>
            <p className="cursor-pointer hover:text-cyan-400">Security</p>
            <p className="cursor-pointer hover:text-cyan-400">Reports</p>
          </div>
          <div className="space-y-4">
            <p className="text-white/20 text-[10px] tracking-[0.5em]">Network</p>
            <p className="cursor-pointer hover:text-cyan-400">Teams</p>
            <p className="cursor-pointer hover:text-cyan-400">Alerts</p>
          </div>
        </div>
      </div>

      {/* 3. WATERMARK LAYER */}
      <div className="absolute inset-0 flex items-center justify-center pt-20">
        <div className="absolute top-[70%] -translate-y-1/2 z-20 scorpion-text-base">
          SCORPION
        </div>
      </div>

      {/* 4. FINAL QUALITY BOTTOM BAR */}
      <div className="absolute bottom-0 w-full px-12 pb-12 z-50">
        <div className="flex justify-between items-center pt-8 border-t border-white/10">
          <span className="text-[11px] font-black tracking-[0.5em] text-white/40 uppercase italic">SCORPION CORE</span>
          <div className="flex items-center gap-8">
            <span className="text-[10px] font-black text-white/20 uppercase italic">Privacy Suite</span>
            <span className="text-[10px] font-black text-white/20 uppercase italic">Terms</span>
            <div className="flex items-center gap-2">
              <span className="text-cyan-400 text-3xl drop-shadow-[0_0_10px_cyan]">✦</span>
              <span className="text-white font-black italic">V1.0</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}