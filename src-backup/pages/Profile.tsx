import { useAuth } from '../contexts/AuthContext';

export default function Profile() {
  const { user, signOut } = useAuth();

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '40px' }}>
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        <h1 style={{ color: '#E8440A', fontWeight: 800, fontSize: '1.5rem', letterSpacing: '0.1em', marginBottom: '32px' }}>
          OPERATOR PROFILE
        </h1>

        {/* Avatar Card */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '32px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: '#E8440A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', fontWeight: 800, color: 'white' }}>
            {user?.name?.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1.2rem' }}>{user?.name}</div>
            <div style={{ color: '#E8440A', fontSize: '0.85rem', letterSpacing: '0.1em', marginTop: '4px' }}>SECURITY OPERATOR</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '4px' }}>{user?.email}</div>
          </div>
        </div>

        {/* Details Card */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '32px', marginBottom: '24px' }}>
          <h2 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1rem', marginBottom: '20px', letterSpacing: '0.05em' }}>ACCOUNT DETAILS</h2>
          {[
            { label: 'USER ID', value: user?.$id },
            { label: 'EMAIL', value: user?.email },
            { label: 'NAME', value: user?.name },
            { label: 'ACCOUNT CREATED', value: user?.$createdAt ? new Date(user.$createdAt).toLocaleDateString() : 'N/A' },
            { label: 'LAST UPDATED', value: user?.$updatedAt ? new Date(user.$updatedAt).toLocaleDateString() : 'N/A' },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', letterSpacing: '0.1em' }}>{label}</span>
              <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontFamily: 'monospace' }}>{value}</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={() => window.history.back()} style={{ flex: 1, padding: '12px', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: '8px', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600 }}>
            ← BACK
          </button>
          <button onClick={signOut} style={{ flex: 1, padding: '12px', background: '#E8440A', border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer', fontWeight: 700, letterSpacing: '0.1em' }}>
            SIGN OUT
          </button>
        </div>
      </div>
    </div>
  );
}
