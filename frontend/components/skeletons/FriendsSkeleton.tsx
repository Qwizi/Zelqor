"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

function FriendRowMobile() {
  return (
    <div className="flex items-center gap-3 rounded-xl py-3 px-1">
      {/* Avatar circle with status dot */}
      <div className="relative shrink-0">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <Skeleton className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full" />
      </div>
      {/* Name + ELO */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <Skeleton className="h-4 w-28 rounded" />
        <Skeleton className="h-3 w-16 rounded" />
      </div>
      {/* Action button */}
      <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
    </div>
  );
}

function FriendRowDesktop() {
  return (
    <div className="flex items-center gap-4 px-6 py-4">
      {/* Avatar */}
      <div className="relative shrink-0">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <Skeleton className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full" />
      </div>
      {/* Name */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <Skeleton className="h-4 w-36 rounded" />
        <Skeleton className="h-3 w-20 rounded" />
      </div>
      {/* ELO cell */}
      <Skeleton className="h-6 w-14 rounded" />
      {/* Status cell */}
      <Skeleton className="h-4 w-20 rounded" />
      {/* Action button */}
      <Skeleton className="h-9 w-20 rounded-md" />
    </div>
  );
}

export function FriendsSkeleton() {
  return (
    <div className="space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-4 md:px-0">
        <div className="space-y-2">
          {/* "SPOLECZNOSC" label — desktop only */}
          <Skeleton className="hidden md:block h-3 w-24 rounded" />
          {/* Title */}
          <Skeleton className="h-8 w-32 md:h-12 md:w-48 rounded-lg" />
          {/* Subtitle — desktop only */}
          <Skeleton className="hidden md:block h-4 w-64 rounded" />
        </div>
        {/* Friends count badge — desktop only */}
        <Skeleton className="hidden md:block h-9 w-16 rounded-full" />
      </div>

      {/* Add friend section */}
      <div className="px-4 md:px-0">
        {/* Mobile: flat row */}
        <div className="md:hidden">
          <Skeleton className="h-3 w-28 rounded mb-2.5" />
          <div className="flex gap-2">
            <Skeleton className="flex-1 h-11 rounded-xl" />
            <Skeleton className="shrink-0 h-11 w-24 rounded-xl" />
          </div>
        </div>

        {/* Desktop: Card */}
        <Card className="hidden md:block rounded-2xl">
          <CardContent className="p-5">
            <Skeleton className="h-3 w-32 rounded mb-3" />
            <div className="flex gap-3">
              <Skeleton className="flex-1 h-12 rounded-md" />
              <Skeleton className="shrink-0 h-12 w-32 rounded-md" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="px-4 md:px-0">
        {/* Mobile: pill row */}
        <div className="md:hidden flex gap-1.5 overflow-x-auto pb-1 mb-3 scrollbar-none">
          {["Znajomi", "Otrzymane", "Wysłane"].map((label) => (
            <Skeleton key={label} className="shrink-0 h-9 w-24 rounded-full" />
          ))}
        </div>

        {/* Desktop: tab list */}
        <Skeleton className="hidden md:block h-10 w-72 rounded-lg mb-4" />

        {/* Friend list — mobile */}
        <div className="md:hidden space-y-0.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <FriendRowMobile key={i} />
          ))}
        </div>

        {/* Friend list — desktop: Card with divide-y rows */}
        <Card className="hidden md:block rounded-2xl overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-4 px-6 py-4 border-b border-border">
            <Skeleton className="h-4 w-16 rounded" />
            <div className="flex-1" />
            <Skeleton className="h-4 w-10 rounded" />
            <Skeleton className="h-4 w-16 rounded" />
            <Skeleton className="h-4 w-14 rounded" />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 8 }).map((_, i) => (
              <FriendRowDesktop key={i} />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
