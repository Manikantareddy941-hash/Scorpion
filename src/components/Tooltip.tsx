import React, { useState } from 'react';

interface TooltipProps {
  children: React.ReactElement;
  content: string;
  wrapperClassName?: string;
}

export const Tooltip = ({ children, content, wrapperClassName = '' }: TooltipProps) => {
  const [visible, setVisible] = useState(false);

  return (
    <div 
      className={`relative flex items-center justify-center group ${wrapperClassName}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      
      {visible && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-48 p-2 rounded-lg text-[11px] font-medium leading-normal bg-zinc-900/95 text-white border border-white/10 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 text-center pointer-events-none">
          {content}
          {/* Tooltip Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-900/95" />
        </div>
      )}
    </div>
  );
};
