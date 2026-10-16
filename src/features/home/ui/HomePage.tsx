import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import PopularTracksSection from "./PopularTracksSection";
import DailyMixesSection from "./DailyMixesSection";
import HomePageSkeleton from "./HomePageSkeleton";
import {
  usePopular,
  usePopularTracksOnly,
  usePopularTracksAllTime,
} from "../hooks/usePopularTracks";
import { useRecentlyPlayed } from "../hooks/useRecentlyPlayed";
import { useDailyMixes } from "../hooks/useDailyMixes";
import { useLikedTracks } from "@/features/library/hooks/useLikedTracks";
import { useExternalItems } from "@/features/library/hooks";
import { playerEngine } from "@/features/player";
import SongCard from "@/features/player/ui/SongCard";
import SongCardWithMenu from "@/features/player/ui/SongCardWithMenu";
import { useTranslation } from "@/languages";
import { useIsContentTransparent } from "@/features/settings/store/customizationStore";
import {
  FireFill,
  TrophyFill,
  TimeFill,
  AlbumFill,
  PlaylistFill,
  HeartFill,
  FlashCircleFill,
  Music2Fill,
  User4Fill,
} from "@mingcute/react";
import type { Track } from "@/shared/types";
import type { PopularItem } from "../hooks/usePopularTracks";

