import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white border border-transparent hover:brightness-110 disabled:hover:brightness-100',
  secondary:
    'bg-neutral-800 text-neutral-100 border border-neutral-700 hover:bg-neutral-700 disabled:hover:bg-neutral-800',
  ghost:
    'bg-transparent text-neutral-400 border border-transparent hover:text-[var(--text-primary)] hover:bg-neutral-800 disabled:hover:bg-transparent',
  destructive:
    'bg-severity-critical-bg text-severity-critical-fg border border-severity-critical-border hover:bg-severity-critical/20 disabled:hover:bg-severity-critical-bg',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1.5 text-[9px] gap-1.5',
  md: 'px-4 py-2 text-[10px] gap-2',
  lg: 'px-6 py-3 text-xs gap-2.5',
};

const ICON_ONLY_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'p-1.5',
  md: 'p-2',
  lg: 'p-3',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Square padding for icon-only buttons (e.g. a back arrow). */
  iconOnly?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', iconOnly = false, className = '', ...props },
  ref
) {
  const sizeClasses = iconOnly ? ICON_ONLY_SIZE_CLASSES[size] : SIZE_CLASSES[size];
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center font-bold uppercase tracking-wider rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${sizeClasses} ${className}`}
      {...props}
    />
  );
});

export default Button;
