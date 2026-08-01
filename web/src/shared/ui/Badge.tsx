import React from 'react';

export type BadgeVariant = 'active' | 'suspended' | 'revoked' | 'neutral' | 'pending' | 'green' | 'yellow' | 'red' | 'gray' | 'protocol' | 'dim';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const variantClass: Record<BadgeVariant, string> = {
  active: 'badge-active',
  suspended: 'badge-suspended',
  revoked: 'badge-revoked',
  neutral: 'badge-neutral',
  pending: 'badge-neutral',
  green: 'badge-active',
  yellow: 'badge-suspended',
  red: 'badge-revoked',
  gray: 'badge-neutral',
  // Blue chip for wire-protocol labels (2026-07-29 superdesign V1 spec).
  protocol: 'badge-protocol',
  // Quiet tier for secondary type labels (2026-08-01): no fill, muted text.
  dim: 'badge-dim',
};

export function Badge({ variant = 'neutral', children, className = '' }: BadgeProps) {
  return (
    <span className={`badge ${variantClass[variant]} ${className}`}>
      {children}
    </span>
  );
}
