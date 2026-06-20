import React from 'react';

interface PlateProps {
  /** Small mono eyebrow label above the title, e.g. a status word or count. */
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  /** Right-aligned slot in the header row — a badge, a link, a live indicator. */
  headerRight?: React.ReactNode;
  /** Tints the corner ticks — defaults to the theme accent, pass 'critical' to flag the plate. */
  tone?: 'accent' | 'critical';
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

/** The base surface of the console: flat plate, seam border, corner ticks instead of a shadow. */
const Plate: React.FC<PlateProps> = ({ eyebrow, title, headerRight, tone = 'accent', children, className = '', onClick }) => {
  return (
    <div
      onClick={onClick}
      className={`plate ${tone === 'critical' ? 'plate-strike' : ''} p-5 ${onClick ? 'cursor-pointer interactive' : ''} ${className}`}
    >
      {(title || headerRight) && (
        <div className="flex items-start justify-between gap-3 mb-4 pb-3 border-b border-[var(--border-subtle)]">
          <div className="min-w-0">
            {eyebrow && <div className="plate-eyebrow mb-1">{eyebrow}</div>}
            {title && <h3 className="plate-header truncate">{title}</h3>}
          </div>
          {headerRight && <div className="shrink-0">{headerRight}</div>}
        </div>
      )}
      {children}
    </div>
  );
};

export default Plate;
