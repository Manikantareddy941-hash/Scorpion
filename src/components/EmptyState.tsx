import type { ComponentType, ReactNode } from 'react';

interface EmptyStateProps {
  icon: ComponentType<{ size?: number; className?: string }>;
  message: string;
  /** Optional secondary line of text below the message. */
  description?: string;
  /** Optional action (e.g. a "Clear filters" button) rendered below the message. */
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({ icon: Icon, message, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-16 ${className}`}>
      <Icon size={32} className="text-[var(--text-secondary)] opacity-30 mb-3" />
      <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest">{message}</p>
      {description && (
        <p className="text-[10px] text-[var(--text-secondary)] opacity-70 font-bold uppercase tracking-widest mt-2">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
