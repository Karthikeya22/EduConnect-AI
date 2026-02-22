
import React from 'react';

interface SkeletonProps {
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = "" }) => (
  <div className={`bg-zinc-200/60 animate-pulse rounded-md relative overflow-hidden before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_2s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/20 before:to-transparent ${className}`} />
);

export const CardSkeleton: React.FC = () => (
  <div className="p-8 bg-white rounded-[2.5rem] border border-zinc-100 shadow-sm space-y-4">
    <Skeleton className="w-12 h-12 rounded-2xl" />
    <Skeleton className="h-6 w-3/4" />
    <div className="space-y-2">
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
    </div>
  </div>
);

export const MaterialGridSkeleton: React.FC = () => (
  <div className="space-y-12">
    {[1, 2].map(section => (
      <div key={section} className="bg-white rounded-[2.5rem] border p-8 space-y-6">
        <Skeleton className="h-8 w-48 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-zinc-50 p-6 rounded-[2rem] border border-zinc-100 space-y-4">
              <Skeleton className="h-5 w-3/4" />
              <div className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);

export const DiscussionSkeleton: React.FC = () => (
  <div className="space-y-12">
    <div className="bg-white p-10 rounded-[2.5rem] border border-zinc-100 space-y-6">
      <Skeleton className="h-6 w-32" />
      <div className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
    <div className="space-y-6">
      {[1, 2, 3].map(i => (
        <div key={i} className="p-8 rounded-[2.5rem] border border-zinc-100 bg-white space-y-6">
          <div className="flex items-center space-x-4">
            <Skeleton className="w-12 h-12 rounded-2xl" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-2 w-16" />
            </div>
          </div>
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ))}
    </div>
  </div>
);

export const DashboardSkeleton: React.FC<{ role: 'teacher' | 'student' }> = ({ role }) => (
  <div className="p-12 space-y-12 w-full max-w-[1400px] mx-auto">
    <div className="space-y-4">
      <Skeleton className="h-4 w-32 rounded-full" />
      <Skeleton className="h-16 w-1/2 rounded-xl" />
      <Skeleton className="h-6 w-1/3 rounded-lg" />
    </div>
    
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="h-52 bg-white rounded-[3rem] border border-zinc-100 p-10 flex flex-col justify-center space-y-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-12 w-16" />
        </div>
      ))}
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
      <div className="lg:col-span-8 space-y-8">
        <Skeleton className="h-8 w-48 mb-10" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-48 bg-white/50 rounded-[2.5rem] border border-zinc-100 p-8 flex flex-col justify-end space-y-4">
              <Skeleton className="w-10 h-10 rounded-xl" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-2 w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="lg:col-span-4">
        <div className="h-[500px] bg-zinc-900/5 rounded-[3.5rem] border border-zinc-200 p-10 space-y-6">
          <Skeleton className="h-6 w-32" />
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex gap-4">
              <Skeleton className="w-10 h-10 rounded-full shrink-0" />
              <div className="space-y-2 flex-1 pt-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-2 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

export const ProgressSkeleton: React.FC = () => (
  <div className="p-12 space-y-12 max-w-[1200px] mx-auto">
    <div className="bg-white p-10 rounded-[3rem] border shadow-xl flex items-center gap-12">
      <Skeleton className="w-32 h-32 rounded-full" />
      <div className="space-y-4 flex-1">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-6 w-1/2" />
      </div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-48 bg-white rounded-[2.5rem] border p-8 space-y-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-12 w-16" />
        </div>
      ))}
    </div>
    <div className="bg-white rounded-[2.5rem] border p-10 space-y-8">
      <Skeleton className="h-8 w-48" />
      <div className="space-y-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="flex items-center justify-between border-b pb-4">
            <div className="flex gap-4">
              <Skeleton className="w-12 h-12 rounded-xl" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-2 w-24" />
              </div>
            </div>
            <Skeleton className="h-10 w-24 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  </div>
);
