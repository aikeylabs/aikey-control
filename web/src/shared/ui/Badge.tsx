import React from 'react';

export type BadgeVariant = 'active' | 'suspended' | 'revoked' | 'neutral' | 'pending' | 'green' | 'yellow' | 'red' | 'gray';

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
};

export function Badge({ variant = 'neutral', children, className = '' }: BadgeProps) {
  return (
    <span className={`badge ${variantClass[variant]} ${className}`}>
      {children}
    </span>
  );
}
