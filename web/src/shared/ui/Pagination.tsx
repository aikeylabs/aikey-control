/** Simple pagination bar — page 1-indexed. */
interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}

export function Pagination({ page, pageSize, total, onPage }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between px-2 py-3">
      <span className="text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>
        {start}–{end} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="px-2.5 py-1 text-[10px] font-mono rounded border disabled:opacity-30"
          style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
        >
          ← Prev
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1)
          .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
          .reduce<(number | '...')[]>((acc, p, idx, arr) => {
            if (idx > 0 && typeof arr[idx - 1] === 'number' && (p as number) - (arr[idx - 1] as number) > 1) acc.push('...');
            acc.push(p);
            return acc;
          }, [])
          .map((p, i) =>
            p === '...' ? (
              <span key={`dots-${i}`} className="px-1 text-[10px] font-mono" style={{ color: 'var(--muted-foreground)' }}>···</span>
            ) : (
              <button
                key={p}
                onClick={() => onPage(p as number)}
                className="w-7 h-7 text-[10px] font-mono rounded border"
                style={{
                  borderColor: page === p ? 'var(--primary)' : 'var(--border)',
                  color: page === p ? 'var(--primary)' : 'var(--muted-foreground)',
                  backgroundColor: page === p ? 'rgba(250,204,21,0.08)' : 'transparent',
                }}
              >
                {p}
              </button>
            )
          )}
        <button
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          className="px-2.5 py-1 text-[10px] font-mono rounded border disabled:opacity-30"
          style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
