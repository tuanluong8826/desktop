import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Track } from "@/shared/types";
import { debouncedStorage } from "@/shared/utils/storage";
import { audioEnhancer } from "../engine/audioEnhancer";

export { debouncedStorage };

export type RepeatMode = "off" | "all" | "one";
export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";
export type MiniPlayerStyle = "default" | "rounded";
export type AudioQuality = "low" | "standard" | "high" | "lossless";
export type TrackDoubleClickBehavior = "play" | "queue";
export type DefaultPlaybackContext = "resume" | "empty";
export type AccentVariant =
  | "default"
  | "spotify"
  | "discord"
  | "telegram"
  | "aurora"
  | "sunset"
  | "ocean"
  | "forest"
  | "berry"
  | "carbon"
  | "pixel"
  | "scanlines"
  | "vhs";

export type AppIconStyle =
  | "default"
  | "cyber"
  | "sunset"
  | "emerald"
  | "gold"
  | "minimal";

export interface TransportState {
  status: PlayerStatus;
  playbackMode: "hls" | "mp3" | null;
  error: string | null;
}

export interface TimelineState {
  positionMs: number;
  durationMs: number;
}

export interface QueueState {
  queue: Track[];
  currentIndex: number;
  currentTrack: Track | null;
  playbackContext: string | null;
  playbackContextCover: string | null;
}

export interface SessionState {
  volume: number;
  repeat: RepeatMode;
  shuffle: boolean;
  audioQuality: AudioQuality;
  miniPlayerStyle: MiniPlayerStyle;
  accentVariant: AccentVariant;
  appIconStyle: AppIconStyle;
  pauseOnDeviceChange: boolean;
  autoplaySimilar: boolean;
  trackDoubleClickBehavior: TrackDoubleClickBehavior;
  defaultPlaybackContext: DefaultPlaybackContext;
  fullscreen: boolean;
  showLyrics: boolean;
  playbackRate: number;
  pitchSemitones: number;
  isPitchLinked: boolean;
  keepSpeedAcrossTracks: boolean;
  isReverbEnabled: boolean;
  reverbLevel: number;
  discordRpcEnabled: boolean;
  autoMixEnabled: boolean;
  autoMixDurationSec: number;
  autoMixDjFilter: boolean;
  spatialAudioEnabled: boolean;
  soundCheckEnabled: boolean;
  appleDigitalMasterEnabled: boolean;
  smartShuffle: boolean;
}

export type PlayerState = TransportState &
  TimelineState &
  QueueState &
  SessionState;

export type PlayerCommand =
  | {
      type: "PLAY_REQUESTED";
      track: Track;
      queue?: Track[];
      context?: string | null;
      contextCover?: string | null;
    }
  | { type: "PAUSE_REQUESTED" }
  | { type: "RESUME_REQUESTED" }
  | { type: "SEEK_COMMITTED"; positionMs: number }
  | { type: "SKIP_NEXT"; isAutoEnd?: boolean }
  | { type: "SKIP_PREVIOUS" }
  | { type: "SET_VOLUME"; volume: number }
  | { type: "SET_PLAYBACK_RATE"; rate: number }
  | { type: "SET_PITCH_SEMITONES"; semitones: number }
  | { type: "SET_REVERB_ENABLED"; enabled: boolean }
  | { type: "SET_REVERB_LEVEL"; level: number }
  | { type: "TOGGLE_PLAY_PAUSE" };

