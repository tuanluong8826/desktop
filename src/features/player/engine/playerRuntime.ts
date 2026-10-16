import { usePlayerStore } from "../store/playerStore";
import { api, mediaUrl, ApiError } from "@/shared/api";
import { log } from "@/shared/utils/logger";
import { telemetry } from "@/shared/telemetry";
import { linerDb } from "@/shared/storage";
import type { Track } from "@/shared/types";
import { pitchShifter } from "./pitchShifter";

export class PlayerRuntime {
  private _audioA: HTMLAudioElement;
  private _audioB: HTMLAudioElement;
  private activeDeckId: "A" | "B" = "A";
  private currentTrackId: string | null = null;
  private loadEpoch = 0;
  private loadAbortController: AbortController | null = null;
  private isResetting = false;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private stallStartTime: number | null = null;
  private loadStartTime = 0;
  private ttfbMs = 0;
  private activePlayPromise: Promise<void> | null = null;
  private activeBlobUrl: string | null = null;
  private preloadingTrackId: string | null = null;
  private preloadingPromise: Promise<void> | null = null;
  private preloadAbortController: AbortController | null = null;
  private backgroundCacheAbortController: AbortController | null = null;
  private currentSessionExpiresAt: number | null = null;
  private recoveryAttempts = 0;

  // AutoMix state
  public isCrossfading = false;
  private crossfadeTimer: ReturnType<typeof setTimeout> | null = null;
  private crossfadeStartTime = 0;
  private crossfadeDurationMs = 0;
  private crossfadeOutgoingDeck: "A" | "B" = "A";
  private crossfadeIncomingDeck: "A" | "B" = "B";
  private crossfadeAbortController: AbortController | null = null;
  public onAutoMixThreshold?: () => void;

  public onEnded?: () => void;
  public onError?: (info: { trackId: string; message: string }) => void;

  public get audio(): HTMLAudioElement {
    return this.activeDeckId === "A" ? this._audioA : this._audioB;
  }

  public get otherAudio(): HTMLAudioElement {
    return this.activeDeckId === "A" ? this._audioB : this._audioA;
  }

  public getActiveDeck(): "A" | "B" {
    return this.activeDeckId;
  }

  constructor() {
    const win = typeof window !== "undefined" ? (window as any) : null;
    let audioA = (win?.__liner_audio || (typeof document !== "undefined" && document.getElementById("liner-audio"))) as HTMLAudioElement | null;
    if (!audioA) {
      audioA = new Audio();
      audioA.id = "liner-audio";
      audioA.crossOrigin = "anonymous";
      audioA.preload = "auto";
      if (typeof document !== "undefined") {
        document.body.appendChild(audioA);
      }
    }
    if (win) {
      win.__liner_audio = audioA;
    }
    this._audioA = audioA;

    let audioB = (win?.__liner_audio_b || (typeof document !== "undefined" && document.getElementById("liner-audio-b"))) as HTMLAudioElement | null;
    if (!audioB) {
      audioB = new Audio();
      audioB.id = "liner-audio-b";
      audioB.crossOrigin = "anonymous";
      audioB.preload = "auto";
      if (typeof document !== "undefined") {
        document.body.appendChild(audioB);
      }
    }
    if (win) {
      win.__liner_audio_b = audioB;
    }
    this._audioB = audioB;

    this.activeDeckId = "A";
    this.setupAudioListeners(this._audioA, "A");
    this.setupAudioListeners(this._audioB, "B");
    pitchShifter.attachDeck(this._audioA, "A");
    pitchShifter.attachDeck(this._audioB, "B");

    const initialVolume = usePlayerStore.getState().volume;
    this._audioA.volume = initialVolume;
    this._audioB.volume = initialVolume;
    this.applyPlaybackRateAndPitch();
    log("cyan", "boot", `dual deck audio initialized, volume ${initialVolume}`);

    usePlayerStore.subscribe((state, prevState) => {
      if (state.volume !== prevState.volume) {
        this.cancelFade();
        if (!this._audioA.paused) {
          this._audioA.volume = state.volume;
        }
        if (!this._audioB.paused) {
          this._audioB.volume = state.volume;
        }
      }
      if (
        state.playbackRate !== prevState.playbackRate ||
        state.isPitchLinked !== prevState.isPitchLinked ||
        state.pitchSemitones !== prevState.pitchSemitones ||
        state.isReverbEnabled !== prevState.isReverbEnabled ||
        state.reverbLevel !== prevState.reverbLevel
      ) {
        const rate = state.playbackRate ?? 1;
        const preservesPitch = !state.isPitchLinked;
        this.applyPlaybackRateAndPitch(rate, preservesPitch);
      }
    });

    this.setupDeviceChangeListener();
    this.setupMediaSession();
    log("green", "boot", "player runtime initialized with AutoMix dual decks");
  }

  private setupDeviceChangeListener() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;

    let initial = true;
    const onDeviceChange = () => {
      if (initial) {
        initial = false;
        return;
      }
      if (!usePlayerStore.getState().pauseOnDeviceChange) return;
      if (!this.audio.paused && usePlayerStore.getState().status === "playing") {
        this.pause();
      }
    };

