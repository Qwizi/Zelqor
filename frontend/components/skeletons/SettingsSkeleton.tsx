"use client";

import { Skeleton } from "@/components/ui/skeleton";

interface SectionDef {
  rows: number;
  hasButton?: boolean;
}

// Mirrors the real page: Account (3 rows), Password (1 row + button),
// Connected accounts (2 provider rows), Push notifications (1 row),
// Game (1 row), Danger zone (1 row)
const SECTIONS: SectionDef[] = [
  { rows: 3 },
  { rows: 1, hasButton: true },
  { rows: 2, hasButton: false },
  { rows: 1, hasButton: true },
  { rows: 1 },
  { rows: 1, hasButton: true },
];

function SettingRow({ hasButton }: { hasButton?: boolean }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-border first:border-t-0 pt-4 first:pt-0">
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-4 w-48" />
      </div>
      {hasButton && <Skeleton className="h-9 w-28 rounded-xl shrink-0" />}
    </div>
  );
}

function SectionCard({ rows, hasButton }: SectionDef) {
  return (
    <section className="rounded-2xl border border-border bg-card/50 p-4 md:p-6 mx-4 md:mx-0">
      {/* Section icon + label */}
      <div className="mb-5 flex items-center gap-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
        <Skeleton className="h-3 w-24" />
      </div>
      {/* Content rows */}
      <div className="space-y-4">
        {Array.from({ length: rows }).map((_, i) => (
          <SettingRow key={i} hasButton={i === rows - 1 ? hasButton : undefined} />
        ))}
      </div>
    </section>
  );
}

export function SettingsSkeleton() {
  return (
    <div className="space-y-3 md:space-y-6 -mx-4 md:mx-0 -mt-2 md:mt-0">
      {/* Page header */}
      <div className="px-4 md:px-0 space-y-1.5">
        <Skeleton className="hidden md:block h-3 w-24" />
        <Skeleton className="h-7 w-32 md:h-9 md:w-40" />
      </div>

      {/* Setting sections */}
      {SECTIONS.map((s, i) => (
        <SectionCard key={i} rows={s.rows} hasButton={s.hasButton} />
      ))}
    </div>
  );
}

export default SettingsSkeleton;
