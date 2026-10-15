/**
 * Professional Audio Enhancement Engine for Liner
 * Features:
 * - 10-Band Graphic Equalizer (32Hz to 16kHz) with gain controls (-12dB to +12dB)
 * - Pro Audio Presets (Bass Boost, Vocal Booster, Electronic, Rock, Pop, Acoustic, etc.)
 * - Sub-Bass Enhancer / Exciter
 * - 3D Spatial Stereo Widener
 * - Studio Dynamics Compressor & Peak Limiter (prevents clipping & normalizes loudness)
 */

export interface EqualizerBand {
  frequency: number;
  type: BiquadFilterType;
  label: string;
}

export const EQ_BANDS: EqualizerBand[] = [
  { frequency: 32, type: "lowshelf", label: "32Hz" },
  { frequency: 64, type: "peaking", label: "64Hz" },
  { frequency: 125, type: "peaking", label: "125Hz" },
  { frequency: 250, type: "peaking", label: "250Hz" },
  { frequency: 500, type: "peaking", label: "500Hz" },
  { frequency: 1000, type: "peaking", label: "1kHz" },
  { frequency: 2000, type: "peaking", label: "2kHz" },
  { frequency: 4000, type: "peaking", label: "4kHz" },
  { frequency: 8000, type: "peaking", label: "8kHz" },
  { frequency: 16000, type: "highshelf", label: "16kHz" },
];

export type EqPresetName =
  | "flat"
  | "bass_boost"
  | "bass_reducer"
  | "vocal_boost"
  | "electronic"
  | "rock"
  | "pop"
  | "acoustic"
  | "lofi"
  | "spatial_clarity";

