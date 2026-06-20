import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OAuthProvider } from 'appwrite';
import SocialLoginButtons from './SocialLoginButtons';
import { useAuth } from '../../contexts/AuthContext';

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

describe('SocialLoginButtons', () => {
  const signInWithOAuth = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ signInWithOAuth });
  });

  it('renders a button for every supported provider, including enterprise SSO', () => {
    render(<SocialLoginButtons />);

    expect(screen.getByLabelText('Sign in with Google')).toBeInTheDocument();
    expect(screen.getByLabelText('Sign in with GitHub')).toBeInTheDocument();
    expect(screen.getByLabelText('Sign in with Microsoft (Azure AD)')).toBeInTheDocument();
    expect(screen.getByLabelText('Sign in with Okta')).toBeInTheDocument();
  });

  it('calls signInWithOAuth with the Okta enum value, not a raw string', async () => {
    const user = userEvent.setup();
    render(<SocialLoginButtons />);

    await user.click(screen.getByLabelText('Sign in with Okta'));

    expect(signInWithOAuth).toHaveBeenCalledWith(OAuthProvider.Okta);
  });

  it('calls signInWithOAuth with the Microsoft enum value when that button is clicked', async () => {
    const user = userEvent.setup();
    render(<SocialLoginButtons />);

    await user.click(screen.getByLabelText('Sign in with Microsoft (Azure AD)'));

    expect(signInWithOAuth).toHaveBeenCalledWith(OAuthProvider.Microsoft);
  });

  it('disables all buttons while a provider sign-in is in flight', async () => {
    const user = userEvent.setup();
    signInWithOAuth.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<SocialLoginButtons />);

    await user.click(screen.getByLabelText('Sign in with Google'));

    expect(screen.getByLabelText('Sign in with Okta')).toBeDisabled();
  });
});
