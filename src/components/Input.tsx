import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

type InputSize = 'sm' | 'md';

const SIZE_CLASSES: Record<InputSize, string> = {
  sm: 'px-3 py-1.5 text-[10px]',
  md: 'px-4 py-2.5 text-xs',
};

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  size?: InputSize;
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', className = '', ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={`bg-neutral-900 border border-neutral-800 rounded-lg text-[var(--text-primary)] placeholder:text-neutral-500 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50 disabled:cursor-not-allowed ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    />
  );
});

export default Input;
