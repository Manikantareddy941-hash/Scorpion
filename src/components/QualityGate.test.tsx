import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GradeBadge } from './QualityGate';

describe('GradeBadge', () => {
  it('renders the grade letter', () => {
    render(<GradeBadge grade="A" />);
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('applies the size class for each size variant', () => {
    render(<GradeBadge grade="B" size="lg" />);
    expect(screen.getByText('B')).toHaveClass('w-16', 'h-16');
  });

  it('colors known grades using the grade palette', () => {
    render(<GradeBadge grade="F" />);
    expect(screen.getByText('F')).toHaveStyle({ color: '#E24B4A' });
  });

  it('falls back to default styling for an unrecognized grade', () => {
    render(<GradeBadge grade="Z" />);
    expect(screen.getByText('Z')).toHaveStyle({ color: 'var(--text-secondary)' });
  });
});
