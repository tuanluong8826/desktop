import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ApiArtist } from "@/shared/api";

export interface UseSearchArtistsOptions {
  enabled?: boolean;
  limit?: number;
  debounceMs?: number;
}

export interface UseSearchArtistsResult {
  artists: ApiArtist[];
  loading: boolean;
  hasLoaded: boolean;
  error: Error | null;
  partialWarning?: string;
  runNow: () => void;
}

export function useSearchArtists(
  query: string,
  options: UseSearchArtistsOptions = {},
): UseSearchArtistsResult {
  const { enabled = true, debounceMs = 250 } = options;
  const [artists, setArtists] = useState<ApiArtist[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [partialWarning, setPartialWarning] = useState<string | undefined>();

  const latestRequestIdRef = useRef(0);
  const lastFetchedQueryRef = useRef("");
  const trimmed = query.trim();
  const shouldRunSearch = enabled && trimmed.length >= 2;

  const runRequest = useCallback(async (requestId: number, q: string) => {
    setLoading(true);
    try {
      const qLower = q.toLowerCase();

      // Run Liner search and iTunes artist search in parallel
      const [linerRes, itunesRes] = await Promise.allSettled([
        api.search(q, "all"),
        fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(
            q,
          )}&entity=musicArtist&limit=10`,
        ).then((r) => (r.ok ? r.json() : null)),
      ]);

      if (requestId !== latestRequestIdRef.current) return;

      const artistMap = new Map<string, ApiArtist>();

      // 1. Process Liner results (extract from tracks and explicit artist items)
      if (linerRes.status === "fulfilled" && Array.isArray(linerRes.value?.items)) {
        for (const item of linerRes.value.items) {
          if (item.type === "artist") {
            const raw = item as ApiArtist;
            const key = (raw.name || "").toLowerCase().trim();
            if (key && key !== "artist" && key !== "unknown") {
              artistMap.set(key, raw);
            }
            continue;
          }

          // From track item
          const track = item as any;
          const list = track.artists || track.artistList || [];
          if (Array.isArray(list)) {
            for (const a of list) {
              const aName = typeof a === "string" ? a.trim() : (a.name || "").trim();
              const aId = typeof a === "string" ? "" : (a.id || "").trim();
              if (!aName || aName.toLowerCase() === "artist" || aName.toLowerCase() === "unknown") {
                continue;
              }
              const normKey = aName.toLowerCase();
              const trackCover = track.cover?.url
                ? track.cover
                : track.coverUrl
                  ? { url: track.coverUrl }
                  : undefined;

              const existing = artistMap.get(normKey);
              if (!existing) {
                artistMap.set(normKey, {
                  type: "artist",
                  id: aId || aName,
                  name: aName,
                  cover: trackCover,
                });
              } else if (aId && aId.startsWith("UC") && !existing.id.startsWith("UC")) {
                existing.id = aId;
                if (!existing.cover && trackCover) existing.cover = trackCover;
              }
            }
          }
        }
      }

      // 2. Process iTunes results
      if (itunesRes.status === "fulfilled" && itunesRes.value?.results) {
        for (const it of itunesRes.value.results) {
          const aName = (it.artistName || "").trim();
          if (!aName) continue;
          const normKey = aName.toLowerCase();
          if (!artistMap.has(normKey)) {
            artistMap.set(normKey, {
              type: "artist",
              id: aName,
              name: aName,
            });
          }
        }
      }

      // 3. Score and sort artists by relevancy to query
      const sortedArtists = Array.from(artistMap.values()).sort((a, b) => {
        const aNameLower = a.name.toLowerCase();
        const bNameLower = b.name.toLowerCase();

        const aExact = aNameLower === qLower;
        const bExact = bNameLower === qLower;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;

        const aStarts = aNameLower.startsWith(qLower);
        const bStarts = bNameLower.startsWith(qLower);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;

        const aHasUC = a.id.startsWith("UC");
        const bHasUC = b.id.startsWith("UC");
        if (aHasUC && !bHasUC) return -1;
        if (!aHasUC && bHasUC) return 1;

        return a.name.localeCompare(b.name);
      });

      setArtists(sortedArtists);
      setError(null);
      setPartialWarning(undefined);
      lastFetchedQueryRef.current = q;
      setHasLoaded(true);
    } catch (err) {
      if (requestId !== latestRequestIdRef.current) return;
      setArtists([]);
      setError(err instanceof Error ? err : new Error(String(err)));
      setPartialWarning(undefined);
      setHasLoaded(true);
    } finally {
      if (requestId === latestRequestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (trimmed.length < 2) {
      latestRequestIdRef.current += 1;
      setArtists([]);
      setHasLoaded(false);
      setLoading(false);
      setError(null);
      setPartialWarning(undefined);
      lastFetchedQueryRef.current = "";
      return;
    }

    if (!enabled) return;

    if (lastFetchedQueryRef.current === trimmed && artists.length > 0) {
      setLoading(false);
      setHasLoaded(true);
      return;
    }

    setLoading(true);
    const requestId = ++latestRequestIdRef.current;
    const timer = setTimeout(() => {
      if (lastFetchedQueryRef.current === trimmed && artists.length > 0) {
        setLoading(false);
        setHasLoaded(true);
        return;
      }
      void runRequest(requestId, trimmed);
    }, debounceMs);

    return () => {
      clearTimeout(timer);
    };
  }, [artists.length, debounceMs, enabled, runRequest, trimmed]);

  const runNow = useCallback(() => {
    if (!shouldRunSearch) return;
    const requestId = ++latestRequestIdRef.current;
    void runRequest(requestId, trimmed);
  }, [runRequest, shouldRunSearch, trimmed]);

  return { artists, loading, hasLoaded, error, partialWarning, runNow };
}
