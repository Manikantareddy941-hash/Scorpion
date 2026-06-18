interface SkeletonProps {
  className?: string;
}

export default function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`animate-pulse rounded-md bg-neutral-800 ${className}`} />;
}

export function SkeletonCard({ className = '' }: SkeletonProps) {
  return (
    <div className={`card bg-neutral-900 border border-neutral-800 rounded-lg p-6 shadow-md ${className}`}>
      <Skeleton className="h-3 w-1/2 mb-4" />
      <Skeleton className="h-7 w-1/3" />
    </div>
  );
}

interface SkeletonTableRowsProps {
  rows?: number;
  cols?: number;
}

export function SkeletonTableRows({ rows = 5, cols = 4 }: SkeletonTableRowsProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className={r % 2 === 1 ? 'bg-white/[0.02]' : ''}>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-4 py-2.5">
              <Skeleton className={`h-3 ${c === 0 ? 'w-3/4' : 'w-1/2'}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
