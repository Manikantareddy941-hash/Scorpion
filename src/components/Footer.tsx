export default function Footer() {
  return (
    <footer 
      className="w-full py-24 px-12 lg:px-24 flex flex-col font-sans transition-all duration-300 relative overflow-hidden"
      style={{ 
        background: 'var(--bg-primary)',
        borderTop: '1px solid var(--border-subtle)'
      }}
    >
      {/* Top Section: Tagline & Nav Grid */}
      <div className="flex justify-between items-start mb-32 relative z-10">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-[var(--text-primary)] opacity-20">Global Security Core</span>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-primary)] opacity-60">Experience Liftoff</span>
        </div>

        <div className="grid grid-cols-2 gap-16 md:gap-24">
          <div className="flex flex-col gap-4">
            {['Download', 'Product', 'Docs', 'Changelog', 'Press', 'Releases'].map((link) => (
              <span 
                key={link} 
                className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-primary)] opacity-50 cursor-pointer hover:text-[var(--accent-primary)] hover:opacity-100 transition-all whitespace-nowrap"
              >
                {link}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-4">
            {['Blog', 'Pricing', 'Use Cases'].map((link) => (
              <span 
                key={link} 
                className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50 cursor-pointer hover:text-white hover:opacity-100 transition-all whitespace-nowrap"
              >
                {link}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Main Feature: Giant Typography */}
      <div className="w-full mb-20 flex justify-center relative z-10">
        <h1 
          className="leading-[0.85] tracking-[-0.05em] uppercase select-none m-0 p-0 text-center font-bold text-[var(--text-primary)] opacity-25"
          style={{ fontSize: 'clamp(80px, 15vw, 200px)' }}
        >
          SCORPION
        </h1>
      </div>

      {/* Bottom Section: Brand & Legal */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-8 pt-12 border-t border-[var(--border-subtle)] relative z-10">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--text-primary)] opacity-40">SCORPION V1.0</span>
        </div>
        
        <div className="flex gap-12 text-[10px] font-bold uppercase tracking-[0.2em]">
          {['About', 'Privacy', 'Terms'].map((link) => (
            <span 
              key={link} 
              className="text-[var(--text-primary)] opacity-40 cursor-pointer hover:text-[var(--accent-primary)] hover:opacity-100 transition-all font-bold"
            >
              {link}
            </span>
          ))}
        </div>
      </div>
    </footer>
  );
}
