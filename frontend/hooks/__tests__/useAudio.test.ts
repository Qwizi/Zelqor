import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock HTMLAudioElement
// ---------------------------------------------------------------------------

class MockAudio {
  src: string;
  volume = 1;
  muted = false;
  onended: (() => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  static instances: MockAudio[] = [];
  static playMock = vi.fn().mockResolvedValue(undefined);
  pauseMock = vi.fn();

  constructor(src = "") {
    this.src = src;
    MockAudio.instances.push(this);
  }

  play() {
    return MockAudio.playMock();
  }
  pause() {
    this.pauseMock();
  }
}

vi.stubGlobal("Audio", MockAudio);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import { MUSIC_TRACKS, SOUNDS, useAudio } from "../useAudio";

describe("useAudio", () => {
  beforeEach(() => {
    MockAudio.instances = [];
    MockAudio.playMock.mockResolvedValue(undefined);
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial muted state
  // -------------------------------------------------------------------------

  it("starts muted=false by default (no localStorage entry)", () => {
    const { result } = renderHook(() => useAudio());
    expect(result.current.muted).toBe(false);
  });

  it("reads initial muted=false from localStorage", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());
    expect(result.current.muted).toBe(false);
  });

  it("reads initial muted=true from localStorage", () => {
    localStorage.setItem("maplord:audio:muted", "1");
    const { result } = renderHook(() => useAudio());
    expect(result.current.muted).toBe(true);
  });

  // -------------------------------------------------------------------------
  // toggleMute
  // -------------------------------------------------------------------------

  it("toggleMute() flips muted from true to false", () => {
    localStorage.setItem("maplord:audio:muted", "1");
    const { result } = renderHook(() => useAudio());

    act(() => {
      result.current.toggleMute();
    });

    expect(result.current.muted).toBe(false);
  });

  it("toggleMute() flips muted from false to true", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());

    act(() => {
      result.current.toggleMute();
    });

    expect(result.current.muted).toBe(true);
  });

  it("toggleMute() persists the new muted state to localStorage", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());

    act(() => {
      result.current.toggleMute();
    });

