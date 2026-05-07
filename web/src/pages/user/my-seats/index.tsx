import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { userAccountsApi } from '@/shared/api/user/accounts';

export default function MySeatsPage() {
  const { data: seats, isLoading, isError } = useQuery({
    queryKey: ['my-seats'],
    queryFn: userAccountsApi.mySeats,
  });

  return (
    <div className="p-6 space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-lg font-mono font-bold tracking-widest"
            style={{ color: 'var(--foreground)' }}
          >
            MY SEATS
          </h1>
          <p className="text-xs font-mono mt-1" style={{ color: 'var(--muted-foreground)' }}>
            Org seats assigned to your account — GET /accounts/me/seats
          </p>
        </div>
      </div>

      {/* Table */}
      <div
        className="rounded border overflow-hidden"
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
      >
        <div
          className="px-5 py-4 border-b"
          style={{ borderColor: 'var(--border)', backgroundColor: 'rgba(0,0,0,0.2)' }}
        >
          <h2 className="text-xs font-mono font-bold tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
            SEAT LIST
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap">
            <thead>
              <tr>
                <th className="px-5 py-3 text-left">SEAT ID</th>
                <th className="px-5 py-3 text-left">ORG</th>
                <th className="px-5 py-3 text-left">ROLE</th>
                <th className="px-5 py-3 text-left">STATUS</th>
                <th className="px-5 py-3 text-left">JOINED</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center" style={{ color: 'var(--muted-foreground)' }}>
                    LOADING...
                  </td>
                </tr>
              )}
              {isError && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center" style={{ color: 'var(--destructive)' }}>
                    Failed to load seats. Check your connection or login status.
                  </td>
                </tr>
              )}
              {seats && seats.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center" style={{ color: 'var(--muted-foreground)' }}>
                    NO SEATS ASSIGNED
                  </td>
                </tr>
              )}
              {seats?.map((seat) => (
                <tr key={seat.seat_id}>
                  <td className="px-5 py-4" style={{ color: 'var(--muted-foreground)' }}>{seat.seat_id.slice(0, 8)}···</td>
                  <td className="px-5 py-4" style={{ color: 'var(--foreground)' }}>{seat.org_id}</td>
                  <td className="px-5 py-4" style={{ color: 'var(--muted-foreground)' }}>member</td>
                  <td className="px-5 py-4">
                    <span className={`badge ${seat.seat_status === 'active' ? 'badge-active' : 'badge-neutral'}`}>
                      {seat.seat_status}
                    </span>
                  </td>
                  <td className="px-5 py-4" style={{ color: 'var(--muted-foreground)' }}>
                    {seat.claimed_at ? new Date(seat.claimed_at).toLocaleDateString(navigator.language) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
