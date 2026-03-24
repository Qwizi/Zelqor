"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameState } from "@/hooks/useGameSocket";
import { cleanupTutorial, completeTutorial } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { TUTORIAL_STEPS, type TutorialStep } from "@/lib/tutorialSteps";

interface UseTutorialReturn {
  currentStep: TutorialStep | null;
  stepIndex: number;
  totalSteps: number;
  isActive: boolean;
  canGoBack: boolean;
  advanceStep: () => void;
  goBack: () => void;
  skipTutorial: () => void;
}

/**
 * Compute the correct step index based on game state.
 * Advances past completed condition-based steps.
 */
function computeStepIndex(currentIndex: number, gameState: GameState | null, userId: string | undefined): number {
  if (!gameState || !userId) return currentIndex;

  let idx = currentIndex;
  while (idx < TUTORIAL_STEPS.length) {
    const step = TUTORIAL_STEPS[idx];
    if (step.manualAdvance || !step.condition) break;
    if (!step.condition(gameState, userId)) break;
    idx++;
  }
  return Math.min(idx, TUTORIAL_STEPS.length - 1);
}

export function useTutorial(
  gameState: GameState | null,
  userId: string | undefined,
  isTutorial: boolean,
  sendWs: (data: Record<string, unknown>) => void,
): UseTutorialReturn {
  const router = useRouter();
  const [manualStepIndex, setManualStepIndex] = useState(0);
  const [isActive, setIsActive] = useState(isTutorial);
  const [didFinish, setDidFinish] = useState(false);
  const lastMultiplierRef = useRef<number>(1);

  // Activate when isTutorial becomes true (gameState loads asynchronously)
  if (isTutorial && !isActive && !didFinish) {
    setIsActive(true);
  }

  // Derive effective step index: max of manual advances and condition-based advances
  const stepIndex = useMemo(
    () => (isActive ? computeStepIndex(manualStepIndex, gameState, userId) : manualStepIndex),
    [isActive, manualStepIndex, gameState, userId],
  );

  const currentStep = isActive && stepIndex < TUTORIAL_STEPS.length ? TUTORIAL_STEPS[stepIndex] : null;

  // Send tick multiplier when step changes
  useEffect(() => {
    if (!isActive || !currentStep) return;
    const multiplier = currentStep.tickMultiplier ?? 1;
    if (multiplier !== lastMultiplierRef.current) {
      lastMultiplierRef.current = multiplier;
      sendWs({ action: "set_tick_multiplier", multiplier });
    }
  }, [isActive, currentStep, sendWs]);

  const advanceStep = useCallback(() => {
    const nextIndex = stepIndex + 1;
    if (nextIndex < TUTORIAL_STEPS.length) {
      setManualStepIndex(nextIndex);
    } else {
      // Last step — mark tutorial as completed, cleanup match, go to dashboard
      setIsActive(false);
      setDidFinish(true);
      sendWs({ action: "set_tick_multiplier", multiplier: 1 });
      const token = getAccessToken();
      if (token) {
        completeTutorial(token).catch(() => {});
        cleanupTutorial(token).catch(() => {});
      }
      router.push("/dashboard");
    }
  }, [stepIndex, sendWs, router]);

  // Can go back if current step is manualAdvance and there's a previous manualAdvance step
  const canGoBack = stepIndex > 0 && !!currentStep?.manualAdvance;

  const goBack = useCallback(() => {
    if (stepIndex <= 0) return;
    // Find previous manual advance step
    let prev = stepIndex - 1;
    while (prev > 0 && !TUTORIAL_STEPS[prev].manualAdvance) {
      prev--;
    }
    setManualStepIndex(prev);
  }, [stepIndex]);

  const skipTutorial = useCallback(() => {
    // Skip = cleanup match, do NOT mark as completed (user can retry)
    setIsActive(false);
    setDidFinish(true);
    sendWs({ action: "set_tick_multiplier", multiplier: 1 });
    const token = getAccessToken();
    if (token) {
      cleanupTutorial(token).catch(() => {});
    }
    router.push("/dashboard");
  }, [sendWs, router]);

  return {
    currentStep,
    stepIndex,
    totalSteps: TUTORIAL_STEPS.length,
    isActive,
    canGoBack,
    advanceStep,
    goBack,
    skipTutorial,
  };
}