export interface PlayerStore extends PlayerState {
  dispatch: (command: PlayerCommand) => void;
  setStatus: (status: PlayerStatus, error?: string | null) => void;
  setPosition: (positionMs: number) => void;
  setDuration: (durationMs: number) => void;
  setPlaybackMode: (mode: "hls" | "mp3" | null) => void;
  setRepeat: (mode: RepeatMode) => void;
  setShuffle: (shuffle: boolean) => void;
  setVolume: (volume: number) => void;
  setCurrentTrack: (track: Track | null, index: number) => void;
  setQueue: (queue: Track[]) => void;
  setPlaybackContext: (context: string | null) => void;
  setPlaybackContextCover: (cover: string | null) => void;
  setAudioQuality: (quality: AudioQuality) => void;
  setMiniPlayerStyle: (style: MiniPlayerStyle) => void;
  setAccentVariant: (variant: AccentVariant) => void;
  setAppIconStyle: (style: AppIconStyle) => void;
  setPauseOnDeviceChange: (value: boolean) => void;
  setAutoplaySimilar: (value: boolean) => void;
  setTrackDoubleClickBehavior: (value: TrackDoubleClickBehavior) => void;
  setDefaultPlaybackContext: (value: DefaultPlaybackContext) => void;
  setFullscreen: (value: boolean) => void;
  setShowLyrics: (value: boolean) => void;
  toggleLyrics: () => void;
  setPlaybackRate: (rate: number) => void;
  setPitchSemitones: (semitones: number) => void;
  setIsPitchLinked: (linked: boolean) => void;
  setKeepSpeedAcrossTracks: (keep: boolean) => void;
  setIsReverbEnabled: (enabled: boolean) => void;
  setReverbLevel: (level: number) => void;
  setDiscordRpcEnabled: (enabled: boolean) => void;
  setAutoMixEnabled: (enabled: boolean) => void;
  setAutoMixDurationSec: (durationSec: number) => void;
  setAutoMixDjFilter: (enabled: boolean) => void;
  setSpatialAudioEnabled: (enabled: boolean) => void;
  setSoundCheckEnabled: (enabled: boolean) => void;
  setAppleDigitalMasterEnabled: (enabled: boolean) => void;
  setSmartShuffle: (enabled: boolean) => void;
  resetSpeedAndPitch: () => void;
  clearQueue: () => void;
}

const PLAYER_SESSION_STORAGE_KEY = "liner_player_session_v2";

