"use client";

import { Skeleton } from "@/components/ui/skeleton";

function AppCard() {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.05] p-5">
      {/* Icon + name + description */}
      <div className="flex items-start gap-3 pr-16">
        <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-48" />
        </div>
      </div>

      {/* Client ID box */}
      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 space-y-1.5">
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-3 w-44" />
      </div>

      {/* Footer: created date + arrow */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-4 w-4 rounded" />
      </div>
    </div>
  );
}

export function DevelopersSkeleton() {
  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-52" />
          <Skeleton className="h-4 w-80" />
        </div>
        {/* Buttons */}
        <div className="flex gap-3 shrink-0">
          <Skeleton className="h-11 w-36 rounded-full" />
          <Skeleton className="h-11 w-40 rounded-full" />
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className={`rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 space-y-2 ${i === 2 ? "col-span-2 sm:col-span-1" : ""}`}
          >
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-7 w-10" />
          </div>
        ))}
      </div>

      {/* App grid — 3 cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <AppCard key={i} />
        ))}
      </div>
    </div>
  );
}

export default DevelopersSkeleton;
