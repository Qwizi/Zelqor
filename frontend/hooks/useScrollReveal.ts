"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { scrollReveal } from "@/lib/animations";

interface UseScrollRevealOptions {
  /** Selector for child elements to animate (default: direct children) */
  selector?: string;
  /** Y offset to animate from (default: 30) */
  y?: number;
  /** Stagger between elements (default: 0.06) */
  stagger?: number;
  /** Animation duration (default: 0.5) */
  duration?: number;
  /** ScrollTrigger start position (default: "top 85%") */
  start?: string;
  /** Disable the animation */
  disabled?: boolean;
}

/**
 * Hook that reveals child elements with a fade-up animation when scrolled into view.
 *
 * @example
 * ```tsx
 * const containerRef = useScrollReveal({ selector: "[data-reveal]" });
 * return (
 *   <div ref={containerRef}>
 *     <div data-reveal>Card 1</div>
 *     <div data-reveal>Card 2</div>
 *   </div>
 * );
 * ```
 */
export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(
  options?: UseScrollRevealOptions
) {
  const ref = useRef<T>(null);
  const {
    selector,
    y = 30,
    stagger = 0.06,
    duration = 0.5,
    start = "top 85%",
    disabled = false,
  } = options ?? {};

  useGSAP(
    () => {
      if (disabled || !ref.current) return;
      const targets = selector
        ? ref.current.querySelectorAll(selector)
        : ref.current.children;
      if (targets.length === 0) return;
      scrollReveal(targets, ref.current, { y, stagger, duration, start });
    },
    { scope: ref, dependencies: [disabled] }
  );

  return ref;
}
