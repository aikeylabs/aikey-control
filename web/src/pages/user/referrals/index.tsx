/**
 * My Referrals page — /user/referrals
 *
 * Shows the user's personal invite link and a history of referrals.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUserAuthStore } from '@/store';
import { userAccountsApi, type ReferralDTO } from '@/shared/api/user/accounts';
import { PageHeader } from '@/shared/ui/PageHeader';
import { Badge } from '@/shared/ui/Badge';
import { copyText } from '@/shared/utils/clipboard';

export default function UserReferralsPage() {
  const user = useUserAuthStore((s) => s.user);
  const [copied, setCopied] = useState(false);

  const { data: referrals = [], isLoading } = useQuery({
    queryKey: ['my-referrals'],
    queryFn: userAccountsApi.myReferrals,
  });

  const inviteLink = `${window.location.origin}/user/login?ref=${user?.id ?? ''}`;

  function handleCopy() {
    copyText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const completed = referrals.filter((r) => r.status === 'completed');
  const pending = referrals.filter((r) => r.status === 'pending');

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <PageHeader title="Invite Friends" description="Share your invite link and track referrals" />

      {/* Invite link card */}
      <div
        className="rounded border p-6 relative overflow-hidden"
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
      >
        <div
          className="absolute top-0 left-0 w-1 h-full"
          style={{ backgroundColor: 'var(--primary)', boxShadow: '0 0 10px rgba(250, 204, 21,0.5)' }}
        />
        <h2 className="text-xs font-mono font-bold tracking-wider uppercase mb-3" style={{ color: 'var(--muted-foreground)' }}>
          Your Invite Link
        </h2>
        <p className="text-xs font-mono mb-4" style={{ color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
          Share this link with colleagues. When they sign up with <code className="px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--muted)' }}>aikey login</code>, you'll be credited as the referrer.
        </p>

        <div
          className="rounded border p-3 flex items-center justify-between gap-3"
          style={{ backgroundColor: 'rgba(0,0,0,0.3)', borderColor: 'var(--border)' }}
        >
          <code className="text-xs font-mono truncate flex-1" style={{ color: 'var(--primary)' }}>
            {inviteLink}
          </code>
          <button
            onClick={handleCopy}
            className="btn btn-outline text-[10px] px-3 py-1.5 flex-shrink-0"
            style={{
              color: copied ? '#4ade80' : 'var(--foreground)',
              borderColor: copied ? 'rgba(74,222,128,0.3)' : 'var(--border)',
            }}
          >
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div
          className="rounded border p-4 text-center"
          style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
        >
          <div className="text-3xl font-bold font-mono" style={{ color: '#4ade80' }}>{completed.length}</div>
          <div className="text-[10px] font-mono tracking-wider mt-1" style={{ color: 'var(--muted-foreground)' }}>Completed</div>
        </div>
        <div
          className="rounded border p-4 text-center"
          style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
        >
          <div className="text-3xl font-bold font-mono" style={{ color: 'var(--primary)' }}>{pending.length}</div>
          <div className="text-[10px] font-mono tracking-wider mt-1" style={{ color: 'var(--muted-foreground)' }}>Pending</div>
        </div>
      </div>

      {/* Referral history */}
      <div
        className="rounded border overflow-hidden"
        style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
      >
        <div
          className="px-5 py-4"
          style={{ borderBottom: '1px solid var(--border)', backgroundColor: 'rgba(0,0,0,0.2)' }}
        >
          <h2 className="text-xs font-mono font-bold tracking-wider" style={{ color: 'var(--muted-foreground)' }}>
            Referral History
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left border-collapse">
            <thead>
              <tr>
                {['Email', 'Status', 'Invited', 'Completed'].map((h) => (
                  <th key={h} className="px-5 py-3 text-[10px] font-mono tracking-wider" style={{ color: 'var(--muted-foreground)', backgroundColor: 'rgba(0,0,0,0.2)', borderBottom: '1px solid var(--border)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={4} className="px-5 py-10 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>Loading...</td></tr>
              ) : referrals.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-10 text-center text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>No referrals yet. Share your link to get started!</td></tr>
              ) : (
                referrals.map((r: ReferralDTO) => (
                  <tr key={r.referral_id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="px-5 py-3 text-sm font-mono" style={{ color: 'var(--foreground)' }}>{r.referred_email}</td>
                    <td className="px-5 py-3">
                      <Badge variant={r.status === 'completed' ? 'green' : 'yellow'}>{r.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                      {new Date(r.created_at).toLocaleDateString(navigator.language)}
                    </td>
                    <td className="px-5 py-3 text-xs font-mono" style={{ color: 'var(--muted-foreground)' }}>
                      {r.completed_at ? new Date(r.completed_at).toLocaleDateString(navigator.language) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
