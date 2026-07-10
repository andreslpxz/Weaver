import { type ReactNode } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: Parameters<typeof clsx>): string {
  return twMerge(clsx(inputs));
}

export function Button({
  children,
  variant = 'ghost',
  className,
  ...rest
}: {
  children: ReactNode;
  variant?: 'ghost' | 'primary' | 'danger';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants = {
    ghost: 'codex-btn',
    primary: 'codex-btn codex-btn-primary',
    danger: 'codex-btn text-danger hover:bg-danger/10',
  };
  return (
    <button className={cn(variants[variant], className)} {...rest}>
      {children}
    </button>
  );
}

export function IconButton({
  children,
  className,
  ...rest
}: { children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={cn('codex-icon-btn', className)} {...rest}>
      {children}
    </button>
  );
}

export function Badge({
  children,
  color = 'default',
  className,
}: {
  children: ReactNode;
  color?: 'default' | 'success' | 'warning' | 'danger' | 'accent';
  className?: string;
}) {
  const colors = {
    default: 'bg-app-elevated text-text-secondary border-border',
    success: 'bg-success/15 text-success border-success/30',
    warning: 'bg-warning/15 text-warning border-warning/30',
    danger: 'bg-danger/15 text-danger border-danger/30',
    accent: 'bg-accent/15 text-accent border-accent/30',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border',
        colors[color],
        className,
      )}
    >
      {children}
    </span>
  );
}
