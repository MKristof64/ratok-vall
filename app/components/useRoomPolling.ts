"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameRoom, RoomResponse } from "./game-types";
import { getApiError } from "./game-types";

export function useRoomPolling(code: string, intervalMs = 2500) {
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const mountedRef = useRef(true);

  const loadRoom = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);

      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(code)}`, {
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        if (response.status === 401) {
          const returnTo = `${window.location.pathname}${window.location.search}`;
          window.location.replace(`/unlock?returnTo=${encodeURIComponent(returnTo)}`);
          return;
        }

        if (response.status === 404 || response.status === 410) {
          if (mountedRef.current) {
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
        if (mountedRef.current) {
          setRoom(nextRoom);
          setError(null);
          setNotFound(false);
        }
      } catch (requestError) {
        if (mountedRef.current) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Most nem sikerült frissíteni a játékot.",
          );
        }
      } finally {
        if (mountedRef.current) setLoading(false);
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

    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
    };
  }, [intervalMs, loadRoom]);

  return {
    room,
    setRoom,
    loading,
    error,
    notFound,
    refresh: () => loadRoom(true),
  };
}