export default function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const hasCustomBg = useIsContentTransparent();
  const { data: likedData, isLoading: likedLoading } = useLikedTracks();
  const { data: libraryAlbums = [] } = useExternalItems("album");

  const { data: popularItems, isLoading: popularLoading } = usePopular(100);
  const { data: popularTracksOnly, isLoading: tracksLoading } =
    usePopularTracksOnly(25);
  const { data: popularTracksAllTime, isLoading: allTimeLoading } =
    usePopularTracksAllTime(20);
  const { data: recentlyPlayed, isLoading: recentLoading } =
    useRecentlyPlayed(20);
  const { data: dailyMixes } = useDailyMixes();

  const isDataLoading = tracksLoading && allTimeLoading;

  const libraryAlbumItems: PopularItem[] = useMemo(() => {
    return libraryAlbums.map((album) => ({
      type: "album" as const,
      item: {
        id: album.id,
        title: album.title,
        artist: album.subtitle || "Album",
        coverUrl: album.imageUrl || "",
        totalTracks: album.trackCount || 1,
        albumType: "Album",
      },
      playCount: 0,
    }));
  }, [libraryAlbums]);

  const popularAlbums =
    popularItems?.filter((it) => it.type === "album") ?? [];
  const popularArtists =
    popularItems?.filter((it) => it.type === "artist") ?? [];
  const popularPlaylists =
    popularItems?.filter((it) => it.type === "playlist") ?? [];

  // Ambient time-of-day colored glow
  const glowClass = useMemo(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) {
      return "from-amber-500/20 via-orange-500/10 to-transparent";
    } else if (hour >= 12 && hour < 17) {
      return "from-amber-400/20 via-sky-500/10 to-transparent";
    } else if (hour >= 17 && hour < 22) {
      return "from-rose-500/20 via-purple-500/10 to-transparent";
    }
    return "from-indigo-600/25 via-violet-600/15 to-transparent";
  }, []);

  // Top quick access items (Spotify style 6 items: Liked songs + 5 recent/recommended tracks)
  const quickItems = useMemo(() => {
    const list: Array<{ type: "album" | "track"; item: any }> = [];
    const seen = new Set<string>();

    // 1. Fill from recently played
    for (const entry of recentlyPlayed || []) {
      if (entry.type === "album" || entry.type === "track") {
        if (entry.item?.id && !seen.has(entry.item.id)) {
          seen.add(entry.item.id);
          list.push(entry);
          if (list.length >= 5) break;
        }
      }
    }

    // 2. If less than 5 items, fill with top recommendations from popularTracksOnly
    if (list.length < 5 && popularTracksOnly) {
      for (const entry of popularTracksOnly) {
        if (entry.type === "track" && entry.item?.id && !seen.has(entry.item.id)) {
          seen.add(entry.item.id);
          list.push({ type: "track", item: entry.item });
          if (list.length >= 5) break;
        }
      }
    }

    return list;
  }, [recentlyPlayed, popularTracksOnly]);

  // Recommended tracks for list view (Spotify-style 6 to 8 tracks list)
  const recommendedListTracks = useMemo((): Track[] => {
    const pool: Track[] = (popularTracksOnly || [])
      .filter((p): p is { type: "track"; item: Track; playCount: number } => p.type === "track")
      .map((p) => p.item);
    const quickIds = new Set(quickItems.map((q) => q.item.id));
    const fresh = pool.filter((t) => !quickIds.has(t.id));
    return (fresh.length >= 6 ? fresh : pool).slice(0, 8);
  }, [popularTracksOnly, quickItems]);

  const isReady = !isDataLoading;
  const [skeletonExited, setSkeletonExited] = useState(() => !isDataLoading);

  useEffect(() => {
    if (isReady && !skeletonExited) {
      const timer = setTimeout(() => {
        setSkeletonExited(true);
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [isReady, skeletonExited]);

  const quickCardClass = hasCustomBg
    ? "apple-glass-action"
    : "bg-bg-elevated hover:bg-[#dedee3] dark:hover:bg-border-alpha-14 transition-colors duration-150 ease-out";

  return (
    <div className="relative h-full w-full overflow-y-auto overflow-x-hidden bg-transparent">

      <div
        data-window-drag
        className="sticky top-0 z-20 h-[32px] w-full shrink-0 select-none pointer-events-auto"
        style={{ marginBottom: "-32px" }}
        aria-hidden="true"
      />
      {!hasCustomBg && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute -top-8 -left-8 w-[380px] h-[200px] bg-gradient-to-br ${glowClass} blur-3xl opacity-60`}
        />
      )}

      <div className="relative z-1 grid grid-cols-1 items-start w-full">
        {/* Real Content Layer */}
        {isReady && (
          <div className="col-start-1 row-start-1 w-full pb-[24px]">
            {/* 1. TOP QUICK LIST GRID (Spotify style 6 cards) */}
            <div className="flex flex-col">
              <div className="mt-[20px] px-8 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex items-center shrink-0">
                    <FlashCircleFill className="w-5 h-5 text-amber-400" />
                  </div>
                  <h2
                    className="text-text-primary text-[21px] font-semibold m-0 leading-tight tracking-tight"
                    style={{ fontFamily: "var(--font-inter), sans-serif" }}
                  >
                    {t("home.speedDial") || "Truy cập nhanh"}
                  </h2>
                </div>
              </div>

              <div className="px-8 mt-[12px] relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                <SongCard
                  title={t("library.liked_songs") || "Bài hát đã thích"}
                  artists={`${likedData.total} ${likedData.total === 1 ? t("library.song") : t("library.songs")}`}
                  artistsClickable={false}
                  coverUrl=""
                  icon={<HeartFill size={22} className={hasCustomBg ? "text-white/80" : "text-rose-500"} />}
                  onPlay={() => navigate("/library/playlist?id=likes")}
                  compact
                  className={quickCardClass}
                />

                {quickItems.map((entry, idx) => {
                  if (entry.type === "album") {
                    const album = entry.item;
                    return (
                      <SongCardWithMenu
                        key={`quick-album-${album.id}-${idx}`}
                        id={album.id}
                        title={album.title}
                        artists={album.artist}
                        coverUrl={album.coverUrl ?? ""}
                        onPlay={() =>
                          navigate(
                            `/collection?type=album&id=${encodeURIComponent(album.id)}`,
                          )
                        }
                        searchType="album"
                        compact
                        className={quickCardClass}
                      />
                    );
                  }
                  if (entry.type === "track") {
                    const track = entry.item;
                    return (
                      <SongCardWithMenu
                        key={`quick-track-${track.id}-${idx}`}
                        id={track.id}
                        title={track.title}
                        artists={track.artists}
                        coverUrl={track.coverUrl ?? ""}
                        durationMs={track.durationMs}
                        explicit={track.explicit}
                        onPlay={() => {
                          void playerEngine.playTrack(
                            track,
                            [track],
                            `${track.title} Radio`,
                            track.coverUrl,
                          );
                        }}
                        searchType="track"
                        compact
                        className={quickCardClass}
                      />
                    );
                  }
                  return null;
                })}
              </div>
            </div>

            {/* 2. RECOMMENDED TRACKS (Spotify style 2-column list view) */}
            {recommendedListTracks.length > 0 && (
              <div className="flex flex-col mt-[26px]">
                <div className="px-8 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex items-center shrink-0">
                      <Music2Fill className="w-5 h-5 text-indigo-400" />
                    </div>
                    <h2
                      className="text-text-primary text-[21px] font-semibold m-0 leading-tight tracking-tight"
                      style={{ fontFamily: "var(--font-inter), sans-serif" }}
                    >
                      {t("home.recommendedForYou") || "Gợi ý nhanh cho bạn"}
                    </h2>
                  </div>
                </div>

                <div className="px-8 mt-[12px] grid grid-cols-1 md:grid-cols-2 gap-2">
                  {recommendedListTracks.map((track, idx) => (
                    <SongCardWithMenu
                      key={`rec-list-${track.id}-${idx}`}
                      id={track.id}
                      title={track.title}
                      artists={track.artists}
                      coverUrl={track.coverUrl ?? ""}
                      durationMs={track.durationMs}
                      explicit={track.explicit}
                      onPlay={() => {
                        void playerEngine.playTrack(
                          track,
                          recommendedListTracks,
                          "Gợi ý cho bạn",
                          track.coverUrl,
                        );
                      }}
                      searchType="track"
                      compact={false}
                      className={quickCardClass}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 3. DAILY MIXES (Made For You - Icon/Card Carousel) */}
            {dailyMixes && dailyMixes.length > 0 && (
              <DailyMixesSection
                mixes={dailyMixes}
                headingMarginTop="mt-[26px]"
              />
            )}

            {/* 4. LISTENING RIGHT NOW (Trending Chart - Icon/Card Carousel) */}
            {popularTracksOnly && popularTracksOnly.length > 0 && (
              <PopularTracksSection
                title={t("home.whatEveryonesOn") || "Thịnh hành ngay lúc này"}
                icon={<FireFill className="w-5 h-5 text-amber-500" />}
                items={popularTracksOnly}
                showRanks
                headingMarginTop="mt-[26px]"
              />
            )}

            {/* 4.5. ALBUMS FROM LIBRARY */}
            {libraryAlbumItems && libraryAlbumItems.length > 0 && (
              <PopularTracksSection
                title={t("home.libraryAlbums") || "Album trong thư viện"}
                icon={<AlbumFill className="w-5 h-5 text-emerald-400" />}
                items={libraryAlbumItems}
                headingMarginTop="mt-[26px]"
              />
            )}

            {/* 5. POPULAR ARTISTS (Circular Artist Cards - Icon/Card Carousel) */}
            {popularArtists && popularArtists.length > 0 && (
              <PopularTracksSection
                title={t("home.popularArtists") || "Nghệ sĩ thịnh hành"}
                icon={<User4Fill className="w-5 h-5 text-purple-400" />}
                items={popularArtists}
                headingMarginTop="mt-[26px]"
              />
            )}

            {/* 6. JUMP BACK IN (History - Icon/Card Carousel) */}
            {recentlyPlayed && recentlyPlayed.length > 0 && (
              <PopularTracksSection
                title={t("home.jumpBackIn") || "Nghe gần đây"}
                icon={<TimeFill className="w-5 h-5 text-sky-400" />}
                items={recentlyPlayed}
                headingMarginTop="mt-[26px]"
              />
            )}

            {/* 7. TOP ALBUMS (Icon/Card Carousel) */}
            {popularAlbums && popularAlbums.length > 0 && (
              <PopularTracksSection
                title={t("home.popularAlbums") || "Album nổi bật"}
                icon={<AlbumFill className="w-5 h-5 text-emerald-400" />}
                items={popularAlbums}
                headingMarginTop="mt-[26px]"
              />
            )}

            {/* 8. MOST LISTENED ALL TIME (Icon/Card Carousel) */}
            {popularTracksAllTime && popularTracksAllTime.length > 0 && (
              <PopularTracksSection
                title={t("home.mostListened") || "Nghe nhiều nhất mọi thời đại"}
                icon={<TrophyFill className="w-5 h-5 text-yellow-500" />}
                items={popularTracksAllTime}
                headingMarginTop="mt-[26px]"
              />
            )}

            {/* 9. POPULAR PLAYLISTS (Icon/Card Carousel) */}
            {popularPlaylists && popularPlaylists.length > 0 && (
              <PopularTracksSection
                title={t("home.popularPlaylists") || "Playlist tuyển chọn"}
                icon={<PlaylistFill className="w-5 h-5 text-rose-400" />}
                items={popularPlaylists}
                headingMarginTop="mt-[26px]"
              />
            )}
          </div>
        )}

        {/* Direct Crossfade Skeleton Layer */}
        {!skeletonExited && (
          <div
            className={`col-start-1 row-start-1 w-full z-10 transition-opacity duration-300 ease-out ${
              isReady ? "opacity-0 pointer-events-none" : "opacity-100 pointer-events-auto"
            }`}
            onTransitionEnd={() => setSkeletonExited(true)}
          >
            <HomePageSkeleton glowClass={glowClass} showQuickGrid={true} />
          </div>
        )}
      </div>
    </div>
  );
}