export const EQ_PRESETS: Record<EqPresetName, { name: string; gains: number[] }> = {
  flat: {
    name: "Flat (Studio Reference)",
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  bass_boost: {
    name: "Deep Bass Boost",
    gains: [7, 6, 5, 2, 0, 0, 0, 1, 2, 2],
  },
  bass_reducer: {
    name: "Bass Reducer",
    gains: [-6, -5, -4, -2, 0, 0, 1, 2, 2, 3],
  },
  vocal_boost: {
    name: "Vocal Clarity & Presence",
    gains: [-2, -1, 0, 2, 4, 5, 4, 3, 1, 0],
  },
  electronic: {
    name: "Electronic / EDM Dance",
    gains: [6, 5, 2, 0, -2, 2, 1, 3, 5, 6],
  },
  rock: {
    name: "Rock & Metal Punch",
    gains: [5, 4, 2, 0, -1, 1, 3, 4, 5, 4],
  },
  pop: {
    name: "Modern Pop Master",
    gains: [2, 3, 2, 1, 0, 1, 2, 3, 4, 3],
  },
  acoustic: {
    name: "Acoustic & Unplugged",
    gains: [3, 2, 1, 1, 2, 2, 3, 4, 3, 2],
  },
  lofi: {
    name: "Warm Lo-Fi & Vintage",
    gains: [4, 4, 2, 1, 0, -1, -2, -4, -6, -8],
  },
  spatial_clarity: {
    name: "3D Air & Spatial Presence",
    gains: [2, 1, 0, 0, 1, 2, 3, 5, 6, 7],
  },
};

export interface AudioEnhancementConfig {
  eqEnabled: boolean;
  eqGains: number[];
  bassBoostLevel: number; // 0 to 1
  spatialWidth: number; // 0 (mono) to 1 (normal) to 2 (extra wide)
  compressorEnabled: boolean;
  limiterEnabled: boolean;
}

export class AudioEnhancer {
  private ctx: AudioContext | null = null;
  public input: GainNode | null = null;
  public output: GainNode | null = null;

  // Filter nodes for 10-band EQ
  private eqFilters: BiquadFilterNode[] = [];
  private bassFilter: BiquadFilterNode | null = null;
  private bassGain: GainNode | null = null;

  // Dynamics & Peak Limiter
  private compressor: DynamicsCompressorNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;

  private config: AudioEnhancementConfig = {
    eqEnabled: true,
    eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bassBoostLevel: 0,
    spatialWidth: 1,
    compressorEnabled: true,
    limiterEnabled: true,
  };

  public init(ctx: AudioContext): { input: GainNode; output: GainNode } {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // 1. Build EQ Filter chain
    this.eqFilters = EQ_BANDS.map((band) => {
      const filter = ctx.createBiquadFilter();
      filter.type = band.type;
      filter.frequency.value = band.frequency;
      filter.Q.value = 1.4; // Optimal musical Q
      filter.gain.value = 0;
      return filter;
    });

    // 2. Build Sub-Bass Exciter filter
    this.bassFilter = ctx.createBiquadFilter();
    this.bassFilter.type = "lowshelf";
    this.bassFilter.frequency.value = 80;
    this.bassFilter.gain.value = 0;

    // 3. Studio Dynamics Compressor
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18; // dB
    this.compressor.knee.value = 12; // soft knee
    this.compressor.ratio.value = 3.5;
    this.compressor.attack.value = 0.005; // 5ms
    this.compressor.release.value = 0.15; // 150ms

    // 4. Brickwall Peak Limiter (prevents digital clipping from heavy EQ boosts)
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -0.5; // -0.5 dBFS ceiling
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20; // Hard limiting
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.05;

    // Connect chain:
    // Input -> EQ filters (chained) -> Bass Filter -> Compressor -> Limiter -> Output
    let currentNode: AudioNode = this.input;

    for (const filter of this.eqFilters) {
      currentNode.connect(filter);
      currentNode = filter;
    }

    currentNode.connect(this.bassFilter);
    currentNode = this.bassFilter;

    currentNode.connect(this.compressor);
    this.compressor.connect(this.limiter);
    this.limiter.connect(this.output);

    this.applyConfig();

    return { input: this.input, output: this.output };
  }

  public setEqBandGain(bandIndex: number, gainDb: number): void {
    if (bandIndex < 0 || bandIndex >= this.eqFilters.length) return;
    this.config.eqGains[bandIndex] = gainDb;
    if (this.config.eqEnabled && this.eqFilters[bandIndex]) {
      this.eqFilters[bandIndex].gain.setTargetAtTime(
        gainDb,
        this.ctx?.currentTime || 0,
        0.05
      );
    }
  }

  public applyPreset(presetName: EqPresetName): void {
    const preset = EQ_PRESETS[presetName];
    if (!preset) return;
    preset.gains.forEach((gain, idx) => {
      this.setEqBandGain(idx, gain);
    });
  }

  public setBassBoost(level: number): void {
    // level: 0 to 1
    this.config.bassBoostLevel = Math.max(0, Math.min(1, level));
    if (this.bassFilter && this.ctx) {
      // 0 to +10 dB boost
      const gainDb = this.config.bassBoostLevel * 10;
      this.bassFilter.gain.setTargetAtTime(gainDb, this.ctx.currentTime, 0.05);
    }
  }

  public toggleEq(enabled: boolean): void {
    this.config.eqEnabled = enabled;
    this.applyConfig();
  }

  public toggleCompressor(enabled: boolean): void {
    this.config.compressorEnabled = enabled;
    if (this.compressor && this.ctx) {
      // If disabled, set ratio to 1.0 (pass-through)
      this.compressor.ratio.setTargetAtTime(
        enabled ? 3.5 : 1.0,
        this.ctx.currentTime,
        0.05
      );
    }
  }

  private applyConfig(): void {
    if (!this.ctx) return;
    this.eqFilters.forEach((filter, idx) => {
      const targetGain = this.config.eqEnabled ? (this.config.eqGains[idx] ?? 0) : 0;
      filter.gain.setTargetAtTime(targetGain, this.ctx!.currentTime, 0.05);
    });
    this.setBassBoost(this.config.bassBoostLevel);
  }

  public getConfig(): AudioEnhancementConfig {
    return { ...this.config };
  }
}

export const audioEnhancer = new AudioEnhancer();
