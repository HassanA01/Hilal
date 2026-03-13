import { useEffect, useRef, useCallback } from "react";
import type { WsMessage } from "../types";

interface UseWebSocketOptions {
  url: string;
  onMessage: (msg: WsMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (event: Event) => void;
  enabled?: boolean;
}

const MAX_BACKOFF_MS = 16_000;
const INITIAL_BACKOFF_MS = 1_000;

export function useWebSocket({
  url,
  onMessage,
  onOpen,
  onClose,
  onError,
  enabled = true,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const intentionalClose = useRef(false);
  const backoffMs = useRef(INITIAL_BACKOFF_MS);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep all callbacks in refs so they never appear in the effect deps.
  const onMessageRef = useRef(onMessage);
  const onOpenRef = useRef(onOpen);
  const onCloseRef = useRef(onClose);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onOpenRef.current = onOpen;
    onCloseRef.current = onClose;
    onErrorRef.current = onError;
  });

  const send = useCallback((msg: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    intentionalClose.current = false;
    backoffMs.current = INITIAL_BACKOFF_MS;

    function connect() {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        backoffMs.current = INITIAL_BACKOFF_MS;
        onOpenRef.current?.();
      };

      ws.onclose = () => {
        onCloseRef.current?.();
        if (!intentionalClose.current) {
          // Schedule reconnect with exponential backoff
          const delay = backoffMs.current;
          backoffMs.current = Math.min(backoffMs.current * 2, MAX_BACKOFF_MS);
          reconnectTimer.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = (e) => onErrorRef.current?.(e);

      ws.onmessage = (event) => {
        // writePump may batch multiple messages in one frame (newline-separated).
        const frames = (event.data as string).split("\n").filter(Boolean);
        for (const frame of frames) {
          try {
            const msg = JSON.parse(frame) as WsMessage;
            onMessageRef.current(msg);
          } catch {
            console.error("Failed to parse WS message", frame);
          }
        }
      };
    }

    connect();

    // Close proactively on tab close / navigation so the server detects the
    // disconnect immediately rather than waiting for the ping/pong timeout.
    const handlePageHide = () => {
      intentionalClose.current = true;
      wsRef.current?.close();
    };
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      intentionalClose.current = true;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      window.removeEventListener("pagehide", handlePageHide);
      wsRef.current?.close();
    };
  }, [url, enabled]); // callbacks intentionally excluded — they live in refs

  return { send };
}
