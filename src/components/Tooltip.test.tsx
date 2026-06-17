import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('does not show the tooltip content until hovered', () => {
    render(
      <Tooltip content="Helpful hint">
        <button>Target</button>
      </Tooltip>
    );

    expect(screen.queryByText('Helpful hint')).not.toBeInTheDocument();
  });

  it('shows the tooltip content on hover and hides it again on mouse leave', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Helpful hint">
        <button>Target</button>
      </Tooltip>
    );

    const wrapper = screen.getByText('Target').parentElement!;

    await user.hover(wrapper);
    expect(screen.getByText('Helpful hint')).toBeInTheDocument();

    await user.unhover(wrapper);
    expect(screen.queryByText('Helpful hint')).not.toBeInTheDocument();
  });
});
