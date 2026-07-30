import React from 'react';

type ButtonVariant = 'primary' | 'primary-dim' | 'outline' | 'ghost';
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

const sizeClass: Record<ButtonSize, string> = {
  xs: 'text-[10px] px-2 py-0.5',
  sm: 'text-[10px] px-3 py-1',
  md: 'text-xs px-4 py-1.5',
  lg: 'text-sm px-5 py-2.5',
};

const variantClass: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  // Dim-yellow filled — for secondary/inline actions where full primary reads
  // too loud (maps to .btn-primary-dim; same hue, yellow-600 not yellow-400).
  'primary-dim': 'btn-primary-dim',
  outline: 'btn-outline',
  ghost: 'btn-ghost',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`btn ${variantClass[variant]} ${sizeClass[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg
          className="animate-spin -ml-1 mr-2 h-3 w-3"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {!loading && icon && <span className="mr-2">{icon}</span>}
      {children}
    </button>
  );
}