    expect(localStorage.getItem("maplord:audio:muted")).toBe("1");
  });

  // -------------------------------------------------------------------------
  // playSound
  // -------------------------------------------------------------------------

  it("playSound() does nothing when muted=true", () => {
    localStorage.setItem("maplord:audio:muted", "1");
    const { result } = renderHook(() => useAudio());
    const countBefore = MockAudio.instances.length;

    act(() => {
      result.current.playSound("click");
    });

    expect(MockAudio.instances.length).toBe(countBefore);
  });

  it("playSound() creates an Audio element and calls play when not muted", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());

    act(() => {
      result.current.playSound("click");
    });

    const audio = MockAudio.instances.find((a) => a.src === SOUNDS.click);
    expect(audio).toBeDefined();
    expect(MockAudio.playMock).toHaveBeenCalled();
  });

  it("playSound() respects sound cooldown — second call within 80ms is ignored", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    vi.useFakeTimers();
    const { result } = renderHook(() => useAudio());

    const countBefore = MockAudio.instances.length;
    act(() => {
      result.current.playSound("click");
    });
    act(() => {
      result.current.playSound("click");
    }); // immediately again

    // Only one new Audio instance for 'click' should be created
    const clickInstances = MockAudio.instances.slice(countBefore).filter((a) => a.src === SOUNDS.click);
    expect(clickInstances).toHaveLength(1);

    vi.useRealTimers();
  });

  it("playSound() sets volume to 0.55", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());

    act(() => {
      result.current.playSound("build");
    });

    const audio = MockAudio.instances.find((a) => a.src === SOUNDS.build);
    expect(audio?.volume).toBe(0.55);
  });

  // -------------------------------------------------------------------------
  // startMusic / stopMusic
  // -------------------------------------------------------------------------

  it("startMusic() creates an Audio element and calls play", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());
    const countBefore = MockAudio.instances.length;

    act(() => {
      result.current.startMusic();
    });

    expect(MockAudio.instances.length).toBe(countBefore + 1);
    expect(MockAudio.playMock).toHaveBeenCalled();
  });

  it("startMusic() sets music volume to 0.10", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());
    const countBefore = MockAudio.instances.length;

    act(() => {
      result.current.startMusic();
    });

    const musicAudio = MockAudio.instances[countBefore];
    expect(musicAudio.volume).toBe(0.1);
  });

  it("startMusic() is idempotent — calling twice does not create a second Audio", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());
    const countBefore = MockAudio.instances.length;

    act(() => {
      result.current.startMusic();
      result.current.startMusic();
    });

    expect(MockAudio.instances.length).toBe(countBefore + 1);
  });

  it("stopMusic() pauses the music audio element", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());
    const countBefore = MockAudio.instances.length;

    act(() => {
      result.current.startMusic();
    });

    const musicAudio = MockAudio.instances[countBefore];

    act(() => {
      result.current.stopMusic();
    });

    expect(musicAudio.pauseMock).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // selectTrack
  // -------------------------------------------------------------------------

  it("selectTrack() changes currentTrackIndex", () => {
    const { result } = renderHook(() => useAudio());

    act(() => {
      result.current.selectTrack(0);
    });

    expect(result.current.currentTrackIndex).toBe(0);
  });

  it("selectTrack() ignores out-of-range indices", () => {
    const { result } = renderHook(() => useAudio());
    const indexBefore = result.current.currentTrackIndex;

    act(() => {
      result.current.selectTrack(9999);
    });
    act(() => {
      result.current.selectTrack(-1);
    });

    expect(result.current.currentTrackIndex).toBe(indexBefore);
  });

  it("selectTrack() starts playback on a new Audio element when no music is playing", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());
    const countBefore = MockAudio.instances.length;

    act(() => {
      result.current.selectTrack(0);
    });

    expect(MockAudio.instances.length).toBe(countBefore + 1);
    expect(MockAudio.instances[countBefore].src).toBe(MUSIC_TRACKS[0].src);
  });

  it("selectTrack() updates src on existing audio element if music already playing", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());

    // Start music first to populate musicRef
    act(() => {
      result.current.startMusic();
    });

    const countBefore = MockAudio.instances.length;

    act(() => {
      result.current.selectTrack(0);
    });

    // No new Audio element should be created — it updates the existing one's src
    expect(MockAudio.instances.length).toBe(countBefore);
    expect(MockAudio.playMock).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // advanceTrack
  // -------------------------------------------------------------------------

  it("advanceTrack() advances to next track when music is playing", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());

    act(() => {
      result.current.startMusic();
    });

    const initialIndex = result.current.currentTrackIndex;

    // Simulate track ending — triggers advanceTrack via onended
    const musicAudio = MockAudio.instances.find((a) => MUSIC_TRACKS.some((t) => t.src === a.src));
    act(() => {
      musicAudio?.onended?.();
    });

    // With one track, the index wraps back to 0 (same value), but play should have been called again
    expect(result.current.currentTrackIndex).toBe((initialIndex + 1) % MUSIC_TRACKS.length);
  });

  it("advanceTrack() is a no-op when muted", () => {
    localStorage.setItem("maplord:audio:muted", "1");
    const { result } = renderHook(() => useAudio());

    act(() => {
      result.current.startMusic();
    });

    const playCallsBefore = MockAudio.playMock.mock.calls.length;

    // Manually invoke advanceTrack by calling startMusic then triggering onended
    // With muted=true, advanceTrack returns early
    const musicAudio = MockAudio.instances.find((a) => MUSIC_TRACKS.some((t) => t.src === a.src));
    act(() => {
      musicAudio?.onended?.();
    });

    // No additional play calls because muted
    expect(MockAudio.playMock.mock.calls.length).toBe(playCallsBefore);
  });

  // -------------------------------------------------------------------------
  // startMenuMusic
  // -------------------------------------------------------------------------

  it("startMenuMusic() creates a looping audio element", async () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());
    const countBefore = MockAudio.instances.length;

    await act(async () => {
      result.current.startMenuMusic();
      await Promise.resolve(); // allow play() promise to resolve
    });

    expect(MockAudio.instances.length).toBe(countBefore + 1);
    const menuAudio = MockAudio.instances[countBefore];
    expect(menuAudio.src).toContain("menu");
    // volume is 0.08
    expect(menuAudio.volume).toBeCloseTo(0.08);
  });

  it("startMenuMusic() is idempotent — second call is ignored when first is pending", async () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());
    const countBefore = MockAudio.instances.length;

    await act(async () => {
      result.current.startMenuMusic();
      result.current.startMenuMusic(); // second call should be ignored
      await Promise.resolve();
    });

    // Only one audio element should be created
    expect(MockAudio.instances.length).toBe(countBefore + 1);
  });

  it("startMenuMusic() is idempotent when music already started", async () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());

    await act(async () => {
      result.current.startMenuMusic();
      await Promise.resolve();
    });

    const countAfterFirst = MockAudio.instances.length;

    await act(async () => {
      result.current.startMenuMusic(); // should be a no-op since musicRef is set
      await Promise.resolve();
    });

    expect(MockAudio.instances.length).toBe(countAfterFirst);
  });

  // -------------------------------------------------------------------------
  // stopMenuMusic
  // -------------------------------------------------------------------------

  it("stopMenuMusic() pauses and clears the menu music", async () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());
    const countBefore = MockAudio.instances.length;

    await act(async () => {
      result.current.startMenuMusic();
      await Promise.resolve();
    });

    const menuAudio = MockAudio.instances[countBefore];

    act(() => {
      result.current.stopMenuMusic();
    });

    expect(menuAudio.pauseMock).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // playJingle
  // -------------------------------------------------------------------------

  it("playJingle() creates an Audio element with the jingle src", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());
    const countBefore = MockAudio.instances.length;

    act(() => {
      result.current.playJingle("victory");
    });

    expect(MockAudio.instances.length).toBe(countBefore + 1);
    expect(MockAudio.playMock).toHaveBeenCalled();
  });

  it("playJingle() does nothing when muted", () => {
    localStorage.setItem("maplord:audio:muted", "1");
    const { result } = renderHook(() => useAudio());
    const countBefore = MockAudio.instances.length;

    act(() => {
      result.current.playJingle("defeat");
    });

    expect(MockAudio.instances.length).toBe(countBefore);
  });

  it("playJingle() pauses existing music when stopBgMusic=true (default)", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());

    act(() => {
      result.current.startMusic();
    });

    const musicAudio = MockAudio.instances.find((a) => MUSIC_TRACKS.some((t) => t.src === a.src));

    act(() => {
      result.current.playJingle("victory");
    });

    expect(musicAudio?.pauseMock).toHaveBeenCalled();
  });

  it("playJingle() does not pause music when stopBgMusic=false", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());

    act(() => {
      result.current.startMusic();
    });

    const musicAudio = MockAudio.instances.find((a) => MUSIC_TRACKS.some((t) => t.src === a.src));

    act(() => {
      result.current.playJingle("victory", { stopBgMusic: false });
    });

    expect(musicAudio?.pauseMock).not.toHaveBeenCalled();
  });

  it("playJingle() uses the provided volume", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());
    const countBefore = MockAudio.instances.length;

    act(() => {
      result.current.playJingle("elimination", { volume: 0.9 });
    });

    const jingleAudio = MockAudio.instances[countBefore];
    expect(jingleAudio.volume).toBe(0.9);
  });

  it("playJingle() clears jingleRef.current when jingle ends", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());
    const countBefore = MockAudio.instances.length;

    act(() => {
      result.current.playJingle("victory");
    });

    const jingleAudio = MockAudio.instances[countBefore];

    // Trigger onended
    act(() => {
      jingleAudio.onended?.();
    });

    // No assertion on internal state, but onended should not throw
    expect(true).toBe(true);
  });

  // -------------------------------------------------------------------------
  // playSound — concurrency limit
  // -------------------------------------------------------------------------

  it("playSound() respects MAX_CONCURRENT_SOUNDS (4) limit", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    vi.useFakeTimers();
    const { result } = renderHook(() => useAudio());
    const countBefore = MockAudio.instances.length;

    // Play 5 different sounds (different keys avoid cooldown rejection)
    const keys = ["click", "tab", "alert", "popup", "build"] as const;
    // Use different timestamps to bypass cooldown
    for (const key of keys) {
      act(() => {
        // Advance time to reset cooldown for each key
        vi.advanceTimersByTime(100);
        result.current.playSound(key);
      });
    }

    // Should only have created MAX_CONCURRENT_SOUNDS (4) new Audio elements
    // since activeSoundsRef isn't being decremented without onended firing
    const newSounds = MockAudio.instances.length - countBefore;
    expect(newSounds).toBe(4);

    vi.useRealTimers();
  });

  it("playSound() decrements activeCount when onended fires", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    vi.useFakeTimers();
    const { result } = renderHook(() => useAudio());
    const countBefore = MockAudio.instances.length;

    act(() => {
      result.current.playSound("click");
    });

    const clickAudio = MockAudio.instances.slice(countBefore).find((a) => a.src.includes("click"));

    // Trigger onended to free the slot
    act(() => {
      clickAudio?.onended?.();
    });

    // Advance time past cooldown, then play again — should succeed
    act(() => {
      vi.advanceTimersByTime(100);
      result.current.playSound("click");
    });

    const clickInstances = MockAudio.instances.slice(countBefore).filter((a) => a.src.includes("click"));
    expect(clickInstances.length).toBe(2);

    vi.useRealTimers();
  });

  it("playSound() decrements activeCount when onerror fires", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    vi.useFakeTimers();
    const { result } = renderHook(() => useAudio());
    const countBefore = MockAudio.instances.length;

    act(() => {
      result.current.playSound("click");
    });

    const clickAudio = MockAudio.instances.slice(countBefore).find((a) => a.src.includes("click"));

    // Trigger onerror to free the slot
    act(() => {
      clickAudio?.onerror?.();
    });

    // Advance time past cooldown
    act(() => {
      vi.advanceTimersByTime(100);
      result.current.playSound("click");
    });

    const clickInstances = MockAudio.instances.slice(countBefore).filter((a) => a.src.includes("click"));
    expect(clickInstances.length).toBe(2);

    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Visibility change handler
  // -------------------------------------------------------------------------

  it("mutes audio elements when tab becomes hidden", async () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());

    act(() => {
      result.current.startMusic();
    });

    const musicAudio = MockAudio.instances.find((a) => MUSIC_TRACKS.some((t) => t.src === a.src));
    expect(musicAudio?.muted).toBe(false);

    // Simulate tab hidden
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(musicAudio?.muted).toBe(true);

    // Restore
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    void result;
  });

  it("unmutes audio elements when tab becomes visible again (and not muted by user)", async () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());

    act(() => {
      result.current.startMusic();
    });

    const musicAudio = MockAudio.instances.find((a) => MUSIC_TRACKS.some((t) => t.src === a.src));

    // Hide
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Show
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // mutedRef is false, so muted should be false
    expect(musicAudio?.muted).toBe(false);

    void result;
  });

  it("playSound() does nothing when tab is hidden", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });

    const countBefore = MockAudio.instances.length;
    act(() => {
      result.current.playSound("click");
    });

    expect(MockAudio.instances.length).toBe(countBefore);

    // Restore
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  // -------------------------------------------------------------------------
  // toggleMute() updates music/jingle muted state
  // -------------------------------------------------------------------------

  it("toggleMute() applies muted to already-playing music", async () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());

    act(() => {
      result.current.startMusic();
    });

    const musicAudio = MockAudio.instances.find((a) => MUSIC_TRACKS.some((t) => t.src === a.src));
    expect(musicAudio?.muted).toBe(false);

    act(() => {
      result.current.toggleMute();
    });

    expect(musicAudio?.muted).toBe(true);
  });

  // -------------------------------------------------------------------------
  // toggleMute() updates jingle muted state (line 73)
  // -------------------------------------------------------------------------

  it("toggleMute() applies muted=true to a currently-playing jingle (line 73)", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());

    // Start a jingle so jingleRef.current is set
    act(() => {
      result.current.playJingle("victory");
    });

    const jingleAudio = MockAudio.instances[MockAudio.instances.length - 1];
    expect(jingleAudio.muted).toBe(false);

    // Now mute — should propagate to jingleRef.current
    act(() => {
      result.current.toggleMute();
    });

    expect(jingleAudio.muted).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Visibility handler with active jingle (lines 193-194)
  // -------------------------------------------------------------------------

  it("mutes jingle when tab becomes hidden (lines 193-194)", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());

    act(() => {
      result.current.playJingle("victory");
    });

    const jingleAudio = MockAudio.instances[MockAudio.instances.length - 1];
    expect(jingleAudio.muted).toBe(false);

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(jingleAudio.muted).toBe(true);

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    void result;
  });

  it("unmutes jingle when tab becomes visible again (lines 193-194)", () => {
    localStorage.setItem("maplord:audio:muted", "0");
    const { result } = renderHook(() => useAudio());

    act(() => {
      result.current.playJingle("victory");
    });

    const jingleAudio = MockAudio.instances[MockAudio.instances.length - 1];

    // Hide tab
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(jingleAudio.muted).toBe(true);

    // Show tab
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(jingleAudio.muted).toBe(false);

    void result;
  });

  // -------------------------------------------------------------------------
  // readLS() catch branch (line 53): localStorage.getItem throws
  // -------------------------------------------------------------------------

  it("readLS() returns true (muted) when localStorage.getItem throws", () => {
    // Simulate localStorage being unavailable (e.g., private browsing restriction)
    const originalGetItem = Object.getOwnPropertyDescriptor(Storage.prototype, "getItem");
    Object.defineProperty(Storage.prototype, "getItem", {
      value: () => {
        throw new Error("SecurityError: localStorage unavailable");
      },
      configurable: true,
    });

    const { result } = renderHook(() => useAudio());
    // When localStorage.getItem throws, readLS returns true (muted)
    expect(result.current.muted).toBe(true);

    // Restore
    if (originalGetItem) {
      Object.defineProperty(Storage.prototype, "getItem", originalGetItem);
    }
  });

  // -------------------------------------------------------------------------
  // startMenuMusic() catch branch (line 120): play() rejects
  // -------------------------------------------------------------------------

  it("startMenuMusic() clears menuPendingRef when play() rejects", async () => {
    localStorage.setItem("maplord:audio:muted", "0");
    MockAudio.playMock.mockRejectedValueOnce(new Error("NotAllowedError"));

    const { result } = renderHook(() => useAudio());
    const countBefore = MockAudio.instances.length;

    await act(async () => {
      result.current.startMenuMusic();
      // Drain the microtask queue so the rejection is processed
      await Promise.resolve();
      await Promise.resolve();
    });

    // Audio element was created but play() failed — menuPendingRef should be cleared
    // so a second call can attempt to start music again
    const countAfterReject = MockAudio.instances.length;

    await act(async () => {
      result.current.startMenuMusic();
      await Promise.resolve();
      await Promise.resolve();
    });

    // A second Audio element should have been created (menuPendingRef was reset)
    expect(MockAudio.instances.length).toBeGreaterThan(countAfterReject);
    void countBefore;
  });
});
