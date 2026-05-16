import React from 'react';

export function GradeBadge({ grade, size = 'md' }: { grade: string; size?: 'sm' | 'md' | 'lg' }) {
  const gradeColor: Record<string, string> = {
    A: '#1D9E75', B: '#378ADD', C: '#EF9F27', D: '#D85A30', F: '#E24B4A'
  };
  const gradeBg: Record<string, string> = {
    A: '#E1F5EE', B: '#E6F1FB', C: '#FAEEDA', D: '#FAECE7', F: '#FCEBEB'
  };

  const sizes = {
    sm: 'w-6 h-6 text-[10px]',
    md: 'w-10 h-10 text-sm',
    lg: 'w-16 h-16 text-2xl'
  };

  return (
    <div className={`${sizes[size]} rounded-full flex items-center justify-center font-black border-2 transition-all`}
      style={{
        color: gradeColor[grade] || 'var(--text-secondary)',
        borderColor: gradeColor[grade] || 'var(--border-subtle)',
        background: gradeBg[grade] || 'var(--bg-primary)'
      }}>
      {grade}
    </div>
  );
}

export function QualityGateCard({ scan, loading }: { scan: any; loading?: boolean }) {
  const grade = scan?.qualityGrade;
  const score = scan?.qualityScore ?? 0;
  const passed = grade && grade !== 'F' && grade !== 'D';

  const gradeColor: Record<string, string> = {
    A: '#1D9E75', B: '#378ADD', C: '#EF9F27', D: '#D85A30', F: '#E24B4A'
  };
  const gradeBg: Record<string, string> = {
    A: '#E1F5EE', B: '#E6F1FB', C: '#FAEEDA', D: '#FAECE7', F: '#FCEBEB'
  };

  return (
    <div className="bg-[var(--bg-card)] rounded-[12px] p-3 shadow-sm h-full border border-[var(--border-subtle)]">
      <p className="text-[9px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-1.5">Quality Gate</p>

      <div className="flex items-center justify-between mb-3">
        {/* Grade ring */}
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-black border-2"
          style={{
            color: grade ? gradeColor[grade] : 'var(--text-secondary)',
            borderColor: grade ? gradeColor[grade] : 'var(--border-subtle)',
            background: grade ? gradeBg[grade] : 'var(--bg-primary)'
          }}>
          {grade ?? '—'}
        </div>

        {/* Pass/fail + score */}
        <div className="text-right">
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-black mb-1"
            style={{
              background: passed ? '#E1F5EE' : grade ? '#FCEBEB' : 'var(--bg-primary)',
              color: passed ? '#0F6E75' : grade ? '#A32D2D' : 'var(--text-secondary)'
            }}>
            {passed ? '✓ Passed' : grade ? '✕ Failed' : 'Not computed'}
          </div>
          <p className="text-[9px] text-[var(--text-secondary)]">
            Score: <span className="font-black text-[var(--text-primary)]">{score}/100</span>
          </p>
        </div>
      </div>

      {/* Category grades */}
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {[
          { label: 'Security', grade: scan?.gradeSecuity },
          { label: 'Reliability', grade: scan?.gradeReliability },
          { label: 'Maintainability', grade: scan?.gradeMaintainability }
        ].map(({ label, grade: g }) => (
          <div key={label} className="bg-[var(--bg-primary)] rounded-lg p-1.5 text-center border border-[var(--border-subtle)]">
            <p className="text-[7px] text-[var(--text-secondary)] uppercase tracking-wider mb-0">{label}</p>
            <p className="text-sm font-black" style={{ color: g ? gradeColor[g] : 'var(--text-secondary)' }}>{g ?? '—'}</p>
          </div>
        ))}
      </div>

      {/* Score bar */}
      <div className="h-1 bg-[var(--bg-primary)] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, background: grade ? gradeColor[grade] : '#D3D1C7' }} />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-[var(--text-secondary)]">F</span>
        <span className="text-[10px] text-[var(--text-secondary)]">A</span>
      </div>
    </div>
  );
}
