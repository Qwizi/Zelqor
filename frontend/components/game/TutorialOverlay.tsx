"use client";

import { ChevronLeft, ChevronRight, GraduationCap, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TutorialStep } from "@/lib/tutorialSteps";

interface TutorialOverlayProps {
  step: TutorialStep;
  stepIndex: number;
  totalSteps: number;
  canGoBack: boolean;
  onAdvance: () => void;
  onGoBack: () => void;
  onSkip: () => void;
}

/** Floating red indicator that points at a UI element found by data-tutorial attribute */
function TutorialPointer({ target }: { target: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const update = () => {
      const el = document.querySelector(`[data-tutorial="${target}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
      rafRef.current = requestAnimationFrame(update);
    };
    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target]);

  if (!rect || rect.width === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[99]">
      {/* Pulsing red border around the target element */}
      <div
        className="absolute animate-pulse rounded-xl border-[3px] border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.5)]"
        style={{
          left: rect.left - 6,
          top: rect.top - 6,
          width: rect.width + 12,
          height: rect.height + 12,
        }}
      />
      {/* Arrow pointing down at the element */}
      <div
        className="absolute"
        style={{
          left: rect.left + rect.width / 2 - 14,
          top: rect.top - 38,
        }}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          className="animate-bounce text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.7)]"
        >
          <path
            d="M12 4 L12 16 M7 12 L12 18 L17 12"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </div>
    </div>
  );
}

export default function TutorialOverlay({
  step,
  stepIndex,
  totalSteps,
  canGoBack,
  onAdvance,
  onGoBack,
  onSkip,
}: TutorialOverlayProps) {
  return (
    <>
      {/* Red pointer on the UI target element */}
      {step.uiTarget && <TutorialPointer target={step.uiTarget} />}

      {/* Floating card at top */}
      <div className="pointer-events-auto fixed left-1/2 top-3 z-[100] w-[min(520px,calc(100%-1rem))] -translate-x-1/2">
        <div className="rounded-2xl border border-cyan-500/30 bg-slate-900/97 px-5 py-4 shadow-[0_8px_40px_rgba(0,0,0,0.6),0_0_20px_rgba(6,182,212,0.1)] backdrop-blur-md sm:px-6 sm:py-5">
          {/* Header with icon + progress */}
          <div className="mb-3 flex items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-500/15">
              <GraduationCap className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="flex flex-1 items-center gap-1">
              {Array.from({ length: totalSteps }, (_, i) => (
                <div
                  key={i}
                  className={`h-1.5 flex-1 rounded-full transition-colors ${
                    i < stepIndex ? "bg-emerald-400" : i === stepIndex ? "bg-cyan-400" : "bg-white/10"
                  }`}
                />
              ))}
            </div>
            <span className="shrink-0 text-xs tabular-nums text-zinc-500">
              {stepIndex + 1}/{totalSteps}
            </span>
          </div>

          {/* Title */}
          <h3 className="text-base font-bold leading-snug text-white sm:text-lg">{step.title}</h3>

          {/* Description */}
          <p className="mt-2 text-sm leading-relaxed text-zinc-300 sm:text-[15px] sm:leading-relaxed">
            {step.description}
          </p>

          {/* Actions */}
          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={onSkip}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
              >
                <SkipForward className="h-3 w-3" />
                Pomin
              </button>
              {canGoBack && (
                <button
                  onClick={onGoBack}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200"
                >
                  <ChevronLeft className="h-3 w-3" />
                  Wstecz
                </button>
              )}
            </div>

            {step.manualAdvance ? (
              <Button
                onClick={onAdvance}
                size="sm"
                className="h-9 gap-1.5 rounded-full bg-cyan-500 px-5 text-sm font-semibold text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.3)] hover:bg-cyan-400"
              >
                {stepIndex === totalSteps - 1 ? "Zakoncz" : "Dalej"}
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <span className="flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                Wykonaj akcje...
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
