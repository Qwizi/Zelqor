"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

const ROW_COUNT = 12;

export function NotificationsSkeleton() {
  return (
    <div className="space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 px-4 md:px-0">
        <div className="space-y-1.5">
          {/* "AKTYWNOŚĆ" label — desktop only */}
          <Skeleton className="hidden md:block h-3 w-20" />
          {/* "Powiadomienia" title */}
          <Skeleton className="h-8 w-40 md:h-12 md:w-56" />
          {/* Subtitle — desktop only */}
          <Skeleton className="hidden md:block h-4 w-64" />
        </div>

        {/* Right: "Oznacz wszystkie" button + count badge — desktop */}
        <div className="hidden md:flex items-center gap-3">
          <Skeleton className="h-9 w-36 rounded-xl" />
          <Skeleton className="h-8 w-16 rounded-full" />
        </div>
      </div>

      {/* ── Mobile: "mark all" button ── */}
      <div className="px-4 md:hidden">
        <Skeleton className="h-4 w-52 rounded" />
      </div>

      {/* ── Notification list ── */}
      <div className="px-4 md:px-0">

        {/* Mobile flat list */}
        <div className="md:hidden space-y-0.5">
          {Array.from({ length: ROW_COUNT }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-xl py-3 px-2"
            >
              {/* Icon circle */}
              <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />

              {/* Title + body */}
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton className="h-4 w-36 rounded" />
                <Skeleton className="h-3 w-52 rounded" />
              </div>

              {/* Time */}
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <Skeleton className="h-3 w-8 rounded" />
                {/* Unread dot — show on some rows */}
                {i % 3 === 0 && <Skeleton className="h-2 w-2 rounded-full" />}
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table card */}
        <Card className="hidden md:block rounded-2xl overflow-hidden">
          {/* Table header */}
          <div className="flex items-center gap-4 border-b border-border px-6 h-14">
            <Skeleton className="h-4 w-8 rounded" />
            <Skeleton className="h-4 w-16 rounded" />
            <Skeleton className="h-4 flex-1 rounded" />
            <Skeleton className="h-4 w-20 rounded ml-auto" />
          </div>

          {/* Table rows */}
          {Array.from({ length: ROW_COUNT }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 border-b border-border/50 last:border-0 px-6 py-4"
            >
              {/* Icon circle */}
              <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />

              {/* Type badge */}
              <Skeleton className="h-5 w-24 rounded-full shrink-0" />

              {/* Title + body */}
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton className="h-4 w-48 rounded" />
                <Skeleton className="h-3 w-72 rounded" />
              </div>

              {/* Time — right-aligned */}
              <Skeleton className="h-4 w-24 rounded shrink-0 ml-auto" />
            </div>
          ))}
        </Card>
      </div>

      {/* ── Pagination ── */}
      <div className="flex items-center justify-between px-4 md:px-0">
        {/* Page indicator */}
        <Skeleton className="h-4 w-12 rounded" />

        {/* Prev / Next buttons */}
        <div className="flex items-center gap-2">
          {/* Prev */}
          <Skeleton className="h-9 w-9 md:h-10 md:w-32 rounded-full md:rounded-xl" />
          {/* Next */}
          <Skeleton className="h-9 w-9 md:h-10 md:w-32 rounded-full md:rounded-xl" />
        </div>
      </div>

    </div>
  );
}

export default NotificationsSkeleton;
