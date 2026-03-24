import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock lucide-react icons
// ---------------------------------------------------------------------------

vi.mock("lucide-react", () => ({
  SkipForward: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-skip", className }),
  ChevronRight: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-chevron-right", className }),
  ChevronLeft: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "icon-chevron-left", className }),
}));

// ---------------------------------------------------------------------------
// Mock shadcn/ui Button
// ---------------------------------------------------------------------------

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    size,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    size?: string;
    className?: string;
  }) => React.createElement("button", { onClick, className, "data-size": size }, children),
}));

import TutorialOverlay from "@/components/game/TutorialOverlay";
import type { TutorialStep } from "@/lib/tutorialSteps";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStep(overrides: Partial<TutorialStep> = {}): TutorialStep {
  return {
    id: "step-1",
    title: "Welcome Step",
    description: "This is the first step description.",
    manualAdvance: true,
    ...overrides,
  };
}

const defaultProps = {
  step: makeStep(),
  stepIndex: 0,
  totalSteps: 5,
  canGoBack: false,
  onAdvance: vi.fn(),
  onGoBack: vi.fn(),
  onSkip: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TutorialOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the step title", () => {
    render(React.createElement(TutorialOverlay, defaultProps));
    expect(screen.getByText("Welcome Step")).toBeTruthy();
  });

  it("renders the step description", () => {
    render(React.createElement(TutorialOverlay, defaultProps));
    expect(screen.getByText("This is the first step description.")).toBeTruthy();
  });

  it("renders correct number of progress bar segments", () => {
    const { container } = render(React.createElement(TutorialOverlay, defaultProps));
    // totalSteps=5 → 5 progress bar segments
    const segments = container.querySelectorAll(".h-1\\.5.flex-1.rounded-full");
    expect(segments.length).toBe(5);
  });

  it('shows "Dalej" button when not on last step and manualAdvance is true', () => {
    render(React.createElement(TutorialOverlay, { ...defaultProps, stepIndex: 0, totalSteps: 5 }));
    expect(screen.getByText("Dalej")).toBeTruthy();
  });

  it('shows "Zakoncz" button on the last step when manualAdvance is true', () => {
    render(
      React.createElement(TutorialOverlay, {
        ...defaultProps,
        stepIndex: 4,
        totalSteps: 5,
        step: makeStep({ manualAdvance: true }),
      }),
    );
    expect(screen.getByText("Zakoncz")).toBeTruthy();
  });

  it("calls onAdvance when the advance button is clicked", () => {
    const onAdvance = vi.fn();
    render(React.createElement(TutorialOverlay, { ...defaultProps, onAdvance }));
    fireEvent.click(screen.getByText("Dalej"));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("calls onSkip when the skip button is clicked", () => {
    const onSkip = vi.fn();
    render(React.createElement(TutorialOverlay, { ...defaultProps, onSkip }));
    fireEvent.click(screen.getByText("Pomin"));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('shows "Pomin" skip button', () => {
    render(React.createElement(TutorialOverlay, defaultProps));
    expect(screen.getByText("Pomin")).toBeTruthy();
  });

  it("hides back button when canGoBack is false", () => {
    render(React.createElement(TutorialOverlay, { ...defaultProps, canGoBack: false }));
    expect(screen.queryByText("Wstecz")).toBeNull();
  });

  it("shows back button when canGoBack is true", () => {
    render(React.createElement(TutorialOverlay, { ...defaultProps, canGoBack: true }));
    expect(screen.getByText("Wstecz")).toBeTruthy();
  });

  it("calls onGoBack when back button is clicked", () => {
    const onGoBack = vi.fn();
    render(React.createElement(TutorialOverlay, { ...defaultProps, canGoBack: true, onGoBack }));
    fireEvent.click(screen.getByText("Wstecz"));
    expect(onGoBack).toHaveBeenCalledTimes(1);
  });

  it("shows waiting indicator when manualAdvance is false", () => {
    const step = makeStep({ manualAdvance: false });
    render(React.createElement(TutorialOverlay, { ...defaultProps, step }));
    expect(screen.getByText("Wykonaj akcje...")).toBeTruthy();
  });

  it("does not show advance button when manualAdvance is false", () => {
    const step = makeStep({ manualAdvance: false });
    render(React.createElement(TutorialOverlay, { ...defaultProps, step }));
    expect(screen.queryByText("Dalej")).toBeNull();
    expect(screen.queryByText("Zakoncz")).toBeNull();
  });

  it("renders different step title when step prop changes", () => {
    const step = makeStep({ title: "Step Two Title" });
    render(React.createElement(TutorialOverlay, { ...defaultProps, step }));
    expect(screen.getByText("Step Two Title")).toBeTruthy();
  });

  it("renders step with no uiTarget without crashing", () => {
    const step = makeStep({ uiTarget: undefined });
    expect(() => render(React.createElement(TutorialOverlay, { ...defaultProps, step }))).not.toThrow();
  });

  it("renders step with uiTarget without crashing", () => {
    const step = makeStep({ uiTarget: "hud" });
    expect(() => render(React.createElement(TutorialOverlay, { ...defaultProps, step }))).not.toThrow();
  });

  it('step 3 of 3 shows "Zakoncz" (last step)', () => {
    render(
      React.createElement(TutorialOverlay, {
        ...defaultProps,
        stepIndex: 2,
        totalSteps: 3,
        step: makeStep({ manualAdvance: true }),
      }),
    );
    expect(screen.getByText("Zakoncz")).toBeTruthy();
  });
});
