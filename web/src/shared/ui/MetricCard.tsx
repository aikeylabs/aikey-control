import React from 'react';

interface MetricCardProps {
  label: string;
  value: React.ReactNode;
  subValue?: React.ReactNode;
  accentColor?: string; // tailwind bg color for the left bar
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  trendPositive?: boolean; // true = green, false = red
}

export function MetricCard({
  label,
  value,
  subValue,
  accentColor,
  trendValue,
  trendPositive,
}: MetricCardProps) {
  return (
    <div
      className="relative overflow-hidden rounded border border-border p-5 shadow-card flex flex-col items-center justify-center group"
      style={{ backgroundColor: 'var(--card)' }}
    >
      {/* Left accent bar */}
      <div
        className="absolute top-0 left-0 w-1 h-full transition-colors duration-300"
        style={{
          backgroundColor: accentColor ?? 'var(--border)',
        }}
      />

      <h3 className="text-[10px] font-bold text-muted-foreground tracking-[0.2em] mb-3 font-mono text-center">
        {label}
      </h3>

      <div className="text-4xl font-bold font-mono tracking-tight" style={{ color: 'var(--foreground)' }}>
        {value}
      </div>

      {subValue && (
        <div
          className="text-xs mt-2 font-mono font-medium flex items-center gap-1"
          style={{
            color:
              trendValue != null
                ? trendPositive
                  ? '#4ade80'
                  : '#f87171'
                : 'var(--muted-foreground)',
          }}
        >
          {trendValue && (
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d={trendPositive ? 'M13 7l5 5m0 0l-5 5m5-5H6' : 'M11 17l-5-5m0 0l5-5m-5 5h12'}
              />
            </svg>
          )}
          {subValue}
        </div>
      )}
    </div>
  );
}
