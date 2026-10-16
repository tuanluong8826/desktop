import { useEffect, useState } from "react";
import type { Track } from "@/shared/types";

export interface CreditPerson {
  name: string;
  role: string;
  id?: string;
}

export interface TrackCreditsData {
  performers: CreditPerson[];
  songwriters: CreditPerson[];
  production: CreditPerson[];
  publisher?: string;
  releaseDate?: string;
  genre?: string;
  album?: string;
  audioQuality: string;
}

export function useTrackCredits(track: Track | null): { credits: TrackCreditsData | null; loading: boolean } {
  const [credits, setCredits] = useState<TrackCreditsData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!track?.id || !track.title) {
      setCredits(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);

    async function fetchCredits() {
      try {
        const cleanTitle = (track?.title || "")
          .replace(/\s*\(feat\..*?\)/i, "")
          .replace(/\s*\(ft\..*?\)/i, "")
          .replace(/\s*\[feat\..*?\]/i, "")
          .replace(/\s*\[ft\..*?\]/i, "")
          .replace(/\s*\(official.*?\)/i, "")
          .replace(/\s*\(music video.*?\)/i, "")
          .replace(/\s*\(mv.*?\)/i, "")
          .replace(/\s*\(audio.*?\)/i, "")
          .trim();

        const primaryArtist = track?.artists?.split(",")?.[0]?.trim() || "";
        const searchTerm = `${cleanTitle} ${primaryArtist}`.trim();

        let itunesTrack: any = null;
        let itunesAlbum: any = null;

        if (searchTerm) {
          try {
            const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(
              searchTerm,
            )}&entity=song&limit=1`;
            const res = await fetch(itunesUrl);
            if (res.ok) {
              const data = await res.json();
              itunesTrack = data.results?.[0];
              if (itunesTrack?.collectionId) {
                const albRes = await fetch(
                  `https://itunes.apple.com/lookup?id=${itunesTrack.collectionId}`,
                );
                if (albRes.ok) {
                  const albData = await albRes.json();
                  itunesAlbum = albData.results?.[0];
                }
              }
            }
          } catch {}
        }

        if (!active) return;

        // Performers (Main artists + Featured artists)
        const performers: CreditPerson[] = [];
        if (track?.artistList && track.artistList.length > 0) {
          track.artistList.forEach((a, idx) => {
            performers.push({
              name: a.name,
              role: idx === 0 ? "Main Artist • Vocal" : "Featured Artist • Vocal",
              id: a.id,
            });
          });
        } else if (track?.artists) {
          track.artists.split(",").forEach((name, idx) => {
            const clean = name.trim();
            if (clean) {
              performers.push({
                name: clean,
                role: idx === 0 ? "Main Artist • Vocal" : "Featured Artist • Vocal",
              });
            }
          });
        }

        // Extract featured artists from title if not already present
        const featMatch = (track?.title || "").match(/\((?:feat\.|ft\.)\s*([^)]+)\)/i);
        if (featMatch?.[1]) {
          const featNames = featMatch[1].split(/[,&]/).map((n) => n.trim());
          for (const fn of featNames) {
            if (fn && !performers.some((p) => p.name.toLowerCase() === fn.toLowerCase())) {
              performers.push({
                name: fn,
                role: "Featured Artist",
              });
            }
          }
        }

        // Songwriters (Composer / Lyricist)
        const songwriters: CreditPerson[] = [];
        // Check for (prod. by ...) or composer in title
        const prodMatch = (track?.title || "").match(/\((?:prod\.|produced by)\s*([^)]+)\)/i);
        
        if (itunesTrack?.artistName && !songwriters.some((s) => s.name === itunesTrack.artistName)) {
          songwriters.push({
            name: itunesTrack.artistName,
            role: "Composer • Lyricist",
          });
        } else if (performers[0]?.name) {
          songwriters.push({
            name: performers[0].name,
            role: "Composer • Lyricist",
          });
        }

        // Production & Studio
        const production: CreditPerson[] = [];
        if (prodMatch?.[1]) {
          production.push({
            name: prodMatch[1].trim(),
            role: "Producer • Arranger",
          });
        }

        const publisher =
          itunesAlbum?.copyright ||
          (track?.album?.title ? `℗ ${track.album.title}` : undefined);

        const releaseDate =
          itunesTrack?.releaseDate?.slice(0, 10) ||
          itunesAlbum?.releaseDate?.slice(0, 10);

        const genre = itunesTrack?.primaryGenreName;
        const album = itunesTrack?.collectionName || track?.album?.title;

        setCredits({
          performers,
          songwriters,
          production,
          publisher,
          releaseDate,
          genre,
          album,
          audioQuality: "Apple Digital Master Lossless 24-bit / 96kHz • Spatial 3D",
        });
      } catch (err) {
        console.warn("Failed to fetch track credits:", err);
      } finally {
        if (active) setLoading(false);
      }
    }

    void fetchCredits();

    return () => {
      active = false;
    };
  }, [track?.id, track?.title, track?.artists]);

  return { credits, loading };
}
