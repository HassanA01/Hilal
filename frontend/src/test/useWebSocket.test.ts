import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useWebSocket } from "../hooks/useWebSocket";
import type { WsMessage } from "../types";

// Track all created instances for assertions.
const wsInstances: MockWebSocket[] = [];

class MockWebSocket {
  close = vi.fn();
  send = vi.fn();
  readyState = 1; // OPEN
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;

  constructor() {
    wsInstances.push(this);
  }
}

const noop = (_: WsMessage) => {};

describe("useWebSocket", () => {
  beforeEach(() => {
    wsInstances.length = 0;
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("registers a pagehide listener that closes the socket", () => {
    const addSpy = vi.spyOn(window, "addEventListener");

    renderHook(() =>
      useWebSocket({ url: "ws://test/socket", onMessage: noop, enabled: true }),
    );

    const pagehideCall = addSpy.mock.calls.find((c) => c[0] === "pagehide");
    expect(pagehideCall).toBeDefined();

    window.dispatchEvent(new Event("pagehide"));
    expect(wsInstances[0]!.close).toHaveBeenCalled();

    addSpy.mockRestore();
  });

  it("removes the pagehide listener on cleanup", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() =>
      useWebSocket({ url: "ws://test/socket", onMessage: noop, enabled: true }),
    );

    unmount();

    const removedPagehide = removeSpy.mock.calls.find(
      (c) => c[0] === "pagehide",
    );
    expect(removedPagehide).toBeDefined();

    removeSpy.mockRestore();
  });

  it("closes the socket on component unmount", () => {
    const { unmount } = renderHook(() =>
      useWebSocket({ url: "ws://test/socket", onMessage: noop, enabled: true }),
    );

    unmount();
    expect(wsInstances[0]!.close).toHaveBeenCalled();
  });

  it("does not open a socket when enabled=false", () => {
    renderHook(() =>
      useWebSocket({
        url: "ws://test/socket",
        onMessage: noop,
        enabled: false,
      }),
    );

    expect(wsInstances).toHaveLength(0);
  });

  it("reconnects with exponential backoff on unexpected close", () => {
    const onClose = vi.fn();
    renderHook(() =>
      useWebSocket({
        url: "ws://test/socket",
        onMessage: noop,
        onClose,
        enabled: true,
      }),
    );

    expect(wsInstances).toHaveLength(1);

    // Simulate unexpected close
    act(() => wsInstances[0].onclose?.());
    expect(onClose).toHaveBeenCalledTimes(1);

    // After 1s backoff, should reconnect
    act(() => { vi.advanceTimersByTime(1000); });
    expect(wsInstances).toHaveLength(2);

    // Second unexpected close — 2s backoff
    act(() => wsInstances[1].onclose?.());
    act(() => { vi.advanceTimersByTime(1000); });
    expect(wsInstances).toHaveLength(2); // not yet
    act(() => { vi.advanceTimersByTime(1000); });
    expect(wsInstances).toHaveLength(3);
  });

  it("resets backoff after successful open", () => {
    renderHook(() =>
      useWebSocket({ url: "ws://test/socket", onMessage: noop, enabled: true }),
    );

    // Close and reconnect
    act(() => wsInstances[0].onclose?.());
    act(() => { vi.advanceTimersByTime(1000); });
    expect(wsInstances).toHaveLength(2);

    // Successful open resets backoff
    act(() => wsInstances[1].onopen?.());

    // Close again — should be back to 1s backoff, not 2s
    act(() => wsInstances[1].onclose?.());
    act(() => { vi.advanceTimersByTime(1000); });
    expect(wsInstances).toHaveLength(3);
  });

  it("does not reconnect after intentional unmount", () => {
    const { unmount } = renderHook(() =>
      useWebSocket({ url: "ws://test/socket", onMessage: noop, enabled: true }),
    );

    unmount();
    act(() => { vi.advanceTimersByTime(20000); });
    expect(wsInstances).toHaveLength(1); // no reconnection attempts
  });

  it("does not reconnect after pagehide", () => {
    renderHook(() =>
      useWebSocket({ url: "ws://test/socket", onMessage: noop, enabled: true }),
    );

    window.dispatchEvent(new Event("pagehide"));

    // Simulate close triggered by pagehide
    act(() => wsInstances[0].onclose?.());
    act(() => { vi.advanceTimersByTime(20000); });
    expect(wsInstances).toHaveLength(1);
  });
});
