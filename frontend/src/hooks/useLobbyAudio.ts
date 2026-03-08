import { useEffect, useRef, useState, useCallback } from "react";

const LOBBY_VOLUME = 0.25;
const FADE_MS = 500;

export function useLobbyAudio() {
  const [muted, setMuted] = useState(() => localStorage.getItem("hilal_audio_muted") === "true");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio("/audio/lobby-loop.mp3");
    audio.loop = true;
    audio.volume = LOBBY_VOLUME;
    audio.preload = "auto";
    audio.muted = muted;
    audioRef.current = audio;

    audio.play().catch(() => {
      // Autoplay blocked — will start on user interaction
    });

    return () => {
      // Fade out on unmount (navigating to game)
      const start = audio.volume;
      const step = start / (FADE_MS / 16);
      const id = setInterval(() => {
        const next = audio.volume - step;
        if (next <= 0) {
          clearInterval(id);
          audio.pause();
        } else {
          audio.volume = next;
        }
      }, 16);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    localStorage.setItem("hilal_audio_muted", String(muted));
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  return { muted, toggleMute };
}
