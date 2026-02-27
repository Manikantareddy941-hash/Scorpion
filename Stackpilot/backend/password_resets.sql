-- Create password_resets table
CREATE TABLE IF NOT EXISTS public.password_resets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    otp_hash TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    attempts INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_password_resets_email ON public.password_resets(email);

-- Optional: Add Row Level Security (RLS)
-- Since this is managed by the backend (service-role), we can keep it restricted
ALTER TABLE public.password_resets DISABLE ROW LEVEL SECURITY;
