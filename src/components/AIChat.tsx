import React, { useState } from 'react';

type AIChatProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const AIChat: React.FC<AIChatProps> = ({ open, setOpen }) => {
  const [isVoiceActive, setIsVoiceActive] = useState(false);

  return (
    <div className={`fixed inset-0 ${open ? 'flex' : 'hidden'} bg-white dark:bg-gray-900 z-50`}> 
      {/* TOP FEATURE BAR - AI CHAT INTERFACE */}
      <div className="w-full flex justify-between items-center border-b border-[#e6e2da]/60 pb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono text-emerald-600 animate-pulse">●</span>
          <h2 className="text-xs font-bold tracking-widest uppercase font-mono text-[#2d3728]">
            🤖 ECHO AI ENGINE
          </h2>
        </div>
        {/* The Spherical Voice Orb Logo Replacement */}
        <div className="relative w-7 h-7 flex items-center justify-center select-none">
          <img
            src={isVoiceActive ? '/images/active_orb.png' : '/images/idle_orb.png'}
            alt="Voice Orb"
            className={`w-full h-full object-contain transition-transform duration-300 ${
              isVoiceActive ? 'scale-110 filter drop-shadow-[0_0_6px_rgba(16,185,129,0.25)]' : 'scale-100'
            }`}
          />
          {/* Micro active state ring indicator */}
          {isVoiceActive && (
            <span className="absolute inset-0 rounded-full border border-emerald-400/40 animate-ping pointer-events-none" />
          )}
        </div>
      </div>
      {/* Placeholder for chat content */}
      <div className="flex-1 p-4 overflow-auto">
        {/* Chat messages and input go here */}
      </div>
    </div>
  );
};

export default AIChat;
