import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ApiSearchItem, type ApiArtist, type ApiAlbum } from "@/shared/api";
import { getLocalSavedItems } from "@/features/library/utils/savedMetadata";

export interface UseSearchAllOptions {
  enabled: boolean;
  limit: number;
  debounceMs: number;
}

export interface UseSearchAllResult {
  items: ApiSearchItem[];
  loading: boolean;
  hasLoaded: boolean;
  partialWarning?: string;
  runNow: () => void;
}

export function useSearchAll(
  query: string,
  options: UseSearchAllOptions,
): UseSearchAllResult {
  const [items, setItems] = useState<ApiSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [partialWarning, setPartialWarning] = useState<string | undefined>();

  const latestRequestIdRef = useRef(0);
  const lastFetchedQueryRef = useRef("");
  const trimmed = query.trim();
  const shouldRunSearch = options.enabled && trimmed.length >= 2;

  const runRequest = useCallback(
    async (requestId: number, q: string) => {
      setLoading(true);
      try {
        const qLower = q.toLowerCase();

        // 1. Fetch tracks from Liner and artist/album candidates in parallel
        const [linerRes, itunesArtistRes, itunesAlbumRes] = await Promise.allSettled([
          api.search(q, "all"),
          fetch(
            `https://itunes.apple.com/search?term=${encodeURIComponent(
              q,
            )}&entity=musicArtist&limit=3`,
          ).then((r) => (r.ok ? r.json() : null)),
          fetch(
            `https://itunes.apple.com/search?term=${encodeURIComponent(
              q,
            )}&entity=album&limit=3`,
          ).then((r) => (r.ok ? r.json() : null)),
        ]);

        if (requestId !== latestRequestIdRef.current) return;

        const rawTracks =
          linerRes.status === "fulfilled" && Array.isArray(linerRes.value?.items)
            ? linerRes.value.items
            : [];

        // 2. Extract top matching artist
        const artistCandidates: ApiArtist[] = [];
        const seenArtistKeys = new Set<string>();

        for (const item of rawTracks) {
          if (item.type === "artist") {
            const key = (item.name || "").toLowerCase().trim();
            if (key && !seenArtistKeys.has(key) && key !== "artist" && key !== "unknown") {
              seenArtistKeys.add(key);
              artistCandidates.push(item as ApiArtist);
            }
            continue;
          }

          const track = item as any;
          const list = track.artists || track.artistList || [];
          if (Array.isArray(list)) {
            for (const a of list) {
              const aName = typeof a === "string" ? a.trim() : (a.name || "").trim();
              const aId = typeof a === "string" ? "" : (a.id || "").trim();
              if (!aName || aName.toLowerCase() === "artist" || aName.toLowerCase() === "unknown") {
                continue;
              }
              const key = aName.toLowerCase();
              if (!seenArtistKeys.has(key)) {
                seenArtistKeys.add(key);
                const trackCover = track.cover?.url
                  ? track.cover
                  : track.coverUrl
                    ? { url: track.coverUrl }
                    : undefined;
                artistCandidates.push({
                  type: "artist",
                  id: aId || aName,
                  name: aName,
                  cover: trackCover,
                });
              }
            }
          }
        }

        if (itunesArtistRes.status === "fulfilled" && itunesArtistRes.value?.results) {
          for (const it of itunesArtistRes.value.results) {
            const aName = (it.artistName || "").trim();
            if (!aName) continue;
            const key = aName.toLowerCase();
            if (!seenArtistKeys.has(key)) {
              seenArtistKeys.add(key);
              artistCandidates.push({
                type: "artist",
                id: aName,
                name: aName,
              });
            }
          }
        }

        // Rank artists: exact/starts with query first
        const sortedArtists = artistCandidates.sort((a, b) => {
          const aExact = a.name.toLowerCase() === qLower;
          const bExact = b.name.toLowerCase() === qLower;
          if (aExact && !bExact) return -1;
          if (!aExact && bExact) return 1;

          const aStarts = a.name.toLowerCase().startsWith(qLower);
          const bStarts = b.name.toLowerCase().startsWith(qLower);
          if (aStarts && !bStarts) return -1;
          if (!aStarts && bStarts) return 1;

          return 0;
        });

        // 3. Extract top matching album
        const albumCandidates: ApiAlbum[] = [];
        const seenAlbumKeys = new Set<string>();

        // Check local saved albums first
        const savedAlbums = getLocalSavedItems("album");
        for (const item of savedAlbums) {
          const title = item.title || "";
          if (title.toLowerCase().includes(qLower)) {
            const key = title.toLowerCase().trim();
            if (!seenAlbumKeys.has(key)) {
              seenAlbumKeys.add(key);
              albumCandidates.push({
                type: "album",
                id: item.id,
                title,
                artists: [{ id: "", name: item.artists || "" }],
                year: item.year ? parseInt(item.year, 10) : undefined,
                cover: item.coverUrl ? { url: item.coverUrl, width: 1200, height: 1200 } : undefined,
              });
            }
          }
        }

        // From track albums
        for (const item of rawTracks) {
          const track = item as any;
          if (track.album && track.album.id && track.album.title) {
            const aTitle = (track.album.title || "").trim();
            const key = aTitle.toLowerCase();
            if (!seenAlbumKeys.has(key)) {
              seenAlbumKeys.add(key);
              const trackArtists = Array.isArray(track.artists)
                ? track.artists.map((a: any) => ({
                    id: typeof a === "string" ? "" : a.id || "",
                    name: typeof a === "string" ? a : a.name || "",
                  }))
                : [];
              albumCandidates.push({
                type: "album",
                id: track.album.id,
                title: aTitle,
                artists: trackArtists,
                cover: track.cover?.url ? track.cover : track.coverUrl ? { url: track.coverUrl } : undefined,
              });
            }
          }
        }

        // From iTunes
        if (itunesAlbumRes.status === "fulfilled" && itunesAlbumRes.value?.results) {
          for (const it of itunesAlbumRes.value.results) {
            const rawTitle = (it.collectionName || "").trim();
            if (!rawTitle) continue;
            const key = rawTitle.toLowerCase().replace(/\s*\(deluxe.*?\)/i, "").trim();
            if (!seenAlbumKeys.has(key)) {
              seenAlbumKeys.add(key);
              const coverHd = (it.artworkUrl100 || "").replace(/\/\d+x\d+bb\./, "/1200x1200bb.");
              const year = it.releaseDate ? parseInt(it.releaseDate.slice(0, 4), 10) : undefined;
              albumCandidates.push({
                type: "album",
                id: `itunes:${it.collectionId}`,
                title: rawTitle,
                artists: [{ id: String(it.artistId || ""), name: it.artistName || "" }],
                year,
                cover: coverHd ? { url: coverHd, width: 1200, height: 1200 } : undefined,
              });
            }
          }
        }

        // 4. Combine: Top 1-2 artists + Top 1-2 albums + tracks
        const combined: ApiSearchItem[] = [];

        if (sortedArtists.length > 0) {
          combined.push(...sortedArtists.slice(0, 1));
        }

        if (albumCandidates.length > 0) {
          combined.push(...albumCandidates.slice(0, 1));
        }

        combined.push(...rawTracks);

        setItems(combined);
        setPartialWarning(undefined);
        lastFetchedQueryRef.current = q;
        setHasLoaded(true);
      } catch {
        if (requestId !== latestRequestIdRef.current) return;
        setItems([]);
        setPartialWarning(undefined);
        setHasLoaded(true);
      } finally {
        if (requestId === latestRequestIdRef.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (trimmed.length < 2) {
      latestRequestIdRef.current += 1;
      setItems([]);
      setHasLoaded(false);
      setLoading(false);
      setPartialWarning(undefined);
      lastFetchedQueryRef.current = "";
      return;
    }

    if (!options.enabled) return;

    if (lastFetchedQueryRef.current === trimmed && items.length > 0) {
      setLoading(false);
      setHasLoaded(true);
      return;
    }

    setLoading(true);
    const requestId = ++latestRequestIdRef.current;
    const timer = setTimeout(() => {
      if (lastFetchedQueryRef.current === trimmed && items.length > 0) {
        setLoading(false);
        setHasLoaded(true);
        return;
      }
      void runRequest(requestId, trimmed);
    }, options.debounceMs ?? 320);

    return () => {
      clearTimeout(timer);
    };
  }, [items.length, options.debounceMs, options.enabled, runRequest, trimmed]);

  const runNow = useCallback(() => {
    if (!shouldRunSearch) return;
    const requestId = ++latestRequestIdRef.current;
    void runRequest(requestId, trimmed);
  }, [runRequest, shouldRunSearch, trimmed]);

  return { items, loading, hasLoaded, partialWarning, runNow };
}
