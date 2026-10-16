import { useEffect, useState } from "react";
import { api, mediaUrl, toMaxQualityAvatarUrl, toClientTrack } from "@/shared/api";
import type { Track } from "@/shared/types";

export interface ArtistAlbumViewModel {
  id: string;
  title: string;
  coverUrl: string;
  releaseDate?: string;
  totalTracks?: number;
  explicit?: boolean;
}

export interface ArtistReleaseViewModel extends ArtistAlbumViewModel {
  releaseType: "single" | "ep";
}

export interface ArtistPageData {
  title: string;
  description: string;
  coverUrl: string; // Circular Avatar URL
  bannerUrl?: string; // High-res Backdrop Banner from top album/track
  geniusImageUrl?: string;
  geniusAka?: string[];
  geniusUsername?: string;
  monthlyListeners?: string;
  verified: boolean;
  followers?: number;
  totalListens?: number;
  totalTracks?: number;
  tracks: Track[];
  popularSongs: Track[];
  albums: ArtistAlbumViewModel[];
  reposts: Track[];
  singles: ArtistReleaseViewModel[];
}

export function useArtist(id: string | null, nameParam?: string | null) {
  const [data, setData] = useState<ArtistPageData | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(id || nameParam));

  useEffect(() => {
    if (!id && !nameParam) {
      setData(null);
      setLoading(false);
      return;
    }

    const decodedId = id ? decodeURIComponent(id).trim() : "";
    const decodedName = nameParam ? decodeURIComponent(nameParam).trim() : "";

    let artistName =
      decodedName && decodedName.toLowerCase() !== "artist"
        ? decodedName
        : decodedId && decodedId.toLowerCase() !== "artist" && !decodedId.startsWith("UC")
          ? decodedId
          : "";

    let active = true;
    setData(null);
    setLoading(true);

    async function loadArtist() {
      try {
        let artistData: any = null;
        let candidateChannelId = decodedId.startsWith("UC") ? decodedId : "";

        // 1. If we have a YouTube channel ID (starts with UC and length >= 18), try fetching directly
        if (candidateChannelId) {
          try {
            const fetched = await api.getArtist(candidateChannelId);
            if (
              fetched &&
              fetched.name &&
              fetched.name.toLowerCase() !== "artist" &&
              Array.isArray(fetched.tracks) &&
              fetched.tracks.length > 0
            ) {
              artistData = fetched;
              if (!artistName || artistName.toLowerCase() === "artist") {
                artistName = fetched.name;
              }
            }
          } catch {
            // direct fetch failed, will fallback to name search
          }
        }

        // 2. If no valid artistData yet, search for artist name to find real channel ID & tracks
        if (!artistData && artistName) {
          try {
            const searchRes = await api.search(artistName, "all");
            const rawItems = Array.isArray(searchRes?.items) ? searchRes.items : [];

            // Find matching channel ID from track artists
            let matchedChannelId = "";
            let matchedDisplayName = artistName;
            const matchedTracks: any[] = [];

            for (const item of rawItems) {
              const track = item as any;
              const list = track.artists || track.artistList || [];
              let isMatch = false;

              if (Array.isArray(list)) {
                for (const a of list) {
                  const aName = typeof a === "string" ? a.trim() : (a.name || "").trim();
                  const aId = typeof a === "string" ? "" : (a.id || "").trim();

                  if (
                    aName &&
                    (aName.toLowerCase() === artistName.toLowerCase() ||
                      aName.toLowerCase().includes(artistName.toLowerCase()) ||
                      artistName.toLowerCase().includes(aName.toLowerCase()))
                  ) {
                    isMatch = true;
                    if (aId && aId.startsWith("UC") && !matchedChannelId) {
                      matchedChannelId = aId;
                      matchedDisplayName = aName;
                    }
                  }
                }
              }

              if (isMatch && track.id) {
                matchedTracks.push(track);
              }
            }

            // If we found a YouTube channel ID, fetch official artist profile
            if (matchedChannelId) {
              try {
                const fetched = await api.getArtist(matchedChannelId);
                if (
                  fetched &&
                  fetched.name &&
                  fetched.name.toLowerCase() !== "artist" &&
                  Array.isArray(fetched.tracks) &&
                  fetched.tracks.length > 0
                ) {
                  artistData = fetched;
                  artistName = fetched.name;
                }
              } catch {}
            }

            // Fallback: construct artistData from search results
            if (!artistData) {
              const tracksToUse = matchedTracks.length > 0 ? matchedTracks : rawItems.filter((i) => i.type === "track");
              artistData = {
                type: "artist",
                id: matchedChannelId || candidateChannelId || artistName,
                name: matchedDisplayName || artistName,
                verified: true,
                tracks: tracksToUse,
                albums: [],
                singles: [],
              };
              artistName = matchedDisplayName || artistName;
            }
          } catch (searchErr) {
            console.warn("Artist search fallback error:", searchErr);
          }
        }

        if (!active) return;

        // If still nothing, abort
        if (!artistData) {
          setData(null);
          return;
        }

        const tracks: Track[] = Array.isArray(artistData.tracks)
          ? artistData.tracks.map(toClientTrack)
          : [];

        let albums: ArtistAlbumViewModel[] = Array.isArray(artistData.albums)
          ? artistData.albums.map((album: any) => ({
              id: album.id,
              title: album.title,
              coverUrl: album.cover ? mediaUrl(album.cover.url) : "",
              ...(album.year ? { releaseDate: String(album.year) } : {}),
              totalTracks: album.totalTracks ?? album.trackCount,
              explicit: album.explicit,
            }))
          : [];

        let singles: ArtistReleaseViewModel[] = Array.isArray(artistData.singles)
          ? artistData.singles.map((single: any) => ({
              id: single.id,
              title: single.title,
              coverUrl: single.cover ? mediaUrl(single.cover.url) : "",
              releaseType: single.releaseType || "single",
              ...(single.year ? { releaseDate: String(single.year) } : {}),
              totalTracks: single.totalTracks ?? single.trackCount,
              explicit: single.explicit,
            }))
          : [];

        // 3. Fetch iTunes discography for high-res albums and singles
        if (artistName) {
          try {
            const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(
              artistName,
            )}&entity=album&limit=50`;
            const res = await fetch(itunesUrl);
            if (res.ok) {
              const itunesData = await res.json();
              if (Array.isArray(itunesData.results)) {
                const seenTitles = new Set<string>();
                const fetchedAlbums: ArtistAlbumViewModel[] = [];
                const fetchedSingles: ArtistReleaseViewModel[] = [];

                for (const item of itunesData.results) {
                  const rawTitle = (item.collectionName || "").trim();
                  const normTitle = rawTitle.toLowerCase().replace(/\s*\(deluxe.*?\)/i, "").trim();
                  if (!rawTitle || seenTitles.has(normTitle)) continue;
                  seenTitles.add(normTitle);

                  const coverHd = (item.artworkUrl100 || "").replace(/\/\d+x\d+bb\./, "/1200x1200bb.");
                  const year = item.releaseDate ? item.releaseDate.slice(0, 4) : undefined;
                  const trackCount = item.trackCount || 1;
                  const isSingle = trackCount <= 3 || /single|ep/i.test(rawTitle);

                  if (isSingle) {
                    fetchedSingles.push({
                      id: `itunes:${item.collectionId}`,
                      title: rawTitle,
                      coverUrl: coverHd,
                      releaseType: trackCount <= 1 ? "single" : "ep",
                      releaseDate: year,
                      totalTracks: trackCount,
                      explicit: item.collectionExplicitness === "explicit",
                    });
                  } else {
                    fetchedAlbums.push({
                      id: `itunes:${item.collectionId}`,
                      title: rawTitle,
                      coverUrl: coverHd,
                      releaseDate: year,
                      totalTracks: trackCount,
                      explicit: item.collectionExplicitness === "explicit",
                    });
                  }
                }

                if (fetchedAlbums.length > 0) albums = fetchedAlbums;
                if (fetchedSingles.length > 0) singles = fetchedSingles;
              }
            }
          } catch (itunesErr) {
            console.warn("iTunes discography fallback error:", itunesErr);
          }
        }

        // 4. Select Avatar (coverUrl) & Background Banner (bannerUrl)
        // Avatar: high-res artist profile picture or first track cover
        const rawAvatar = artistData.cover
          ? toMaxQualityAvatarUrl(mediaUrl(artistData.cover.url))
          : artistData.geniusImageUrl
            ? mediaUrl(artistData.geniusImageUrl)
            : tracks[0]?.coverUrl || (albums[0]?.coverUrl ?? "");

        // Banner: highest quality artwork from top album or top track
        const bannerUrl =
          albums[0]?.coverUrl ||
          tracks[0]?.coverUrl ||
          singles[0]?.coverUrl ||
          rawAvatar;

        const formatted: ArtistPageData = {
          title: artistName || artistData.name || "Artist",
          monthlyListeners: artistData.monthlyListeners,
          verified: Boolean(artistData.verified ?? true),
          description: artistData.bio?.trim() || "",
          coverUrl: rawAvatar,
          bannerUrl,
          geniusImageUrl: artistData.geniusImageUrl ? mediaUrl(artistData.geniusImageUrl) : undefined,
          geniusAka: artistData.geniusAka,
          geniusUsername: artistData.geniusUsername,
          totalTracks: tracks.length,
          tracks,
          popularSongs: tracks.slice(0, 8),
          albums,
          reposts: [],
          singles,
        };

        if (active) {
          setData(formatted);
        }
      } catch (err) {
        console.error("loadArtist failed:", err);
        if (active) {
          setData(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadArtist();

    return () => {
      active = false;
    };
  }, [id, nameParam]);

  return { data, loading };
}
