"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

// 8 categories matching CATEGORIES in the real page
const CATEGORY_COUNT = 8;
// 6 recipe rows
const RECIPE_COUNT = 6;
// 6 mobile category pills
const PILL_COUNT = 6;

export function CraftingSkeleton() {
  return (
    <div className="space-y-3 md:space-y-8 -mx-4 md:mx-0 -mt-2 md:mt-0">

      {/* ── Header ── */}
      <div className="px-4 md:px-0 space-y-1.5">
        {/* "Warsztat" label — desktop only */}
        <Skeleton className="hidden md:block h-3 w-20" />
        {/* "Kuźnia" title */}
        <Skeleton className="h-8 w-28 md:h-12 md:w-36" />
      </div>

      {/* ── Wallet bar ── */}
      <div className="px-4 md:px-0">
        {/* Mobile: inline coin + number */}
        <div className="flex items-center gap-2.5 md:hidden">
          <Skeleton className="h-5 w-5 rounded-full" />
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-4 w-10" />
        </div>
        {/* Desktop: card */}
        <Card className="hidden md:flex flex-row items-center gap-3 rounded-2xl px-6 py-4">
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-5 w-10" />
        </Card>
      </div>

      {/* ── Main layout ── */}
      <div
        className="md:flex md:flex-row md:gap-4 md:rounded-2xl md:border md:border-border md:bg-card md:p-5 px-4 md:px-5"
        style={{ maxHeight: "calc(100vh - 12rem)" }}
      >

        {/* ── Left sidebar: category buttons (desktop only) ── */}
        <div className="hidden w-52 shrink-0 space-y-1 overflow-y-auto lg:block">
          {Array.from({ length: CATEGORY_COUNT }).map((_, i) => (
            <div
              key={i}
              className="flex w-full items-center gap-2.5 rounded-xl border border-transparent px-3 py-3"
            >
              {/* Emoji icon placeholder */}
              <Skeleton className="h-6 w-6 shrink-0 rounded-md" />
              {/* Label */}
              <Skeleton className="h-4 flex-1 rounded" />
              {/* Count */}
              <Skeleton className="h-4 w-6 rounded" />
            </div>
          ))}
        </div>

        {/* ── Center: recipe list ── */}
        <div className="min-w-0 flex-1 space-y-3 md:space-y-4 overflow-y-auto">

          {/* Mobile category pills */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 lg:hidden">
            {Array.from({ length: PILL_COUNT }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-8 w-10 shrink-0 rounded-full"
              />
            ))}
          </div>

          {/* Search bar + "Dostępne" toggle */}
          <div className="flex gap-2">
            <Skeleton className="h-10 md:h-11 flex-1 rounded-full md:rounded-xl" />
            <Skeleton className="h-10 md:h-11 w-14 md:w-28 shrink-0 rounded-full md:rounded-xl" />
          </div>

          {/* Recipe rows */}
          <div className="space-y-1.5 md:space-y-2">
            {Array.from({ length: RECIPE_COUNT }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 md:gap-4 rounded-xl border border-border/30 p-3 md:p-4 h-20 md:h-24"
              >
                {/* Item icon square */}
                <Skeleton className="h-10 w-10 md:h-14 md:w-14 shrink-0 rounded-xl" />

                {/* Name + rarity badge + ingredients */}
                <div className="min-w-0 flex-1 space-y-1.5 md:space-y-2">
                  {/* Name + rarity badge */}
                  <div className="flex items-center gap-1.5 md:gap-2">
                    <Skeleton className="h-4 md:h-5 w-28 md:w-40 rounded" />
                    <Skeleton className="h-4 md:h-5 w-12 md:w-16 rounded-full" />
                  </div>
                  {/* Ingredient icons row */}
                  <div className="flex items-center gap-2 md:gap-3">
                    <Skeleton className="h-4 w-4 md:h-5 md:w-5 rounded-full" />
                    <Skeleton className="h-3 w-8 md:h-4 md:w-10 rounded" />
                    <Skeleton className="h-4 w-4 md:h-5 md:w-5 rounded-full" />
                    <Skeleton className="h-3 w-8 md:h-4 md:w-10 rounded" />
                    <Skeleton className="h-4 w-4 md:h-5 md:w-5 rounded-full" />
                    <Skeleton className="h-3 w-8 md:h-4 md:w-10 rounded" />
                  </div>
                </div>

                {/* Check / lock icon */}
                <Skeleton className="h-8 w-8 md:h-11 md:w-11 shrink-0 rounded-full" />
              </div>
            ))}
          </div>
        </div>

        {/* ── Right detail panel (xl+ only) ── */}
        <div className="hidden w-80 shrink-0 xl:flex xl:flex-col xl:gap-4">
          {/* Large icon + name + badges */}
          <div className="flex items-center gap-4">
            <Skeleton className="h-16 w-16 shrink-0 rounded-2xl" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-5 w-36" />
              <div className="flex gap-1.5">
                <Skeleton className="h-4 w-14 rounded-full" />
                <Skeleton className="h-4 w-10 rounded-full" />
              </div>
            </div>
          </div>

          {/* 4 ingredient rows */}
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-border/30 px-3 py-2.5">
                <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
                <Skeleton className="h-4 flex-1 rounded" />
                <Skeleton className="h-4 w-12 rounded" />
              </div>
            ))}
          </div>

          {/* Craft button */}
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>

      </div>
    </div>
  );
}

export default CraftingSkeleton;