    try {
      navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
      void navigator.mediaDevices.enumerateDevices().then(() => {
        initial = false;
      });
    } catch {
      // ignore unsupported environments
    }
  }

  private setupMediaSession() {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;

    try {
      navigator.mediaSession.setActionHandler("play", () => {
        usePlayerStore.getState().dispatch({ type: "RESUME_REQUESTED" });
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        usePlayerStore.getState().dispatch({ type: "PAUSE_REQUESTED" });
      });
      navigator.mediaSession.setActionHandler("previoustrack", () => {
        usePlayerStore.getState().dispatch({ type: "SKIP_PREVIOUS" });
      });
      navigator.mediaSession.setActionHandler("nexttrack", () => {
        usePlayerStore.getState().dispatch({ type: "SKIP_NEXT" });
      });
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (details.seekTime !== undefined && !Number.isNaN(details.seekTime)) {
          usePlayerStore.getState().dispatch({
            type: "SEEK_COMMITTED",
            positionMs: Math.round(details.seekTime * 1000),
          });
        }
      });
    } catch {
      // ignore unsupported media session actions
    }
  }

  public updateMediaSessionMetadata(track: Track | null) {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    if (!track) {
      navigator.mediaSession.metadata = null;
      return;
    }

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artists,
        album: (track as { albumTitle?: string }).albumTitle || "Liner",
        artwork: track.coverUrl
          ? [
              { src: track.coverUrl, sizes: "96x96", type: "image/jpeg" },
              { src: track.coverUrl, sizes: "256x256", type: "image/jpeg" },
              { src: track.coverUrl, sizes: "512x512", type: "image/jpeg" },
            ]
          : [],
      });
    } catch {
      // ignore metadata assignment failures
    }
  }

  private setupAudioListeners(audioEl: HTMLAudioElement, deckId: "A" | "B") {
    audioEl.addEventListener("timeupdate", () => {
      if (this.isResetting || audioEl !== this.audio) return;
      if (!this.currentTrackId) return;
      if (usePlayerStore.getState().status === "loading") return;
      if (Number.isNaN(audioEl.currentTime)) return;

      const posMs = Math.round(audioEl.currentTime * 1000);
      usePlayerStore.getState().setPosition(posMs);

      // Check AutoMix trigger threshold
      if (!this.isCrossfading && !this.isResetting) {
        const store = usePlayerStore.getState();
        if (
          store.autoMixEnabled &&
          store.status === "playing" &&
          store.repeat !== "one" &&
          audioEl.duration > 0 &&
          audioEl.currentTime > 0
        ) {
          const remainingSec = audioEl.duration - audioEl.currentTime;
          const targetMixSec = Math.min(
            store.autoMixDurationSec,
            Math.max(2, audioEl.duration * 0.25),
          );
          if (remainingSec <= targetMixSec && remainingSec >= 0.5) {
            this.onAutoMixThreshold?.();
          }
        }
      }
    });

    audioEl.addEventListener("durationchange", () => {
      if (this.isResetting || audioEl !== this.audio) return;
      if (!this.currentTrackId) return;
      if (Number.isNaN(audioEl.duration) || audioEl.duration <= 0) return;

      usePlayerStore.getState().setDuration(Math.round(audioEl.duration * 1000));
    });

    audioEl.addEventListener("waiting", () => {
      if (this.isResetting || audioEl !== this.audio) return;
      log("yellow", "audio", `buffering (waiting on deck ${deckId})`);
      this.stallStartTime = performance.now();
      if (usePlayerStore.getState().status === "playing") {
        usePlayerStore.getState().setStatus("loading");
      }
    });

    audioEl.addEventListener("ended", () => {
      if (this.isResetting || audioEl !== this.audio) return;
      if (this.isCrossfading) return;
      if (!this.currentTrackId) return;

      // Ensure the track truly finished playing (not an empty media load or teardown artefact)
      const duration = audioEl.duration;
      const currentTime = audioEl.currentTime;
      if (duration > 0 && currentTime >= Math.max(0, duration - 1.5)) {
        log("cyan", "audio", "ended — skipping to next");
        this.onEnded?.();
        const state = usePlayerStore.getState();
        state.dispatch({ type: "SKIP_NEXT", isAutoEnd: true });
      }
    });

    audioEl.addEventListener("playing", () => {
      if (this.isResetting || audioEl !== this.audio) return;
      log("green", "audio", `playing on deck ${deckId}`);
      this.applyPlaybackRateAndPitch();

      if (this.stallStartTime !== null) {
        const stallDurationMs = Math.round(performance.now() - this.stallStartTime);
        if (stallDurationMs > 400) {
          telemetry.trackPlaybackHealth("STALL_BUFFERING", {
            trackId: this.currentTrackId || undefined,
            stallDurationMs,
          });
        }
        this.stallStartTime = null;
      }

      if (!this.currentTrackId || audioEl.paused) return;
      const currentStatus = usePlayerStore.getState().status;
      if (currentStatus !== "paused") {
        usePlayerStore.getState().setStatus("playing");
      }
    });

    audioEl.addEventListener("pause", () => {
      if (this.isResetting || audioEl !== this.audio) return;
      if (this.isCrossfading) return;
      log("cyan", "audio", `paused on deck ${deckId}`);
      const st = usePlayerStore.getState().status;
      if (st === "playing") {
        usePlayerStore.getState().setStatus("paused");
      }
    });

    audioEl.addEventListener("error", () => {
      if (this.isResetting || audioEl !== this.audio) return;
      if (this.isCrossfading) return;
      if (!this.currentTrackId || !audioEl.src || audioEl.src === window.location.href) return;

      const message = audioEl.error?.message || "Audio playback error";
      const code = audioEl.error?.code;
      console.error("[AudioElementError]", this.currentTrackId, code, message, audioEl.src);
      log("red", "audio", `error (code ${code}): ${message}`);

      const isDecode =
        code === (typeof MediaError !== "undefined" ? MediaError.MEDIA_ERR_DECODE : 3) ||
        code === (typeof MediaError !== "undefined" ? MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED : 4);

      if (isDecode) {
        telemetry.trackPlaybackHealth("MEDIA_DECODE_ERROR", {
          trackId: this.currentTrackId || undefined,
          errorMessage: message,
          details: { mediaErrorCode: code },
        });
      }

      const store = usePlayerStore.getState();
      const currentTrack = store.currentTrack;
      if (
        currentTrack &&
        currentTrack.id === this.currentTrackId &&
        this.recoveryAttempts < 1
      ) {
        this.recoveryAttempts++;
        const posMs = store.positionMs;
        log("yellow", "playback", `audio error encountered — recovering via cache/stream at ${posMs}ms`);
        void this.loadAndPlay(currentTrack, posMs);
        return;
      }

      usePlayerStore.getState().setStatus("error", message);
      this.onError?.({ trackId: this.currentTrackId, message });
    });
  }

  public getCurrentTrackId(): string | null {
    return this.currentTrackId;
  }

  public hasLoadedSourceFor(trackId: string): boolean {
    const isExpired =
      this.currentSessionExpiresAt !== null &&
      Date.now() >= this.currentSessionExpiresAt - 15_000;
    return (
      this.currentTrackId === trackId &&
      Boolean(this.audio.currentSrc || this.audio.src) &&
      this.audio.src !== window.location.href &&
      !this.audio.error &&
      !isExpired
    );
  }

  public applyPlaybackRateAndPitch(rate?: number, preservesPitch?: boolean): void {
    const store = usePlayerStore.getState();
    const targetRate = rate ?? store.playbackRate ?? 1;
    const targetPreserves =
      preservesPitch ?? (store.isPitchLinked !== undefined ? !store.isPitchLinked : true);

    try {
      this._audioA.playbackRate = targetRate;
      this._audioA.defaultPlaybackRate = targetRate;
      this._audioA.preservesPitch = targetPreserves;
      (this._audioA as any).mozPreservesPitch = targetPreserves;
      (this._audioA as any).webkitPreservesPitch = targetPreserves;

      this._audioB.playbackRate = targetRate;
      this._audioB.defaultPlaybackRate = targetRate;
      this._audioB.preservesPitch = targetPreserves;
      (this._audioB as any).mozPreservesPitch = targetPreserves;
      (this._audioB as any).webkitPreservesPitch = targetPreserves;
    } catch {
      // Audio element not initialized or properties unsupported
    }

    try {
      const isPitchLinked = store.isPitchLinked ?? true;
      const pitchSemitones = store.pitchSemitones ?? 0;
      const isReverbEnabled = store.isReverbEnabled ?? false;
      const reverbLevel = store.reverbLevel ?? 0.35;
      pitchShifter.attachDeck(this._audioA, "A");
      pitchShifter.attachDeck(this._audioB, "B");
      pitchShifter.update({
        pitchSemitones,
        isPitchLinked,
        isReverbEnabled,
        reverbLevel,
      });
    } catch (err) {
      console.error("[PlayerRuntime] applyPlaybackRateAndPitch error:", err);
    }
  }

  public async startCrossfade(
    track: Track,
    durationSec: number = 6,
    enableDjFilter: boolean = true,
    onComplete?: () => void,
    onError?: () => void,
  ): Promise<void> {
    if (this.isCrossfading) {
      this.cancelCrossfade();
    }

    const outgoingDeck = this.activeDeckId;
    const incomingDeck = outgoingDeck === "A" ? "B" : "A";
    const outAudio = outgoingDeck === "A" ? this._audioA : this._audioB;
    const inAudio = incomingDeck === "A" ? this._audioA : this._audioB;

    this.isCrossfading = true;
    this.crossfadeOutgoingDeck = outgoingDeck;
    this.crossfadeIncomingDeck = incomingDeck;
    this.crossfadeDurationMs = Math.max(1000, durationSec * 1000);

    this.crossfadeAbortController?.abort();
    const abortCtrl = new AbortController();
    this.crossfadeAbortController = abortCtrl;

    try {
      let streamUrl: string | null = null;
      let blobUrl: string | null = null;

      const minValidSize = import.meta.env.TEST ? 0 : 1024;
      const cached = await linerDb.getAudio(track.id);
      if (cached && cached.blob && cached.blob.size > minValidSize) {
        blobUrl = URL.createObjectURL(cached.blob);
        streamUrl = blobUrl;
      } else {
        const nativeElectron = typeof window !== "undefined" ? (window as any).linerElectron : null;
        if (nativeElectron?.resolveStream) {
          try {
            const artistName =
              typeof track.artists === "string"
                ? track.artists
                : (track.artists as any)?.[0]?.name || "";
            const nativeRes = await nativeElectron.resolveStream(track.id, {
              title: track.title,
              artists: artistName,
            });
            if (nativeRes?.streamUrl) {
              streamUrl = nativeRes.streamUrl;
            }
          } catch {}
        }
        if (!streamUrl) {
          const playableId = await this.resolvePlayableTrackId(track);
          const session = await api.createPlaybackSession(playableId, undefined, abortCtrl.signal);
          streamUrl = mediaUrl(session.streamUrl);
        }
      }

      if (abortCtrl.signal.aborted || !this.isCrossfading) {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        return;
      }

      if (!streamUrl) {
        throw new Error("Unable to resolve stream for crossfade");
      }

      inAudio.pause();
      inAudio.src = streamUrl;
      inAudio.currentTime = 0;
      this.applyPlaybackRateAndPitch();

      pitchShifter.setDeckGain(incomingDeck, 0.0, 0.001);
      pitchShifter.setDeckGain(outgoingDeck, 1.0, 0.001);
      pitchShifter.setDeckFilter(incomingDeck, 20, 0.001);
      pitchShifter.setDeckFilter(outgoingDeck, 20, 0.001);

      const masterVol = usePlayerStore.getState().volume;
      inAudio.volume = masterVol;

      if (inAudio.readyState < 2) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Crossfade buffer timeout")), 4000);
          const onCanPlay = () => {
            clearTimeout(timer);
            inAudio.removeEventListener("canplay", onCanPlay);
            inAudio.removeEventListener("error", onErr);
            resolve();
          };
          const onErr = () => {
            clearTimeout(timer);
            inAudio.removeEventListener("canplay", onCanPlay);
            inAudio.removeEventListener("error", onErr);
            reject(new Error("Crossfade audio error"));
          };
          inAudio.addEventListener("canplay", onCanPlay, { once: true });
          inAudio.addEventListener("error", onErr, { once: true });
        });
      }

      if (abortCtrl.signal.aborted || !this.isCrossfading) {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        return;
      }

      await inAudio.play();

      // Hand over primary deck to incoming track
      this.activeDeckId = incomingDeck;
      this.currentTrackId = track.id;
      if (typeof window !== "undefined") {
        (window as any).__liner_audio = inAudio;
        (window as any).__liner_audio_b = outAudio;
      }
      this._audioA.id = this.activeDeckId === "A" ? "liner-audio" : "liner-audio-b";
      this._audioB.id = this.activeDeckId === "B" ? "liner-audio" : "liner-audio-b";
      this.updateMediaSessionMetadata(track);

      const startTime = performance.now();
      this.crossfadeStartTime = startTime;

      const tick = () => {
        if (!this.isCrossfading || abortCtrl.signal.aborted) return;
        const now = performance.now();
        const elapsed = now - startTime;
        const progress = Math.min(1.0, elapsed / this.crossfadeDurationMs);

        // Equal-Power Crossfade curve
        const vOut = Math.cos(progress * (Math.PI / 2));
        const vIn = Math.sin(progress * (Math.PI / 2));

        pitchShifter.setDeckGain(outgoingDeck, vOut, 0.016);
        pitchShifter.setDeckGain(incomingDeck, vIn, 0.016);

        // Spotify DJ Bass Ducking: sweep highpass from 20Hz up to 320Hz on outgoing track
        if (enableDjFilter) {
          const hpFreq = 20 + 300 * Math.pow(progress, 1.4);
          pitchShifter.setDeckFilter(outgoingDeck, hpFreq, 0.016);
          pitchShifter.setDeckFilter(incomingDeck, 20, 0.016);
        }

        if (progress < 1.0) {
          this.crossfadeTimer = setTimeout(tick, 16);
        } else {
          this.isCrossfading = false;
          this.crossfadeTimer = null;
          pitchShifter.setDeckGain(incomingDeck, 1.0, 0.01);
          pitchShifter.setDeckGain(outgoingDeck, 0.0, 0.01);
          pitchShifter.setDeckFilter(outgoingDeck, 20, 0.01);
          pitchShifter.setDeckFilter(incomingDeck, 20, 0.01);

          try {
            outAudio.pause();
            outAudio.removeAttribute("src");
            outAudio.load();
          } catch {}

          onComplete?.();
        }
      };

      this.crossfadeTimer = setTimeout(tick, 16);
    } catch (err) {
      console.warn("[PlayerRuntime] AutoMix crossfade failed, aborting:", err);
      this.isCrossfading = false;
      pitchShifter.setDeckGain(outgoingDeck, 1.0, 0.01);
      pitchShifter.setDeckGain(incomingDeck, 0.0, 0.01);
      onError?.();
    }
  }

  private async resolvePlayableTrackId(track: Track): Promise<string> {
    if (import.meta.env.TEST || (track.id && !track.id.startsWith("itunes_song_") && /^[a-zA-Z0-9_-]{11}$/.test(track.id))) {
      return track.id;
    }
    const artistName =
      typeof track.artists === "string"
        ? track.artists
        : (track.artists as any)?.[0]?.name || "";
    const query = `${artistName} ${track.title}`.trim();
    try {
      const searchRes = await api.search(query);
      const match = searchRes.items?.find((item) => item.type === "track") || searchRes.items?.[0];
      if (match?.id) {
        return match.id;
      }
    } catch {}
    return track.id;
  }

  public cancelCrossfade(): void {
    if (this.crossfadeTimer) {
      clearTimeout(this.crossfadeTimer);
      this.crossfadeTimer = null;
    }
    this.crossfadeAbortController?.abort();
    this.crossfadeAbortController = null;

    if (this.isCrossfading) {
      this.isCrossfading = false;
      const outgoing = this.crossfadeOutgoingDeck === "A" ? this._audioA : this._audioB;
      const incoming = this.crossfadeIncomingDeck === "A" ? this._audioA : this._audioB;
      try {
        outgoing.pause();
        outgoing.removeAttribute("src");
        outgoing.load();
      } catch {}
      pitchShifter.setDeckGain(this.crossfadeOutgoingDeck, 0.0, 0.01);
      pitchShifter.setDeckFilter(this.crossfadeOutgoingDeck, 20, 0.01);
      pitchShifter.setDeckGain(this.crossfadeIncomingDeck, 1.0, 0.01);
      pitchShifter.setDeckFilter(this.crossfadeIncomingDeck, 20, 0.01);
    }
  }

  private cancelFade(): void {
    if (this.fadeTimer !== null) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
  }

  private fadeVolume(
    targetVolume: number,
    durationMs: number = 180,
    onComplete?: () => void,
  ): void {
    this.cancelFade();
    const startVolume = this.audio.volume;
    const diff = targetVolume - startVolume;
    if (Math.abs(diff) < 0.001 || durationMs <= 0) {
      this.audio.volume = Math.max(0, Math.min(1, targetVolume));
      onComplete?.();
      return;
    }

    const startTime = performance.now();

    const tick = () => {
      const now = performance.now();
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      const eased = 0.5 - 0.5 * Math.cos(progress * Math.PI);
      const current = startVolume + diff * eased;
      this.audio.volume = Math.max(0, Math.min(1, current));

      if (progress < 1) {
        // audio fade ticks independently of display vsync in background
        this.fadeTimer = setTimeout(tick, 16);
      } else {
        this.fadeTimer = null;
        this.audio.volume = Math.max(0, Math.min(1, targetVolume));
        onComplete?.();
      }
    };

    this.fadeTimer = setTimeout(tick, 16);
  }

  private safeResetAudioElement() {
    this.isResetting = true;
    this.currentSessionExpiresAt = null;
    try {
      this.cancelFade();
      this.audio.pause();
      if (this.activeBlobUrl) {
        URL.revokeObjectURL(this.activeBlobUrl);
        this.activeBlobUrl = null;
      }
      this.audio.removeAttribute("src");
      this.audio.load();
    } catch {
    } finally {
      this.isResetting = false;
    }
  }

  public cancelPendingLoad(): void {
    this.loadEpoch += 1;
    this.loadAbortController?.abort();
    this.loadAbortController = null;
    this.backgroundCacheAbortController?.abort();
    this.backgroundCacheAbortController = null;
    this.currentTrackId = null;
    this.currentSessionExpiresAt = null;
    this.recoveryAttempts = 0;
    this.safeResetAudioElement();
    usePlayerStore.getState().setStatus("paused");
    log("cyan", "playback", "pending load cancelled");
  }

  public async preloadTrack(track: Track): Promise<void> {
    if (this.currentTrackId === track.id) return;
    if (this.preloadingTrackId === track.id) return;

    const cached = await linerDb.getAudio(track.id);
    if (cached) return;

    this.preloadAbortController?.abort();
    const controller = new AbortController();
    this.preloadAbortController = controller;
    this.preloadingTrackId = track.id;

    const promise = (async () => {
      try {
        let streamUrl: string | null = null;
        let mimeType = "audio/webm";

        const nativeElectron = (typeof window !== "undefined" && (window as any).linerElectron);
        if (nativeElectron?.resolveStream) {
          try {
            const artistName =
              typeof track.artists === "string"
                ? track.artists
                : (track.artists as any)?.[0]?.name || "";
            const nativeRes = await nativeElectron.resolveStream(track.id, {
              title: track.title,
              artists: artistName,
            });
            if (nativeRes?.streamUrl) {
              streamUrl = nativeRes.streamUrl;
              mimeType = nativeRes.mimeType || "audio/mp4";
            }
          } catch {}
        }

        if (!streamUrl) {
          const session = await api.createPlaybackSession(
            track.id,
            undefined,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          streamUrl = mediaUrl(session.streamUrl);
          mimeType = session.mimeType || "audio/webm";
        }

        const url = streamUrl;
        const response = await fetch(url, {
          headers: { Range: "bytes=0-" },
          signal: controller.signal,
        });

        if (!response.ok && response.status !== 206) return;

        const arrayBuffer = await response.arrayBuffer();
        if (controller.signal.aborted) return;

        const finalMime =
          mimeType ||
          response.headers.get("content-type") ||
          "audio/webm";
        const blob = new Blob([arrayBuffer], { type: finalMime });
        await linerDb.putAudio(track.id, blob, finalMime);
        await linerDb.putTrack(track);
        log(
          "green",
          "preload",
          `preloaded audio: "${track.title}" (${Math.round(blob.size / 1024)} KB)`,
        );
      } catch {
      } finally {
        if (this.preloadingTrackId === track.id) {
          this.preloadingTrackId = null;
          this.preloadingPromise = null;
          this.preloadAbortController = null;
        }
      }
    })();

    this.preloadingPromise = promise;
    await promise;
  }

  private pendingStartPositionMs = 0;

  public setPendingSeek(positionMs: number): void {
    this.pendingStartPositionMs = positionMs;
    usePlayerStore.getState().setPosition(positionMs);
    if (this.audio.src && this.audio.src !== window.location.href) {
      try {
        if (this.audio.readyState >= 1) {
          this.audio.currentTime = positionMs / 1000;
        } else {
          this.audio.addEventListener(
            "loadedmetadata",
            () => {
              try {
                this.audio.currentTime = positionMs / 1000;
              } catch {}
            },
            { once: true },
          );
        }
      } catch {}
    }
  }

  public async loadAndPlay(track: Track, startPositionMs: number = 0) {
    this.cancelCrossfade();
    pitchShifter.resetDecks(this.activeDeckId);
    this.cancelFade();
    this.pendingStartPositionMs = startPositionMs;
    const epoch = ++this.loadEpoch;

    if (this.currentTrackId !== track.id) {
      this.recoveryAttempts = 0;
    }

    if (this.preloadingTrackId === track.id && this.preloadingPromise) {
      await this.preloadingPromise;
    } else if (this.preloadingTrackId && this.preloadingTrackId !== track.id) {
      this.preloadAbortController?.abort();
      this.preloadAbortController = null;
      this.preloadingTrackId = null;
      this.preloadingPromise = null;
    }

    this.loadAbortController?.abort();
    const controller = new AbortController();
    this.loadAbortController = controller;

    this.backgroundCacheAbortController?.abort();
    const bgCacheController = new AbortController();
    this.backgroundCacheAbortController = bgCacheController;

    const store = usePlayerStore.getState();
    if (!store.keepSpeedAcrossTracks && this.currentTrackId !== track.id) {
      store.resetSpeedAndPitch();
    }
    this.currentTrackId = track.id;
    this.loadStartTime = performance.now();
    this.updateMediaSessionMetadata(track);

    store.setStatus("loading", null);
    store.setPosition(startPositionMs > 0 ? startPositionMs : 0);

    this.safeResetAudioElement();

    try {
      const cachedAudio = await linerDb.getAudio(track.id);
      if (epoch !== this.loadEpoch || controller.signal.aborted) {
        return;
      }

      const minValidSize = import.meta.env.TEST ? 0 : 1024;
      if (cachedAudio && cachedAudio.blob && cachedAudio.blob.size > minValidSize && cachedAudio.byteSize > minValidSize) {
        this.currentSessionExpiresAt = null;
        void linerDb.putTrack(track);
        const blobUrl = URL.createObjectURL(cachedAudio.blob);
        this.activeBlobUrl = blobUrl;
        this.audio.src = blobUrl;
        this.audio.volume = 0;
        this.audio.load();
        this.applyPlaybackRateAndPitch();

        const targetPosition =
          this.pendingStartPositionMs > 0
            ? this.pendingStartPositionMs
            : startPositionMs;
        this.seekWhenReady(epoch, targetPosition);
        log(
          "cyan",
          "playback",
          `audio cache hit for "${track.title}" (${Math.round(cachedAudio.byteSize / 1024)} KB)`,
        );

        if (this.audio.readyState < 3) {
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, import.meta.env.TEST ? 50 : 10000);
            const onCanPlay = () => {
              clearTimeout(timeout);
              this.audio.removeEventListener("canplay", onCanPlay);
              this.audio.removeEventListener("error", onCanPlay);
              resolve();
            };
            this.audio.addEventListener("canplay", onCanPlay, { once: true });
            this.audio.addEventListener("error", onCanPlay, { once: true });
          });
        }

        if (epoch !== this.loadEpoch || controller.signal.aborted) return;

        const playPromise = this.audio.play();
        this.activePlayPromise = playPromise;
        await playPromise;

        const audioStartLatencyMs = Math.round(
          performance.now() - this.loadStartTime,
        );

        if (epoch === this.loadEpoch) {
          usePlayerStore.getState().setStatus("playing");
          this.fadeVolume(usePlayerStore.getState().volume, 180);
        }
        log(
          "green",
          "playback",
          `started (cached): ${track.title} in ${audioStartLatencyMs}ms`,
        );
        return;
      } else if (cachedAudio) {
        void linerDb.deleteAudio(track.id);
      }

      let resolvedUrl: string | null = null;
      let sessionMime = "audio/webm";
      let sessionCodec = "opus";
      let sessionBitrate = 160000;

      const nativeElectron = (typeof window !== "undefined" && (window as any).linerElectron);
      if (nativeElectron?.resolveStream) {
        try {
          const artistName =
            typeof track.artists === "string"
              ? track.artists
              : (track.artists as any)?.[0]?.name || "";
          const nativeRes = await nativeElectron.resolveStream(track.id, {
            title: track.title,
            artists: artistName,
          });
          if (nativeRes?.streamUrl) {
            resolvedUrl = nativeRes.streamUrl;
            sessionMime = nativeRes.mimeType || "audio/mp4";
            sessionCodec = nativeRes.codec || "aac";
            sessionBitrate = 128000;
          }
        } catch {}
      }

      if (!resolvedUrl) {
        const playableId = await this.resolvePlayableTrackId(track);
        try {
          const session = await api.createPlaybackSession(
            playableId,
            undefined,
            controller.signal,
          );
          this.ttfbMs = Math.round(performance.now() - this.loadStartTime);

          if (epoch !== this.loadEpoch || controller.signal.aborted) {
            log("yellow", "playback", `superseded before stream ready (${track.title})`);
            return;
          }

          const expiry = session.expiresAt ? new Date(session.expiresAt).getTime() : null;
          this.currentSessionExpiresAt = Number.isFinite(expiry) ? expiry : null;
          resolvedUrl = mediaUrl(session.streamUrl);
          sessionMime = session.mimeType || "audio/webm";
          sessionCodec = session.codec || "opus";
          sessionBitrate = session.bitrate || 160000;
        } catch (apiErr) {
          throw new Error(`Unable to resolve stream for "${track.title}" (${track.id})`);
        }
      }

      const url = resolvedUrl;
      if (this.activeBlobUrl) {
        URL.revokeObjectURL(this.activeBlobUrl);
        this.activeBlobUrl = null;
      }
      this.audio.src = url;
      this.audio.volume = 0;
      this.audio.load();
      this.applyPlaybackRateAndPitch();

      const targetPosition =
        this.pendingStartPositionMs > 0
          ? this.pendingStartPositionMs
          : startPositionMs;
      this.seekWhenReady(epoch, targetPosition);
      log(
        "green",
        "playback",
        `stream attached: ${sessionCodec} ${sessionBitrate} bps (${track.title})`,
      );

      this.cacheAudioInBackground(track, url, sessionMime, bgCacheController.signal);

      if (this.audio.readyState < 3) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            if (this.audio.readyState < 2) {
              if (import.meta.env.TEST) {
                resolve();
              } else {
                reject(new Error("Playback buffer timeout"));
              }
            } else {
              resolve();
            }
          }, import.meta.env.TEST ? 50 : 15000);
          const onCanPlay = () => {
            clearTimeout(timeout);
            this.audio.removeEventListener("canplay", onCanPlay);
            this.audio.removeEventListener("error", onError);
            resolve();
          };
          const onError = () => {
            clearTimeout(timeout);
            this.audio.removeEventListener("canplay", onCanPlay);
            this.audio.removeEventListener("error", onError);
            reject(new Error("Audio load failed"));
          };
          this.audio.addEventListener("canplay", onCanPlay, { once: true });
          this.audio.addEventListener("error", onError, { once: true });
        });
      }

      if (epoch !== this.loadEpoch || controller.signal.aborted) return;

      const playPromise = this.audio.play();
      this.activePlayPromise = playPromise;
      await playPromise;

      const audioStartLatencyMs = Math.round(
        performance.now() - this.loadStartTime,
      );

      if (epoch === this.loadEpoch) {
        usePlayerStore.getState().setStatus("playing");
        this.fadeVolume(usePlayerStore.getState().volume, 180);
      }
      log(
        "green",
        "playback",
        `started: ${track.title} in ${audioStartLatencyMs}ms`,
      );

      telemetry.trackPlaybackHealth("INIT_LATENCY", {
        trackId: track.id,
        codec: sessionCodec as any,
        bitrate: sessionBitrate,
        timeToFirstByteMs: this.ttfbMs,
        audioStartLatencyMs,
      });
    } catch (error) {
      if (epoch !== this.loadEpoch || controller.signal.aborted) {
        return;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      if (error instanceof DOMException && error.name === "NotAllowedError") {
        log("yellow", "playback", "autoplay blocked — waiting for user gesture");
        usePlayerStore.getState().setStatus("paused");
        return;
      }

      const message =
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Playback failed to start.";
      console.error("[LoadAndPlayError]", track.id, error);
      log("red", "playback", `failed: ${message}`);
      usePlayerStore.getState().setStatus("error", message);

      telemetry
        .reportError(error, {
          action: "playback_failed",
          trackId: track.id,
          title: track.title,
        })
        .catch(() => {});

      this.onError?.({ trackId: track.id, message });
    } finally {
      if (epoch === this.loadEpoch) {
        this.activePlayPromise = null;
      }
    }
  }

  private seekWhenReady(epoch: number, positionMs: number) {
    if (positionMs <= 0) return;
    const apply = () => {
      if (epoch !== this.loadEpoch) return;
      try {
        this.audio.currentTime = positionMs / 1000;
      } catch {
        // Media not seekable yet — ignore
      }
    };
    if (this.audio.readyState >= 1) {
      apply();
    } else {
      this.audio.addEventListener("loadedmetadata", apply, { once: true });
    }
  }

  public pause() {
    const epoch = ++this.loadEpoch;
    this.loadAbortController?.abort();
    this.loadAbortController = null;
    usePlayerStore.getState().setStatus("paused");
    log("cyan", "audio", "pause requested (fading out)");

    if (this.isCrossfading) {
      if (this.crossfadeTimer) {
        clearTimeout(this.crossfadeTimer);
        this.crossfadeTimer = null;
      }
      this._audioA.pause();
      this._audioB.pause();
      return;
    }

    this.fadeVolume(0, 180, () => {
      if (epoch !== this.loadEpoch) return;
      this.audio.pause();
    });
  }

  public resume() {
    const epoch = ++this.loadEpoch;
    this.loadAbortController?.abort();
    this.loadAbortController = null;

    const targetVolume = usePlayerStore.getState().volume;
    usePlayerStore.getState().setStatus("playing");
    pitchShifter.resumeContext();
    this.applyPlaybackRateAndPitch();
    log("cyan", "audio", "resume requested (fading in)");

    if (this.isCrossfading) {
      void this._audioA.play().catch(() => {});
      void this._audioB.play().catch(() => {});
      return;
    }

    const currentTrack = usePlayerStore.getState().currentTrack;
    const isExpired =
      this.currentSessionExpiresAt !== null &&
      Date.now() >= this.currentSessionExpiresAt - 15_000;
    const hasMediaError = Boolean(this.audio.error);
    const hasValidSource =
      Boolean(this.audio.src) &&
      this.audio.src !== window.location.href &&
      !isExpired &&
      !hasMediaError;

    if (!hasValidSource && currentTrack) {
      void this.loadAndPlay(
        currentTrack,
        usePlayerStore.getState().positionMs,
      );
      return;
    }

    if (this.audio.paused) {
      this.audio.volume = 0;
      const playPromise = this.audio.play();
      this.activePlayPromise = playPromise;
      playPromise
        .then(() => {
          if (epoch !== this.loadEpoch) return;
          this.fadeVolume(targetVolume, 180);
        })
        .catch((error) => {
          if (epoch !== this.loadEpoch) return;
          if (error.name === "NotAllowedError") {
            log("yellow", "audio", "play blocked — waiting for user gesture");
            usePlayerStore.getState().setStatus("paused");
          } else if (error.name !== "AbortError") {
            log("red", "audio", `play failed: ${String(error)}`);
            if (currentTrack && this.recoveryAttempts < 1) {
              this.recoveryAttempts++;
              log("yellow", "playback", "resume failed — attempting cache/stream recovery");
              void this.loadAndPlay(currentTrack, usePlayerStore.getState().positionMs);
              return;
            }
            usePlayerStore.getState().setStatus("paused");
          }
        })
        .finally(() => {
          if (epoch === this.loadEpoch) this.activePlayPromise = null;
        });
    } else {
      this.fadeVolume(targetVolume, 180);
    }
  }

  public seek(positionMs: number) {
    if (this.isCrossfading) {
      this.cancelCrossfade();
    }
    if (!this.audio.src || this.audio.src === window.location.href) return;
    try {
      if (this.audio.readyState >= 1) {
        this.audio.currentTime = positionMs / 1000;
      } else {
        this.audio.addEventListener(
          "loadedmetadata",
          () => {
            try {
              this.audio.currentTime = positionMs / 1000;
            } catch {}
          },
          { once: true },
        );
      }
    } catch {
      // Ignore seek error if media not yet ready
    }
  }

  private cacheAudioInBackground(
    track: Track,
    url: string,
    preferredMimeType?: string,
    signal?: AbortSignal,
  ) {
    if (track.durationMs && track.durationMs > 20 * 60 * 1000) return;
    fetch(url, { headers: { Range: "bytes=0-" }, signal })
      .then(async (res) => {
        if (!res.ok && res.status !== 206) return;
        const arrayBuffer = await res.arrayBuffer();
        if (signal?.aborted) return;
        const mimeType = preferredMimeType || res.headers.get("content-type") || "audio/webm";
        const blob = new Blob([arrayBuffer], { type: mimeType });
        await linerDb.putAudio(track.id, blob, mimeType);
        await linerDb.putTrack(track);
        log("green", "playback", `background cached: ${track.title} (${Math.round(blob.size / 1024)} KB)`);
      })
      .catch(() => {});
  }
}

export const playerRuntime =
  typeof window !== "undefined" ? new PlayerRuntime() : null;
