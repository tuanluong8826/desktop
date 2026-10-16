import { useState, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
import {
  Play,
  Pause,
  SkipNext,
  SkipPrevious,
  Repeat,
  RepeatOne,
  Shuffle,
  StarsMinimalistic,
  MusicNote,
} from "@solar-icons/react";
import { HeartFill, HeartLine } from "@mingcute/react";
import { usePlayerState } from "../hooks/usePlayerState";
import { playerEngine } from "../engine/playerEngine";
import { useIsTrackLiked, useLikeTrack, useUnlikeTrack } from "@/features/library/hooks";
import { AnimatePresence, motion } from "framer-motion";
import { ArtistLink } from "@/features/artist";
import { useCoverReady, CoverImage } from "@/features/covers";
import ExplicitBadge from "@/shared/ui/ExplicitBadge";
import Tooltip from "@/shared/ui/Tooltip";
import { VolumePicker } from "./VolumePicker";
import { TimelineSlider } from "./TimelineSlider";
import LyricsIcon from "@/shared/ui/LyricsIcon";

import { useTranslation } from "@/languages";

const iconButtonClass =
  "inline-flex h-[28px] w-[28px] items-center justify-center text-white opacity-70 transition-all duration-150 ease-out hover:opacity-100 active:scale-[0.94] shrink-0 border-none bg-transparent cursor-pointer";

function PlayPauseIcon({ status }: { status: string }) {
  if (status === "loading") {
    return (
      <span
        className="h-[18px] w-[18px] animate-spin rounded-full border-[2px] border-current border-t-transparent"
        aria-label="Loading playback"
      />
    );
  }
  return status === "playing" ? (
    <Pause weight="Bold" size={22} />
  ) : (
    <Play weight="Bold" size={22} className="translate-x-[1px]" />
  );
}

interface PlayerUiElementsProps {
  onDuration?: (duration: number) => void;
  onClose?: () => void;
  showLyrics?: boolean;
  onToggleLyrics?: () => void;
  isCentered?: boolean;
}

export function PlayerUiElements({
  onDuration: _onDuration,
  onClose,
  showLyrics,
  onToggleLyrics,
  isCentered,
}: PlayerUiElementsProps) {
  const player = usePlayerState();

  const track = player.currentTrack;
  const coverUrl = track?.coverUrl || "";
  const trackTitle = track?.title || "";
  const trackArtists = track?.artists || "";

  const isLiked = useIsTrackLiked(track?.id);
  const likeMutation = useLikeTrack();
  const unlikeMutation = useUnlikeTrack();
  const togglingRef = useRef(false);

  const handleLikeToggle = useCallback(() => {
    if (!track || togglingRef.current) return;
    togglingRef.current = true;
    const onSettled = () => {
      togglingRef.current = false;
    };
    if (isLiked) {
      unlikeMutation.mutate(track.id, { onSettled });
    } else {
      likeMutation.mutate(track, { onSettled });
    }
  }, [track, isLiked, likeMutation, unlikeMutation]);

  const isCoverLoaded = useCoverReady(coverUrl);

  const { t } = useTranslation();

  return (
    <>
      {/* Artwork (Scales smoothly with layout animation when centered vs split with lyrics) */}
      <motion.div
        layout
        transition={{ duration: 0.35, ease: [0.25, 1, 0.5, 1] }}
        className={`group relative shrink-0 overflow-hidden bg-black/20 ${
          isCentered ? "w-[330px] h-[330px] rounded-2xl shadow-2xl" : "w-[280px] h-[280px] rounded-xl"
        } ${coverUrl && !isCoverLoaded ? "animate-pulse" : ""}`}
      >
        <AnimatePresence>
          <motion.div
            key={track?.id || coverUrl || "empty"}
            initial={{ opacity: 0, filter: "blur(8px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, filter: "blur(8px)" }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="absolute inset-0"
          >
            {coverUrl ? (
              <CoverImage
                key={coverUrl}
                src={coverUrl}
                alt={trackTitle}
                fill
                sizes="280px"
                priority
                unoptimized
                className="rounded-xl object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-white/5 text-white/40">
                <MusicNote size={64} />
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Heart / Like button on picture (Only visible when hovering over picture) */}
        <Tooltip
          content={isLiked ? t("common.unlike") : t("common.like")}
          side="top"
          wrapperClassName="!absolute bottom-2.5 left-2.5 z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto"
        >
          <button
            type="button"
            aria-label={isLiked ? t("common.unlike") : t("common.like")}
            className="relative inline-flex h-[32px] w-[32px] items-center justify-center rounded-full transition-all duration-200 ease-out active:scale-[0.9] bg-black/50 backdrop-blur-md border border-white/10 hover:bg-black/70 cursor-pointer pointer-events-auto shadow-lg"
            onClick={handleLikeToggle}
          >
            <motion.div
              key={isLiked ? "liked" : "unliked"}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="flex items-center justify-center"
            >
              {isLiked ? (
                <HeartFill size={18} className="text-rose-500 drop-shadow-[0_0_8px_rgba(244,63,94,0.5)]" />
              ) : (
                <HeartLine size={18} className="text-white/80 hover:text-white" />
              )}
            </motion.div>
          </button>
        </Tooltip>
      </motion.div>

      {/* Track info */}
      <div className="w-[280px] flex items-start justify-center min-w-0">
        <div className="flex flex-col gap-[2px] min-w-0 text-center">
          <p
            className="m-0 text-[15px] font-[600] text-white flex items-center justify-center gap-[6px] max-w-[280px]"
            style={{ letterSpacing: "-0.03em" }}
          >
            <span className="min-w-0 truncate">{trackTitle}</span>
          </p>
          <p className="m-0 flex items-center justify-center gap-[5px] text-[12px] text-white/60 leading-snug max-w-[320px] overflow-hidden">
            {track?.explicit && (
              <ExplicitBadge className="!bg-white/60 !text-black !pb-0 !leading-none shrink-0" />
            )}
            <ArtistLink
              name={trackArtists}
              artistId={track?.artistId}
              artistList={track?.artistList}
              onNavigate={() => {
                if (location.pathname !== "/player") {
                  onClose?.();
                }
              }}
              className="text-white/60"
            />
          </p>
        </div>
      </div>

      {/* Timeline (Compact, with smooth spring pill, no thumb) */}
      <TimelineSlider
        positionMs={player.positionMs}
        durationMs={player.durationMs}
        onSeek={(pos) => playerEngine.seek(pos)}
        showTime
        size="md"
        className="w-[320px]"
      />

      {/* Primary Playback Controls - Exactly 5 buttons so Play/Pause is always dead-center */}
      <div className="flex items-center justify-center gap-[14px]">
        <button
          type="button"
          aria-label="Shuffle"
          title={
            player.smartShuffle
              ? "Smart Shuffle (Trộn bài & Đề xuất Spotify)"
              : player.shuffle
              ? t("player.shuffle_on")
              : t("player.shuffle_off")
          }
          onClick={() => playerEngine.cycleShuffleMode()}
          className={`${iconButtonClass} relative ${
            player.smartShuffle
              ? "!text-accent-primary !opacity-100"
              : player.shuffle
              ? "!text-white !opacity-100"
              : "!text-white/40"
          }`}
        >
          <Shuffle size={18} weight={player.shuffle ? "Bold" : "Outline"} />
          {player.smartShuffle && (
            <span className="absolute -top-[2px] -right-[2px] flex text-accent-primary">
              <StarsMinimalistic size={9} weight="Bold" />
            </span>
          )}
        </button>

        <button
          type="button"
          aria-label="Previous track"
          onClick={() => void playerEngine.skipPrevious()}
          className={iconButtonClass}
        >
          <SkipPrevious size={20} weight="Bold" />
        </button>

        <button
          type="button"
          aria-label={player.status === "playing" ? "Pause" : "Play"}
          onClick={() => void playerEngine.togglePlayPause()}
          className="inline-flex h-[36px] w-[36px] items-center justify-center text-white opacity-85 transition-all duration-150 ease-out hover:opacity-100 active:scale-[0.94] shrink-0 border-none bg-transparent cursor-pointer"
        >
          <PlayPauseIcon status={player.status} />
        </button>

        <button
          type="button"
          aria-label="Next track"
          onClick={() => void playerEngine.skipNext()}
          className={iconButtonClass}
        >
          <SkipNext size={20} weight="Bold" />
        </button>

        <button
          type="button"
          aria-label="Repeat"
          onClick={() =>
            playerEngine.setRepeat(
              player.repeat === "off"
                ? "all"
                : player.repeat === "all"
                  ? "one"
                  : "off",
            )
          }
          className={`${iconButtonClass} ${
            player.repeat !== "off" ? "!text-white !opacity-100" : "!text-white/40"
          }`}
        >
          {player.repeat === "one" ? (
            <RepeatOne size={18} />
          ) : (
            <Repeat size={18} />
          )}
        </button>
      </div>

      {/* Bottom bar: Volume & Quick Actions (Volume centered, Lyrics toggle on right) */}
      <div className="w-[320px] flex items-center justify-between px-2">
        <div className="w-[28px] h-[28px] shrink-0" />
        <VolumePicker className="w-[180px]" size="sm" />
        {onToggleLyrics ? (
          <Tooltip
            content={
              showLyrics
                ? t("player.hide_lyrics") || "Ẩn lời bài hát"
                : t("player.lyrics") || "Lời bài hát"
            }
            side="top"
          >
            <button
              type="button"
              aria-label="Lyrics"
              title={
                showLyrics
                  ? t("player.hide_lyrics") || "Ẩn lời bài hát"
                  : t("player.lyrics") || "Lời bài hát"
              }
              onClick={onToggleLyrics}
              className={`${iconButtonClass} ${
                showLyrics
                  ? "!text-white !opacity-100 bg-white/20 rounded-lg"
                  : "!text-white/40 hover:!text-white"
              }`}
            >
              <LyricsIcon size={18} />
            </button>
          </Tooltip>
        ) : (
          <div className="w-[28px] h-[28px] shrink-0" />
        )}
      </div>
    </>
  );
}

export default PlayerUiElements;
