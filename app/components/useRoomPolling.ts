"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { GameRoom, RoomResponse } from "./game-types";
import { getApiError } from "./game-types";

export function useRoomPolling(code: string, intervalMs = 2500) {
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const mountedRef = useRef(true);
  const requestGenerationRef = useRef(0);
  const inFlightRef = useRef<AbortController | null>(null);

  const updateRoom: Dispatch<SetStateAction<GameRoom | null>> = useCallback(
    (nextRoom) => {
      requestGenerationRef.current += 1;
      inFlightRef.current?.abort();
      inFlightRef.current = null;
      setRoom(nextRoom);
      setLoading(false);
    },
    [],
  );

  const loadRoom = useCallback(
    async (quiet = false, supersede = false) => {
      if (inFlightRef.current && !supersede) return;
      if (supersede) inFlightRef.current?.abort();

      const controller = new AbortController();
      const requestGeneration = requestGenerationRef.current + 1;
      requestGenerationRef.current = requestGeneration;
      inFlightRef.current = controller;
      if (!quiet) setLoading(true);

      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(code)}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });

        if (response.status === 401) {
          const returnTo = `${window.location.pathname}${window.location.search}`;
          window.location.replace(`/unlock?returnTo=${encodeURIComponent(returnTo)}`);
          return;
        }

        if (response.status === 404 || response.status === 410) {
          if (
            mountedRef.current &&
            requestGeneration === requestGenerationRef.current
          ) {
            setNotFound(true);
            setError(null);
          }
          return;
        }

        if (!response.ok) {
          throw new Error(await getApiError(response));
        }

        const payload = (await response.json()) as RoomResponse | GameRoom;
        const nextRoom =
          "room" in payload && payload.room ? payload.room : (payload as GameRoom);
        if (
          mountedRef.current &&
          requestGeneration === requestGenerationRef.current
        ) {
          setRoom(nextRoom);
          setError(null);
          setNotFound(false);
        }
      } catch (requestError) {
        if (
          !controller.signal.aborted &&
          mountedRef.current &&
          requestGeneration === requestGenerationRef.current
        ) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Most nem sikerült frissíteni a játékot.",
          );
        }
      } finally {
        if (inFlightRef.current === controller) inFlightRef.current = null;
        if (
          mountedRef.current &&
          requestGeneration === requestGenerationRef.current
        ) {
          setLoading(false);
        }
      }
    },
    [code],
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadRoom();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadRoom(true);
    }, intervalMs);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadRoom(true, true);
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      inFlightRef.current?.abort();
      inFlightRef.current = null;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [intervalMs, loadRoom]);

  return {
    room,
    setRoom: updateRoom,
    loading,
    error,
    notFound,
    refresh: () => loadRoom(true, true),
  };
}
