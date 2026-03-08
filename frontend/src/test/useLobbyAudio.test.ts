import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useLobbyAudio } from "../hooks/useLobbyAudio";

const createMockAudio = () => ({
  play: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  volume: 1,
  muted: false,
  loop: false,
  currentTime: 0,
  paused: true,
  preload: "",
});

let audioInstances: ReturnType<typeof createMockAudio>[];

beforeEach(() => {
  audioInstances = [];
  globalThis.Audio = function MockAudio() {
    const mock = createMockAudio();
    audioInstances.push(mock);
    return mock;
  } as unknown as typeof Audio;
  localStorage.clear();
});

describe("useLobbyAudio", () => {
  it("creates audio element and starts playing on mount", () => {
    renderHook(() => useLobbyAudio());
    expect(audioInstances).toHaveLength(1);
    const audio = audioInstances[0];
    expect(audio.play).toHaveBeenCalled();
    expect(audio.loop).toBe(true);
    expect(audio.volume).toBe(0.25);
  });

  it("pauses audio on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useLobbyAudio());
    unmount();
    // Advance past fade-out duration
    vi.advanceTimersByTime(600);
    expect(audioInstances[0].pause).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("toggleMute flips muted and persists to localStorage", () => {
    const { result } = renderHook(() => useLobbyAudio());
    expect(result.current.muted).toBe(false);

    act(() => result.current.toggleMute());
    expect(result.current.muted).toBe(true);
    expect(localStorage.getItem("hilal_audio_muted")).toBe("true");
  });

  it("reads muted state from localStorage on mount", () => {
    localStorage.setItem("hilal_audio_muted", "true");
    const { result } = renderHook(() => useLobbyAudio());
    expect(result.current.muted).toBe(true);
    expect(audioInstances[0].muted).toBe(true);
  });

  it("shares mute preference key with useGameAudio", () => {
    const { result } = renderHook(() => useLobbyAudio());
    act(() => result.current.toggleMute());
    // Same key used by useGameAudio
    expect(localStorage.getItem("hilal_audio_muted")).toBe("true");
  });
});
