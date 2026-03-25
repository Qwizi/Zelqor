"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// Register ScrollTrigger plugin
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

// ── Entrance animations ─────────────────────────────────────────────────────

export function fadeInUp(
  targets: gsap.TweenTarget,
  options?: { delay?: number; duration?: number; stagger?: number; y?: number },
) {
  const { delay = 0, duration = 0.5, stagger = 0, y = 24 } = options ?? {};
  return gsap.fromTo(targets, { y, opacity: 0 }, { y: 0, opacity: 1, duration, delay, stagger, ease: "power2.out" });
}

export function scaleIn(targets: gsap.TweenTarget, options?: { delay?: number; duration?: number; stagger?: number }) {
  const { delay = 0, duration = 0.4, stagger = 0 } = options ?? {};
  return gsap.fromTo(
    targets,
    { scale: 0.85, opacity: 0 },
    { scale: 1, opacity: 1, duration, delay, stagger, ease: "power3.out" },
  );
}

export function slideInLeft(
  targets: gsap.TweenTarget,
  options?: { delay?: number; duration?: number; stagger?: number },
) {
  const { delay = 0, duration = 0.4, stagger = 0.05 } = options ?? {};
  return gsap.fromTo(
    targets,
    { x: -20, opacity: 0 },
    { x: 0, opacity: 1, duration, delay, stagger, ease: "power2.out" },
  );
}

// ── Counter animation ───────────────────────────────────────────────────────

export function countUp(
  element: HTMLElement,
  endValue: number,
  options?: { duration?: number; decimals?: number; suffix?: string },
) {
  const { duration = 1.2, decimals = 0, suffix = "" } = options ?? {};
  const obj = { value: 0 };
  return gsap.to(obj, {
    value: endValue,
    duration,
    ease: "power2.out",
    onUpdate: () => {
      element.textContent = obj.value.toFixed(decimals) + suffix;
    },
  });
}

// ── Scroll-triggered reveal ─────────────────────────────────────────────────

export function scrollReveal(
  targets: gsap.TweenTarget,
  trigger: Element,
  options?: {
    y?: number;
    stagger?: number;
    duration?: number;
    start?: string;
  },
) {
  const { y = 30, stagger = 0.06, duration = 0.5, start = "top 85%" } = options ?? {};
  return gsap.fromTo(
    targets,
    { y, opacity: 0 },
    {
      y: 0,
      opacity: 1,
      duration,
      stagger,
      ease: "power2.out",
      scrollTrigger: {
        trigger,
        start,
        toggleActions: "play none none none",
      },
    },
  );
}

// ── Parallax on scroll ──────────────────────────────────────────────────────

export function parallax(target: gsap.TweenTarget, trigger: Element, options?: { y?: number; speed?: number }) {
  const { y = 60, speed = 0.5 } = options ?? {};
  return gsap.to(target, {
    y: y * speed,
    ease: "none",
    scrollTrigger: {
      trigger,
      start: "top bottom",
      end: "bottom top",
      scrub: true,
    },
  });
}

// ── Re-export for convenience ───────────────────────────────────────────────

export { ScrollTrigger };
