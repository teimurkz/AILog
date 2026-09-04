import React from 'react';

export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse bg-slate-200 dark:bg-slate-700/60 rounded-xl ${className}`} />
);

export const TableSkeleton: React.FC<{ rows?: number; cols?: number }> = ({ rows = 5, cols = 6 }) => (
  <div className="w-full space-y-3 p-4">
    <div className="h-10 bg-slate-200 dark:bg-slate-700/60 rounded-xl animate-pulse" />
    {Array.from({ length: rows }).map((_, r) => (
      <div key={r} className="flex gap-3">
        {Array.from({ length: cols }).map((_, c) => (
          <div key={c} className="h-12 bg-slate-100 dark:bg-slate-800 rounded-xl flex-1 animate-pulse" />
        ))}
      </div>
    ))}
  </div>
);

export const CardSkeleton: React.FC<{ count?: number }> = ({ count = 4 }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-3 w-48" />
      </div>
    ))}
  </div>
);
