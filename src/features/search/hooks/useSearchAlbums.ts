import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ApiAlbum } from "@/shared/api";
import { getLocalSavedItems } from "@/features/library/utils/savedMetadata";

export interface UseSearchAlbumsOptions {
  enabled?: boolean;
  limit?: number;
  debounceMs?: number;
}

export interface UseSearchAlbumsResult {
  albums: ApiAlbum[];
  loading: boolean;
  hasLoaded: boolean;
  error: Error | null;
  partialWarning?: string;
  runNow: () => void;
}

export function useSearchAlbums(
  query: string,
  options: UseSearchAlbumsOptions = {},
): UseSearchAlbumsResult {
  const { enabled = true, debounceMs = 250 } = options;
  const [albums, setAlbums] = useState<ApiAlbum[]>([]);
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

      // Run Liner search and iTunes album search in parallel
      const [linerRes, itunesRes] = await Promise.allSettled([
        api.search(q, "all"),
        fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(
            q,
          )}&entity=album&limit=20`,
        ).then((r) => (r.ok ? r.json() : null)),
      ]);

      if (requestId !== latestRequestIdRef.current) return;

      const albumMap = new Map<string, ApiAlbum>();

      // 0. Include matching albums from user's library
      const libraryAlbums = getLocalSavedItems("album");
      for (const item of libraryAlbums) {
        const title = item.title || "";
        const artistsStr = item.artists || "";
        if (
          title.toLowerCase().includes(qLower) ||
          artistsStr.toLowerCase().includes(qLower)
        ) {
          const normKey = title.toLowerCase().trim();
          albumMap.set(normKey, {
            type: "album",
            id: item.id,
            title,
            artists: [{ id: "", name: artistsStr }],
            year: item.year ? parseInt(item.year, 10) : undefined,
            cover: item.coverUrl ? { url: item.coverUrl, width: 1200, height: 1200 } : undefined,
          });
        }
      }

      // 1. Process Liner results (from tracks that have album info)
      if (linerRes.status === "fulfilled" && Array.isArray(linerRes.value?.items)) {
        for (const item of linerRes.value.items) {
          if (item.type === "album") {
            const raw = item as ApiAlbum;
            const key = (raw.title || "").toLowerCase().trim();
            if (key) albumMap.set(key, raw);
            continue;
          }

          const track = item as any;
          if (track.album && track.album.id && track.album.title) {
            const aTitle = (track.album.title || "").trim();
            const normKey = aTitle.toLowerCase();
            const trackArtists = Array.isArray(track.artists)
              ? track.artists.map((a: any) => ({
                  id: typeof a === "string" ? "" : a.id || "",
                  name: typeof a === "string" ? a : a.name || "",
                }))
              : typeof track.artists === "string"
                ? [{ id: "", name: track.artists }]
                : [];

            const trackCover = track.cover?.url
              ? track.cover
              : track.coverUrl
                ? { url: track.coverUrl, width: 1200, height: 1200 }
                : undefined;

            if (!albumMap.has(normKey)) {
              albumMap.set(normKey, {
                type: "album",
                id: track.album.id,
                title: aTitle,
                artists: trackArtists,
                cover: trackCover,
              });
            }
          }
        }
      }

      // 2. Process iTunes album results
      if (itunesRes.status === "fulfilled" && itunesRes.value?.results) {
        for (const it of itunesRes.value.results) {
          const rawTitle = (it.collectionName || "").trim();
          if (!rawTitle) continue;
          const normKey = rawTitle.toLowerCase().replace(/\s*\(deluxe.*?\)/i, "").trim();

          const coverHd = (it.artworkUrl100 || "").replace(/\/\d+x\d+bb\./, "/1200x1200bb.");
          const year = it.releaseDate ? parseInt(it.releaseDate.slice(0, 4), 10) : undefined;
          const artistName = it.artistName || "";

          if (!albumMap.has(normKey)) {
            albumMap.set(normKey, {
              type: "album",
              id: `itunes:${it.collectionId}`,
              title: rawTitle,
              artists: [{ id: String(it.artistId || ""), name: artistName }],
              year,
              cover: coverHd ? { url: coverHd, width: 1200, height: 1200 } : undefined,
            });
          }
        }
      }

      // 3. Sort albums by relevance
      const sortedAlbums = Array.from(albumMap.values()).sort((a, b) => {
        const aTitleLower = a.title.toLowerCase();
        const bTitleLower = b.title.toLowerCase();

        const aExact = aTitleLower === qLower;
        const bExact = bTitleLower === qLower;
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;

        const aStarts = aTitleLower.startsWith(qLower);
        const bStarts = bTitleLower.startsWith(qLower);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;

        return a.title.localeCompare(b.title);
      });

      setAlbums(sortedAlbums);
      setError(null);
      setPartialWarning(undefined);
      lastFetchedQueryRef.current = q;
      setHasLoaded(true);
    } catch (err) {
      if (requestId !== latestRequestIdRef.current) return;
      setAlbums([]);
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
      setAlbums([]);
      setHasLoaded(false);
      setLoading(false);
      setError(null);
      setPartialWarning(undefined);
      lastFetchedQueryRef.current = "";
      return;
    }

    if (!enabled) return;

    if (lastFetchedQueryRef.current === trimmed && albums.length > 0) {
      setLoading(false);
      setHasLoaded(true);
      return;
    }

    setLoading(true);
    const requestId = ++latestRequestIdRef.current;
    const timer = setTimeout(() => {
      if (lastFetchedQueryRef.current === trimmed && albums.length > 0) {
        setLoading(false);
        setHasLoaded(true);
        return;
      }
      void runRequest(requestId, trimmed);
    }, debounceMs);

    return () => {
      clearTimeout(timer);
    };
  }, [albums.length, debounceMs, enabled, runRequest, trimmed]);

  const runNow = useCallback(() => {
    if (!shouldRunSearch) return;
    const requestId = ++latestRequestIdRef.current;
    void runRequest(requestId, trimmed);
  }, [runRequest, shouldRunSearch, trimmed]);

  return { albums, loading, hasLoaded, error, partialWarning, runNow };
}