export const usePlayerStore = create<PlayerStore>()(
  persist(
    (set, get) => ({
      // TransportSlice
      status: "idle",
      playbackMode: null,
      error: null,

      // TimelineSlice
      positionMs: 0,
      durationMs: 0,

      // QueueSlice
      queue: [],
      currentIndex: -1,
      currentTrack: null,
      playbackContext: null,
      playbackContextCover: null,

      // SessionSlice
      volume: 1,
      repeat: "off",
      shuffle: false,
      audioQuality: "high",
      miniPlayerStyle: "default",
      accentVariant: "default",
      appIconStyle: "default",
      pauseOnDeviceChange: true,
      autoplaySimilar: true,
      trackDoubleClickBehavior: "play",
      defaultPlaybackContext: "resume",
      fullscreen: false,
      showLyrics: false,
      playbackRate: 1,
      pitchSemitones: 0,
      isPitchLinked: true,
      keepSpeedAcrossTracks: true,
      isReverbEnabled: false,
      reverbLevel: 0.35,
      discordRpcEnabled: true,
      autoMixEnabled: true,
      autoMixDurationSec: 6,
      autoMixDjFilter: true,
      spatialAudioEnabled: true,
      soundCheckEnabled: true,
      appleDigitalMasterEnabled: false,
      smartShuffle: false,

      dispatch: () => {
        // Implementation injected by PlayerEngine
      },

      setStatus: (status, error = null) => set({ status, error }),
      setPosition: (positionMs) => set({ positionMs }),
      setDuration: (durationMs) => set({ durationMs }),
      setPlaybackMode: (playbackMode) => set({ playbackMode }),
      setRepeat: (repeat) => set({ repeat }),
      setShuffle: (shuffle) => set({ shuffle }),
      setVolume: (volume) => set({ volume }),
      setCurrentTrack: (currentTrack, currentIndex) => {
        const prev = get().currentTrack;
        const isDifferent = prev?.id !== currentTrack?.id;
        set({
          currentTrack,
          currentIndex,
          ...(isDifferent ? { positionMs: 0 } : {}),
        });
      },
      setQueue: (queue) => set({ queue }),
      setPlaybackContext: (playbackContext) => set({ playbackContext }),
      setPlaybackContextCover: (playbackContextCover) =>
        set({ playbackContextCover }),
      setAudioQuality: (audioQuality) => set({ audioQuality }),
      setMiniPlayerStyle: (miniPlayerStyle: MiniPlayerStyle) =>
        set({ miniPlayerStyle }),
      setAccentVariant: (accentVariant: AccentVariant) =>
        set({ accentVariant }),
      setAppIconStyle: (appIconStyle: AppIconStyle) =>
        set({ appIconStyle }),
      setPauseOnDeviceChange: (pauseOnDeviceChange: boolean) =>
        set({ pauseOnDeviceChange }),
      setAutoplaySimilar: (autoplaySimilar: boolean) =>
        set({ autoplaySimilar }),
      setTrackDoubleClickBehavior: (trackDoubleClickBehavior: TrackDoubleClickBehavior) =>
        set({ trackDoubleClickBehavior }),
      setDefaultPlaybackContext: (defaultPlaybackContext: DefaultPlaybackContext) =>
        set({ defaultPlaybackContext }),
      setFullscreen: (fullscreen: boolean) => {
        if (get().fullscreen === fullscreen) return;
        set({ fullscreen });
      },
      setShowLyrics: (showLyrics: boolean) => set({ showLyrics }),
      toggleLyrics: () => set((state) => ({ showLyrics: !state.showLyrics })),
      setPlaybackRate: (playbackRate: number) => set({ playbackRate }),
      setPitchSemitones: (pitchSemitones: number) => set({ pitchSemitones }),
      setIsPitchLinked: (isPitchLinked: boolean) => set({ isPitchLinked }),
      setKeepSpeedAcrossTracks: (keepSpeedAcrossTracks: boolean) =>
        set({ keepSpeedAcrossTracks }),
      setIsReverbEnabled: (isReverbEnabled: boolean) => set({ isReverbEnabled }),
      setReverbLevel: (reverbLevel: number) =>
        set({ reverbLevel: Math.max(0, Math.min(1, reverbLevel)) }),
      setDiscordRpcEnabled: (discordRpcEnabled: boolean) => {
        set({ discordRpcEnabled });
        if (typeof window !== "undefined" && window.linerElectron?.setDiscordRpcEnabled) {
          void window.linerElectron.setDiscordRpcEnabled(discordRpcEnabled);
        }
      },
      setAutoMixEnabled: (autoMixEnabled: boolean) => set({ autoMixEnabled }),
      setAutoMixDurationSec: (autoMixDurationSec: number) =>
        set({ autoMixDurationSec: Math.max(1, Math.min(15, autoMixDurationSec)) }),
      setAutoMixDjFilter: (autoMixDjFilter: boolean) => set({ autoMixDjFilter }),
      setSpatialAudioEnabled: (spatialAudioEnabled: boolean) => {
        set({ spatialAudioEnabled });
        audioEnhancer.toggleSpatialAudio(spatialAudioEnabled);
      },
      setSoundCheckEnabled: (soundCheckEnabled: boolean) => {
        set({ soundCheckEnabled });
        audioEnhancer.toggleSoundCheck(soundCheckEnabled);
      },
      setAppleDigitalMasterEnabled: (appleDigitalMasterEnabled: boolean) => {
        set({ appleDigitalMasterEnabled });
        audioEnhancer.toggleAppleMaster(appleDigitalMasterEnabled);
      },
      setSmartShuffle: (smartShuffle: boolean) => set({ smartShuffle }),
      resetSpeedAndPitch: () => set({ playbackRate: 1, pitchSemitones: 0 }),
      clearQueue: () => {
        const state = get();
        if (state.currentTrack) {
          set({
            queue: [state.currentTrack],
            currentIndex: 0,
            playbackContext: null,
            playbackContextCover: null,
          });
        } else {
          set({
            queue: [],
            currentIndex: -1,
            currentTrack: null,
            playbackContext: null,
            playbackContextCover: null,
            fullscreen: false,
          });
        }
      },
    }),
    {
      name: PLAYER_SESSION_STORAGE_KEY,
      storage: createJSONStorage(() => debouncedStorage),
      onRehydrateStorage: () => (state) => {
        // After hydration, if a track was saved, restore as paused so the UI
        // shows the track and position without auto-playing.
        if (state?.currentTrack) {
          state.status = "paused";
        }
        // Guard against a persisted accent variant that no longer exists.
        const validVariants: AccentVariant[] = [
          "default",
          "spotify",
          "discord",
          "telegram",
          "aurora",
          "sunset",
          "ocean",
          "forest",
          "berry",
          "carbon",
          "pixel",
          "scanlines",
          "vhs",
        ];
        if (state && !validVariants.includes(state.accentVariant)) {
          state.accentVariant = "default";
        }
        const validIconStyles: AppIconStyle[] = [
          "default",
          "cyber",
          "sunset",
          "emerald",
          "gold",
          "minimal",
        ];
        if (state && !validIconStyles.includes(state.appIconStyle)) {
          state.appIconStyle = "default";
        }
        if (state) {
          if (typeof state.playbackRate !== "number" || isNaN(state.playbackRate)) {
            state.playbackRate = 1;
          }
          if (typeof state.pitchSemitones !== "number" || isNaN(state.pitchSemitones)) {
            state.pitchSemitones = 0;
          }
          if (typeof state.isPitchLinked !== "boolean") {
            state.isPitchLinked = true;
          }
          if (typeof state.keepSpeedAcrossTracks !== "boolean") {
            state.keepSpeedAcrossTracks = true;
          }
          if (typeof state.isReverbEnabled !== "boolean") {
            state.isReverbEnabled = false;
          }
          if (typeof state.reverbLevel !== "number" || isNaN(state.reverbLevel)) {
            state.reverbLevel = 0.35;
          }
          if (typeof state.autoMixEnabled !== "boolean") {
            state.autoMixEnabled = true;
          }
          if (typeof state.autoMixDurationSec !== "number" || isNaN(state.autoMixDurationSec)) {
            state.autoMixDurationSec = 6;
          }
          if (typeof state.autoMixDjFilter !== "boolean") {
            state.autoMixDjFilter = true;
          }
          if (typeof state.spatialAudioEnabled !== "boolean") {
            state.spatialAudioEnabled = true;
          }
          if (typeof state.soundCheckEnabled !== "boolean") {
            state.soundCheckEnabled = true;
          }
          if (typeof state.appleDigitalMasterEnabled !== "boolean") {
            state.appleDigitalMasterEnabled = false;
          }
          if (typeof state.smartShuffle !== "boolean") {
            state.smartShuffle = false;
          }
          audioEnhancer.toggleSpatialAudio(state.spatialAudioEnabled);
          audioEnhancer.toggleSoundCheck(state.soundCheckEnabled);
          audioEnhancer.toggleAppleMaster(state.appleDigitalMasterEnabled);
        }
      },
      partialize: (state) => ({
        ...(state.defaultPlaybackContext === "resume"
          ? {
              queue: state.queue,
              currentIndex: state.currentIndex,
              currentTrack: state.currentTrack,
              playbackContext: state.playbackContext,
              playbackContextCover: state.playbackContextCover,
              playbackMode: state.playbackMode,
              positionMs: state.positionMs,
              durationMs: state.durationMs,
            }
          : {}),
        repeat: state.repeat,
        shuffle: state.shuffle,
        volume: state.volume,
        audioQuality: state.audioQuality,
        miniPlayerStyle: state.miniPlayerStyle,
        accentVariant: state.accentVariant,
        appIconStyle: state.appIconStyle,
        pauseOnDeviceChange: state.pauseOnDeviceChange,
        autoplaySimilar: state.autoplaySimilar,
        trackDoubleClickBehavior: state.trackDoubleClickBehavior,
        defaultPlaybackContext: state.defaultPlaybackContext,
        playbackRate: state.playbackRate,
        pitchSemitones: state.pitchSemitones,
        isPitchLinked: state.isPitchLinked,
        keepSpeedAcrossTracks: state.keepSpeedAcrossTracks,
        isReverbEnabled: state.isReverbEnabled,
        reverbLevel: state.reverbLevel,
        discordRpcEnabled: state.discordRpcEnabled,
        autoMixEnabled: state.autoMixEnabled,
        autoMixDurationSec: state.autoMixDurationSec,
        autoMixDjFilter: state.autoMixDjFilter,
        spatialAudioEnabled: state.spatialAudioEnabled,
        soundCheckEnabled: state.soundCheckEnabled,
        appleDigitalMasterEnabled: state.appleDigitalMasterEnabled,
        smartShuffle: state.smartShuffle,
        showLyrics: state.showLyrics,
      }),
    },
  ),
);
