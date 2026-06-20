import React, { useEffect, useRef, useState } from 'react';
import echoIcon from '../../assets/echo-ai.png';

type EchoStatus = 'online' | 'busy' | 'offline';

interface EchoFABProps {
  onClick?: () => void;
  status?: EchoStatus;
  /** Whether the Echo panel this button controls is currently open. */
  open?: boolean;
  /** When true, Echo can be dragged anywhere on screen and remembers its position. When false, it locks to the bottom-right corner. */
  freeRoam?: boolean;
  className?: string;
}

const statusColor: Record<EchoStatus, string> = {
  online: 'var(--severity-low)',
  busy: 'var(--severity-medium)',
  offline: 'var(--severity-critical)',
};

const SIZE = 56; // w-14 h-14
const MARGIN = 24; // bottom-6 / right-6
const HEADER_SAFE_TOP = 80; // keeps the FAB clear of the top navbar (h-16) regardless of stored position
const STORAGE_KEY = 'echoFabPosition';
const DRAG_THRESHOLD = 4;

const defaultPosition = () => ({
  x: window.innerWidth - SIZE - MARGIN,
  y: window.innerHeight - SIZE - MARGIN,
});

const isWithinSafeBounds = (pos: { x: number; y: number }) =>
  pos.y >= HEADER_SAFE_TOP && pos.x >= 0 && pos.y <= window.innerHeight - SIZE;

const EchoFAB: React.FC<EchoFABProps> = ({ onClick, status = 'online', open = false, freeRoam = true, className = '' }) => {
  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') return { x: 0, y: 0 };
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (isWithinSafeBounds(parsed)) return parsed;
      }
    } catch {}
    return defaultPosition();
  });

  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!freeRoam) return;
    draggingRef.current = true;
    movedRef.current = false;
    dragOffsetRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };

  useEffect(() => {
    if (!freeRoam) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const dx = Math.abs(e.clientX - (dragOffsetRef.current.x + position.x));
      const dy = Math.abs(e.clientY - (dragOffsetRef.current.y + position.y));
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) movedRef.current = true;

      const nextX = Math.min(Math.max(0, e.clientX - dragOffsetRef.current.x), window.innerWidth - SIZE);
      const nextY = Math.min(Math.max(HEADER_SAFE_TOP, e.clientY - dragOffsetRef.current.y), window.innerHeight - SIZE);
      setPosition({ x: nextX, y: nextY });
    };

    const handleMouseUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setPosition((prev: { x: number; y: number }) => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(prev));
        } catch {}
        return prev;
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [freeRoam, position.x, position.y]);

  const handleClick = () => {
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    onClick?.();
  };

  const positionStyle: React.CSSProperties = freeRoam
    ? { position: 'fixed', left: position.x, top: position.y, zIndex: 9999, cursor: draggingRef.current ? 'grabbing' : 'grab' }
    : { position: 'fixed', bottom: MARGIN, right: MARGIN, zIndex: 9999 };

  return (
    <button
      type="button"
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      aria-label="Open Echo AI assistant"
      className={`group ${className}`}
      style={positionStyle}
    >
      <span
        className="absolute inset-0 rounded-full animate-ping"
        style={{ backgroundColor: 'var(--accent-primary)', opacity: 0.25 }}
      />
      <span
        className="absolute inset-0 rounded-full animate-ping"
        style={{ backgroundColor: 'var(--accent-primary)', opacity: 0.15, animationDelay: '0.6s' }}
      />
      <span
        className={`relative flex items-center justify-center w-14 h-14 rounded-full transition-all duration-300 group-hover:scale-105 ${open ? 'scale-105' : ''}`}
        style={{
          background: 'transparent',
          boxShadow: '0 0 18px color-mix(in srgb, var(--accent-primary) 55%, transparent)',
        }}
      >
        <img src={echoIcon} alt="Echo AI" style={{ width: 48, height: 48, background: 'transparent' }} draggable={false} />
        <span
          className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full border-2"
          style={{ backgroundColor: statusColor[status], borderColor: 'var(--bg-card)' }}
        />
      </span>
    </button>
  );
};

export default EchoFAB;
