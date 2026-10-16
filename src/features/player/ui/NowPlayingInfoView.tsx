import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  HeartFill,
  HeartLine,
  ShareForwardLine,
  NewFolderLine,
  FolderCheckFill,
  ArrowRightLine,
  CheckFill,
  BadgeFill,
  DiscFill,
  WaveLine,
  HeadphoneFill,
} from "@mingcute/react";
import CoverImage from "@/features/covers/ui/CoverImage";
import ArtistLink from "@/features/artist/ui/ArtistLink";
import type { Track } from "@/shared/types";
import { useTranslation } from "@/languages";
import { useToast } from "@/shared/ui";
import { buildShareUrl } from "@/shared/utils/share";
import { useIsTrackLiked, useLikeTrack, useUnlikeTrack } from "@/features/library/hooks";
import { useModalStore } from "@/features/library";
import { useExternalItems } from "@/features/library/hooks";
import { useArtist } from "@/features/artist/hooks/useArtist";
import { useTrackCredits } from "../hooks/useTrackCredits";
import { useLyricsStore } from "@/features/lyrics";
import { usePlayerStore } from "../store/playerStore";

interface NowPlayingInfoViewProps {
  track: Track | null;
  nextTrack?: Track | null;
  onOpenLyrics: () => void;
  onOpenQueue: () => void;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/(Дискография)(Официальный)/g, "$1\n\n$2")
    .replace(/(сайт|ВКонтакте|канал|#\d|TikTok)(Официальный|Сообщество|Страница|Телеграм|YouTube|TikTok|Twitch)/g, "$1, $2")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^•\s*/gm, "")
    .trim();
}

export default function NowPlayingInfoView({
  track,
  nextTrack,
  onOpenLyrics,
  onOpenQueue,
}: NowPlayingInfoViewProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();

  const isLiked = useIsTrackLiked(track?.id ?? "");
  const likeMutation = useLikeTrack();
  const unlikeMutation = useUnlikeTrack();

  const primaryArtist = track?.artists?.split(",")?.[0]?.trim() || "";
  const { data: artistData } = useArtist(track?.artistId || null, primaryArtist);
  const { credits, loading: creditsLoading } = useTrackCredits(track);

  const { data: savedArtists } = useExternalItems("artist");
  const isArtistSaved = savedArtists.some(
    (a) =>
      (artistData?.title && a.title.toLowerCase() === artistData.title.toLowerCase()) ||
      (artistData?.title && a.id === artistData.title),
  );

  // Active lyrics snippet preview
  const syncedLines = useLyricsStore((s) => s.syncedLines);
  const plainLyrics = useLyricsStore((s) => s.plainLyrics);
  const positionMs = usePlayerStore((s) => s.positionMs);

  const activeLyricIndex = useMemo(() => {
    if (!syncedLines || syncedLines.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < syncedLines.length; i++) {
      if (syncedLines[i].timeMs <= positionMs) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }, [syncedLines, positionMs]);

  const lyricPreviewLines = useMemo(() => {
    if (syncedLines && syncedLines.length > 0) {
      const start = Math.max(0, activeLyricIndex >= 0 ? activeLyricIndex : 0);
      return syncedLines.slice(start, start + 3);
    }
    if (plainLyrics) {
      const lines = plainLyrics.split("\n").filter((l) => l.trim().length > 0);
      return lines.slice(0, 3).map((text, i) => ({ text, timeMs: i * 1000 }));
    }
    return [];
  }, [syncedLines, activeLyricIndex, plainLyrics]);

  const handleLikeToggle = () => {
    if (!track?.id) return;
    if (isLiked) {
      unlikeMutation.mutate(track.id);
      toast(t("library.removed_from_likes"), "info", {
        description: track.title,
      });
    } else {
      likeMutation.mutate(track);
      toast(t("library.added_to_likes"), "checkmark", {
        description: track.title,
      });
    }
  };

  const handleShare = () => {
    if (track?.id && typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(buildShareUrl("track", track.id));
      toast(t("common.link_copied"), "checkmark", {
        description: track.title,
      });
    }
  };

  const handleAddToPlaylist = () => {
    if (!track) return;
    useModalStore.getState().openAddToPlaylist(track);
  };

  const handleToggleSaveArtist = () => {
    if (!artistData?.title) return;
    if (isArtistSaved) {
      useModalStore.getState().openRemoveFromLibrary({
        id: artistData.title,
        title: artistData.title,
        coverUrl: artistData.coverUrl,
        type: "artist",
      });
    } else {
      useModalStore.getState().openAddToLibrary({
        id: artistData.title,
        title: artistData.title,
        coverUrl: artistData.coverUrl,
        type: "artist",
      });
    }
  };

  if (!track) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-center text-text-tertiary">
        <span>{t("player.no_track_playing") || "Chưa có bài hát nào đang phát"}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[20px] px-[16px] pb-[32px] pt-[8px] select-none">
      {/* 1. Large Track Artwork */}
      <div className="relative aspect-square w-full shrink-0 overflow-hidden rounded-2xl bg-white/5 shadow-2xl ring-1 ring-white/10 group">
        {track.coverUrl ? (
          <CoverImage
            src={track.coverUrl}
            alt={track.title}
            fill
            sizes="400px"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-text-tertiary">
            <DiscFill size={64} className="opacity-30" />
          </div>
        )}
      </div>

      {/* 2. Track Title & Artist Info Header */}
      <div className="flex items-center justify-between gap-[12px]">
        <div className="flex min-w-0 flex-col gap-[3px]">
          <h2
            className="m-0 truncate text-[22px] font-[700] tracking-[-0.02em] text-text-primary"
            style={{ fontFamily: "var(--font-inter), sans-serif" }}
            title={track.title}
          >
            {track.title}
          </h2>
          <div
            className="truncate text-[15px] font-[400] text-text-secondary hover:text-text-primary transition-colors"
            style={{ fontFamily: "var(--font-inter), sans-serif" }}
          >
            <ArtistLink
              name={track.artists}
              artistId={track.artistId}
              artistList={track.artistList}
            />
          </div>
        </div>

        <div className="flex items-center gap-[6px] shrink-0">
          <button
            type="button"
            onClick={handleLikeToggle}
            className={`flex h-[38px] w-[38px] items-center justify-center rounded-full border-0 bg-white/5 transition-transform active:scale-[0.92] cursor-pointer hover:bg-white/10 ${
              isLiked ? "text-rose-500" : "text-text-secondary hover:text-text-primary"
            }`}
            title={isLiked ? t("library.unlike") || "Bỏ thích" : t("library.like") || "Yêu thích"}
          >
            {isLiked ? <HeartFill size={20} /> : <HeartLine size={20} />}
          </button>

          <button
            type="button"
            onClick={handleAddToPlaylist}
            className="flex h-[38px] w-[38px] items-center justify-center rounded-full border-0 bg-white/5 text-text-secondary transition-transform active:scale-[0.92] cursor-pointer hover:bg-white/10 hover:text-text-primary"
            title={t("playlist.add_to_playlist") || "Thêm vào danh sách phát"}
          >
            <NewFolderLine size={20} />
          </button>

          <button
            type="button"
            onClick={handleShare}
            className="flex h-[38px] w-[38px] items-center justify-center rounded-full border-0 bg-white/5 text-text-secondary transition-transform active:scale-[0.92] cursor-pointer hover:bg-white/10 hover:text-text-primary"
            title={t("artist.share") || "Chia sẻ"}
          >
            <ShareForwardLine size={20} />
          </button>
        </div>
      </div>

      {/* 3. Lyrics Preview Card (Spotify style) */}
      <div
        role="button"
        tabIndex={0}
        onClick={onOpenLyrics}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenLyrics();
          }
        }}
        className="group relative flex flex-col justify-between overflow-hidden rounded-2xl p-[18px] bg-gradient-to-br from-[#2e1d27]/70 via-[#1f1722]/80 to-[#121217]/90 border border-white/10 hover:border-white/20 transition-all cursor-pointer shadow-lg"
      >
        <div className="flex items-center justify-between pb-[10px]">
          <span
            className="text-[13px] font-[600] tracking-wider uppercase text-white/70"
            style={{ fontFamily: "var(--font-inter), sans-serif" }}
          >
            {t("player.lyrics_preview") || "Lời bài hát"}
          </span>
          <span className="flex items-center gap-[4px] text-[12px] font-[500] text-white/50 group-hover:text-white transition-colors">
            <span>{t("player.fullscreen") || "Mở rộng"}</span>
            <ArrowRightLine size={14} />
          </span>
        </div>

        <div className="flex flex-col gap-[6px] py-[4px]">
          {lyricPreviewLines.length > 0 ? (
            lyricPreviewLines.map((line, idx) => (
              <p
                key={`${line.timeMs}-${idx}`}
                className={`m-0 text-[16px] leading-[1.4] font-[600] tracking-[-0.01em] transition-opacity duration-200 line-clamp-1 ${
                  idx === 0
                    ? "text-white opacity-100"
                    : "text-white/60 opacity-60"
                }`}
                style={{ fontFamily: "var(--font-inter), sans-serif" }}
              >
                {line.text}
              </p>
            ))
          ) : (
            <p className="m-0 text-[14px] text-white/40 italic">
              {t("player.no_lyrics") || "Đang phát nhạc..."}
            </p>
          )}
        </div>
      </div>

      {/* 4. About the Artist Card (Spotify style) */}
      {artistData && (
        <div className="flex flex-col overflow-hidden rounded-2xl bg-white/[0.05] dark:bg-black/35 border border-white/10 backdrop-blur-2xl shadow-xl">
          {/* Artist Photo Header */}
          <div className="relative h-[220px] w-full overflow-hidden group">
            {artistData.bannerUrl || artistData.coverUrl ? (
              <CoverImage
                src={artistData.bannerUrl || artistData.coverUrl}
                alt={artistData.title}
                fill
                sizes="400px"
                className="object-cover object-center transition-transform duration-700 group-hover:scale-105"
                draggable={false}
              />
            ) : (
              <div className="h-full w-full bg-white/5" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/20" />

            <div className="absolute top-[16px] left-[16px] z-10">
              <span
                className="text-[14px] font-[700] text-white drop-shadow-md"
                style={{ fontFamily: "var(--font-inter), sans-serif" }}
              >
                {t("artist.about_artist") || "Về nghệ sĩ"}
              </span>
            </div>

            <div className="absolute bottom-[16px] left-[16px] right-[16px] z-10 flex items-end justify-between gap-[12px]">
              <div className="flex flex-col min-w-0">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    navigate(
                      `/artist?id=${encodeURIComponent(artistData.title)}&name=${encodeURIComponent(
                        artistData.title,
                      )}`,
                    )
                  }
                  className="flex items-center gap-[6px] cursor-pointer hover:underline"
                >
                  <h3
                    className="m-0 truncate text-[20px] font-[700] text-white drop-shadow-md"
                    style={{ fontFamily: "var(--font-inter), sans-serif" }}
                  >
                    {artistData.title}
                  </h3>
                  {artistData.verified && (
                    <BadgeFill className="h-[18px] w-[18px] shrink-0 text-[#1d9bf0]" />
                  )}
                </div>
                {artistData.monthlyListeners ? (
                  <span
                    className="mt-[2px] text-[13px] text-white/80 font-[400] drop-shadow"
                    style={{ fontFamily: "var(--font-inter), sans-serif" }}
                  >
                    {(() => {
                      const match = artistData.monthlyListeners.match(/^([\d.,]+[KMBkmb]?)/);
                      const count = match ? match[1] : artistData.monthlyListeners;
                      return t("artist.monthly_audience", { count });
                    })()}
                  </span>
                ) : artistData.followers ? (
                  <span
                    className="mt-[2px] text-[13px] text-white/80 font-[400] drop-shadow"
                    style={{ fontFamily: "var(--font-inter), sans-serif" }}
                  >
                    {Intl.NumberFormat("en-US", { notation: "compact" }).format(
                      artistData.followers,
                    )}{" "}
                    {t("artist.followers")}
                  </span>
                ) : null}
              </div>

              <button
                type="button"
                onClick={handleToggleSaveArtist}
                className={`shrink-0 rounded-full px-[16px] py-[7px] text-[13px] font-[600] transition-transform active:scale-[0.94] border border-white/20 cursor-pointer ${
                  isArtistSaved
                    ? "bg-white/20 text-white backdrop-blur-md"
                    : "bg-white text-black hover:bg-white/90"
                }`}
                style={{ fontFamily: "var(--font-inter), sans-serif" }}
              >
                {isArtistSaved ? (
                  <span className="flex items-center gap-[5px]">
                    <CheckFill size={14} />
                    <span>{t("common.following") || "Đang theo dõi"}</span>
                  </span>
                ) : (
                  <span>{t("common.follow") || "Theo dõi"}</span>
                )}
              </button>
            </div>
          </div>

          {/* Artist Bio Snippet */}
          {artistData.description ? (
            <div className="p-[16px]">
              <p
                className="m-0 text-[13px] leading-[1.55] text-text-secondary font-[400] line-clamp-3 select-text"
                style={{ fontFamily: "var(--font-inter), sans-serif" }}
              >
                {stripMarkdown(artistData.description)}
              </p>
            </div>
          ) : null}
        </div>
      )}

      {/* 5. Credits Card (Thông tin thực hiện & tác giả) */}
      <div className="flex flex-col gap-[14px] rounded-2xl p-[18px] bg-white/[0.05] dark:bg-black/35 border border-white/10 backdrop-blur-2xl shadow-xl">
        <div className="flex items-center justify-between">
          <span
            className="text-[15px] font-[700] text-text-primary tracking-[-0.01em]"
            style={{ fontFamily: "var(--font-inter), sans-serif" }}
          >
            {t("player.credits") || "Đội ngũ thực hiện"}
          </span>
          <span
            className="text-[12px] font-[500] text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
            onClick={() => {
              if (artistData?.title) {
                navigate(
                  `/artist?id=${encodeURIComponent(artistData.title)}&name=${encodeURIComponent(
                    artistData.title,
                  )}`,
                );
              }
            }}
          >
            {t("common.details") || "Chi tiết"}
          </span>
        </div>

        {/* Performers */}
        <div className="flex flex-col gap-[12px]">
          {credits?.performers?.map((person, idx) => (
            <div key={`${person.name}-${idx}`} className="flex items-center justify-between gap-[10px]">
              <div className="flex flex-col min-w-0">
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    navigate(
                      `/artist?id=${encodeURIComponent(person.name)}&name=${encodeURIComponent(
                        person.name,
                      )}`,
                    )
                  }
                  className="truncate text-[14px] font-[600] text-text-primary hover:underline cursor-pointer"
                  style={{ fontFamily: "var(--font-inter), sans-serif" }}
                >
                  {person.name}
                </span>
                <span
                  className="text-[12px] text-text-secondary"
                  style={{ fontFamily: "var(--font-inter), sans-serif" }}
                >
                  {person.role}
                </span>
              </div>
            </div>
          ))}

          {/* Songwriters */}
          {credits?.songwriters && credits.songwriters.length > 0 && (
            <div className="flex flex-col gap-[2px] pt-[4px] border-t border-white/5">
              <span
                className="text-[14px] font-[600] text-text-primary truncate"
                style={{ fontFamily: "var(--font-inter), sans-serif" }}
              >
                {credits.songwriters.map((s) => s.name).join(", ")}
              </span>
              <span
                className="text-[12px] text-text-secondary"
                style={{ fontFamily: "var(--font-inter), sans-serif" }}
              >
                {t("player.composer_lyricist") || "Nhạc sĩ • Viết lời"}
              </span>
            </div>
          )}

          {/* Production / Arranger */}
          {credits?.production && credits.production.length > 0 && (
            <div className="flex flex-col gap-[2px] pt-[4px] border-t border-white/5">
              <span
                className="text-[14px] font-[600] text-text-primary truncate"
                style={{ fontFamily: "var(--font-inter), sans-serif" }}
              >
                {credits.production.map((p) => p.name).join(", ")}
              </span>
              <span
                className="text-[12px] text-text-secondary"
                style={{ fontFamily: "var(--font-inter), sans-serif" }}
              >
                {t("player.producer_arranger") || "Sản xuất • Phối khí"}
              </span>
            </div>
          )}

          {/* Publisher / Label */}
          {credits?.publisher && (
            <div className="flex flex-col gap-[2px] pt-[4px] border-t border-white/5">
              <span
                className="text-[12px] leading-relaxed text-text-tertiary select-text"
                style={{ fontFamily: "var(--font-inter), sans-serif" }}
              >
                {credits.publisher}
              </span>
            </div>
          )}

          {/* Master Audio Badge */}
          <div className="mt-[4px] flex items-center gap-[8px] rounded-xl bg-white/5 p-[10px] border border-white/5">
            <WaveLine className="h-[18px] w-[18px] text-emerald-400 shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="text-[12px] font-[600] text-text-primary">
                Apple Digital Master • Lossless
              </span>
              <span className="text-[11px] text-text-secondary truncate">
                Spatial Audio 3D • Sound Check Normalization
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 6. Next in Queue Preview Card */}
      {nextTrack && (
        <div
          role="button"
          tabIndex={0}
          onClick={onOpenQueue}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onOpenQueue();
            }
          }}
          className="flex flex-col gap-[10px] rounded-2xl p-[16px] bg-white/[0.05] dark:bg-black/35 border border-white/10 backdrop-blur-2xl hover:border-white/20 transition-all cursor-pointer shadow-xl group"
        >
          <div className="flex items-center justify-between">
            <span
              className="text-[13px] font-[600] tracking-wider uppercase text-text-tertiary"
              style={{ fontFamily: "var(--font-inter), sans-serif" }}
            >
              {t("player.next_in_queue") || "Tiếp theo trong danh sách"}
            </span>
            <span className="flex items-center gap-[4px] text-[12px] font-[500] text-text-tertiary group-hover:text-text-primary transition-colors">
              <span>{t("player.open_queue") || "Mở danh sách"}</span>
              <ArrowRightLine size={14} />
            </span>
          </div>

          <div className="flex items-center gap-[12px] pt-[2px]">
            <div className="relative h-[48px] w-[48px] shrink-0 overflow-hidden rounded-lg bg-white/5">
              {nextTrack.coverUrl ? (
                <CoverImage
                  src={nextTrack.coverUrl}
                  alt={nextTrack.title}
                  fill
                  sizes="48px"
                  className="object-cover"
                  draggable={false}
                />
              ) : null}
            </div>

            <div className="flex min-w-0 flex-col gap-[2px]">
              <span
                className="truncate text-[14px] font-[600] text-text-primary group-hover:text-text-primary"
                style={{ fontFamily: "var(--font-inter), sans-serif" }}
              >
                {nextTrack.title}
              </span>
              <span
                className="truncate text-[12px] text-text-secondary"
                style={{ fontFamily: "var(--font-inter), sans-serif" }}
              >
                {nextTrack.artists}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
