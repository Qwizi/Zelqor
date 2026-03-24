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

  it("starts muted=true by default (no localStorage entry)", () => {
    const { result } = renderHook(() => useAudio());
    expect(result.current.muted).toBe(true);
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
      result.current.selectTrack(2);
    });

    expect(result.current.currentTrackIndex).toBe(2);
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
      result.current.selectTrack(1);
    });

    expect(MockAudio.instances.length).toBe(countBefore + 1);
    expect(MockAudio.instances[countBefore].src).toBe(MUSIC_TRACKS[1].src);
  });
});
