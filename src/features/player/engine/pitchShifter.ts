/**
 * Real-time Web Audio Effects Engine for independent pitch control and studio reverb.
 *
 * Pitch Shifting:
 * Uses a 4-tap Hann-windowed granular phase shifter with exact Doppler modulation
 * (s = |1 - 2^(st/12)| * T). Eliminates the comb filtering, 10-Hz motorboating,
 * and brutal metallic phase distortion of primitive 2-tap delay shifters.
 * Automatically switches to 100% bit-perfect dry bypass when pitch is 0 or linked.
 *
 * Reverb:
 * Uses a high-density stereo ConvolverNode with an algorithmic impulse response
 * featuring ~15ms soft rise, decorrelated stereo diffusion, exponential decay,
 * and progressive high-frequency air damping. Filtered with a 120Hz highpass
 * to protect sub-bass/808s.
 * Perfectly tuned for the authentic "Slowed + Reverb" aesthetic.
 */

import { audioEnhancer } from "./audioEnhancer";

const GRAIN_PERIOD = 0.038; // 38ms grain window
const NUM_TAPS = 4;

function createHannBuffer(context: AudioContext, period: number): AudioBuffer {
  const length = Math.max(1, Math.floor(period * context.sampleRate));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const p = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    // Raised cosine / Hann window (0 at boundaries, peak 1 at center)
    p[i] = Math.pow(Math.sin((Math.PI * i) / length), 2);
  }
  return buffer;
}

function createRampBuffer(context: AudioContext, period: number, rampDown: boolean): AudioBuffer {
  const length = Math.max(1, Math.floor(period * context.sampleRate));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const p = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    p[i] = rampDown ? (length - 1 - i) / length : i / length;
  }
  return buffer;
}

class HannPitchShifter {
  private context: AudioContext;
  public input: GainNode;
  public output: GainNode;

  private delays: DelayNode[] = [];
  private tapGains: GainNode[] = [];
  private depthGains: GainNode[] = [];
  private dirGainsUp: GainNode[] = [];
  private dirGainsDown: GainNode[] = [];

  constructor(context: AudioContext) {
    this.context = context;
    this.input = context.createGain();
    this.output = context.createGain();
    // Sum of 4 Hann windows staggered by T/4 is identically 2.0 at all times.
    // Multiplying by 0.5 yields exact unity gain (1.0).
    this.output.gain.value = 0.5;

    const hannBuffer = createHannBuffer(context, GRAIN_PERIOD);
    const rampDownBuffer = createRampBuffer(context, GRAIN_PERIOD, true); // Pitch up (delay shrinks)
    const rampUpBuffer = createRampBuffer(context, GRAIN_PERIOD, false); // Pitch down (delay grows)

    const t0 = context.currentTime + 0.04;

    for (let k = 0; k < NUM_TAPS; k++) {
      const delay = context.createDelay(1.0);
      delay.delayTime.value = 0.0;
      this.delays.push(delay);

      const tapGain = context.createGain();
      tapGain.gain.value = 0.0;
      this.tapGains.push(tapGain);

      this.input.connect(delay);
      delay.connect(tapGain);
      tapGain.connect(this.output);

      // Hann window buffer source
      const hannSource = context.createBufferSource();
      hannSource.buffer = hannBuffer;
      hannSource.loop = true;
      hannSource.connect(tapGain.gain);

      // Delay modulation sources
      const upSource = context.createBufferSource();
      upSource.buffer = rampDownBuffer;
      upSource.loop = true;

      const downSource = context.createBufferSource();
      downSource.buffer = rampUpBuffer;
      downSource.loop = true;

      const upGain = context.createGain();
      upGain.gain.value = 0.0;
      this.dirGainsUp.push(upGain);

      const downGain = context.createGain();
      downGain.gain.value = 0.0;
      this.dirGainsDown.push(downGain);

      const depthGain = context.createGain();
      depthGain.gain.value = 0.0;
      this.depthGains.push(depthGain);

      upSource.connect(upGain);
      downSource.connect(downGain);
      upGain.connect(depthGain);
      downGain.connect(depthGain);
      depthGain.connect(delay.delayTime);

      const phaseOffset = (k * GRAIN_PERIOD) / NUM_TAPS;
      const startTime = t0 + phaseOffset;
      hannSource.start(startTime);
      upSource.start(startTime);
      downSource.start(startTime);
    }
  }

  public setPitchOffset(semitones: number): void {
    const now = this.context.currentTime;
    if (Math.abs(semitones) < 0.02) {
      for (let k = 0; k < NUM_TAPS; k++) {
        this.depthGains[k].gain.setTargetAtTime(0, now, 0.012);
      }
      return;
    }

    const mult = Math.pow(2, semitones / 12);
    const shiftUp = semitones > 0;
    const slope = Math.abs(1 - mult);
    // Doppler equation: delay modulation depth = slope * grain period
    const delayDepth = Math.min(0.035, slope * GRAIN_PERIOD);

    for (let k = 0; k < NUM_TAPS; k++) {
      if (shiftUp) {
        this.dirGainsUp[k].gain.setValueAtTime(1, now);
        this.dirGainsDown[k].gain.setValueAtTime(0, now);
      } else {
        this.dirGainsUp[k].gain.setValueAtTime(0, now);
        this.dirGainsDown[k].gain.setValueAtTime(1, now);
      }
      this.depthGains[k].gain.setTargetAtTime(delayDepth, now, 0.012);
    }
  }
}

function createReverbImpulseResponse(context: AudioContext): AudioBuffer {
  const duration = 2.8; // 2.8s lush reverb tail
  const decay = 2.4;
  const sampleRate = context.sampleRate;
  const length = Math.floor(sampleRate * duration);

  const buffer = context.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  let lpL = 0;
  let lpR = 0;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // 15ms smooth attack prevents clicks, followed by exponential decay
    const attack = Math.min(1.0, t / 0.015);
    const env = attack * Math.exp((-2.5 * t) / decay);

    // Warm high-frequency damping over the course of the tail
    const damping = Math.max(0.15, 0.75 - 0.45 * (t / duration));

    const nL = Math.random() * 2 - 1;
    const nR = Math.random() * 2 - 1;

    lpL += damping * (nL - lpL);
    lpR += damping * (nR - lpR);

    // Stereo decorrelation for a wide, enveloping soundstage
    left[i] = lpL * env;
    right[i] = lpR * env;
  }

  // Normalize peak to 0.95
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const aL = Math.abs(left[i]);
    const aR = Math.abs(right[i]);
    if (aL > peak) peak = aL;
    if (aR > peak) peak = aR;
  }
  if (peak > 0) {
    const norm = 0.95 / peak;
    for (let i = 0; i < length; i++) {
      left[i] *= norm;
      right[i] *= norm;
    }
  }

  return buffer;
}

export interface DeckNodes {
  sourceNode: MediaElementAudioSourceNode;
  filterNode: BiquadFilterNode;
  gainNode: GainNode;
}

interface AudioEffectsGraph {
  ctx: AudioContext;
  mixerInputGain: GainNode;
  deckA: DeckNodes | null;
  deckB: DeckNodes | null;
  pitchDryGain: GainNode;
  pitchWetGain: GainNode;
  pitchStageOutput: GainNode;
  shifter: HannPitchShifter;
  masterDryGain: GainNode;
  masterOutputGain: GainNode;
  reverbSendGain: GainNode;
  convolver: ConvolverNode;
  reverbHighpass: BiquadFilterNode;
  reverbWetGain: GainNode;
}

export interface AudioEffectsParams {
  pitchSemitones?: number;
  isPitchLinked?: boolean;
  isReverbEnabled?: boolean;
  reverbLevel?: number;
}

export class PitchShifterController {
  private context: AudioContext | null = null;
  private graph: AudioEffectsGraph | null = null;
  private isConnected = false;

  private ensureGraph(ctx: AudioContext): AudioEffectsGraph {
    const win = window as any;
    if (win.__liner_pitch_graph && win.__liner_pitch_graph.mixerInputGain) {
      this.graph = win.__liner_pitch_graph;
      this.context = ctx;
      this.isConnected = true;
      return win.__liner_pitch_graph;
    }

    const mixerInputGain = ctx.createGain();
    mixerInputGain.gain.value = 1.0;

    const pitchDryGain = ctx.createGain();
    const pitchWetGain = ctx.createGain();
    const pitchStageOutput = ctx.createGain();
    const masterDryGain = ctx.createGain();
    const masterOutputGain = ctx.createGain();

    pitchDryGain.gain.value = 1.0;
    pitchWetGain.gain.value = 0.0;
    masterDryGain.gain.value = 1.0;
    masterOutputGain.gain.value = 1.0;

    const shifter = new HannPitchShifter(ctx);

    mixerInputGain.connect(pitchDryGain);
    mixerInputGain.connect(pitchWetGain);

    pitchDryGain.connect(pitchStageOutput);
    pitchWetGain.connect(shifter.input);
    shifter.output.connect(pitchStageOutput);

    pitchStageOutput.connect(masterDryGain);
    masterDryGain.connect(masterOutputGain);

    const reverbSendGain = ctx.createGain();
    reverbSendGain.gain.value = 1.0;

    const convolver = ctx.createConvolver();
    convolver.normalize = true;
    convolver.buffer = createReverbImpulseResponse(ctx);

    const reverbHighpass = ctx.createBiquadFilter();
    reverbHighpass.type = "highpass";
    reverbHighpass.frequency.value = 120;
    reverbHighpass.Q.value = 0.7;

    const reverbWetGain = ctx.createGain();
    reverbWetGain.gain.value = 0.0;

    pitchStageOutput.connect(reverbSendGain);
    reverbSendGain.connect(convolver);
    convolver.connect(reverbHighpass);
    reverbHighpass.connect(reverbWetGain);
    reverbWetGain.connect(masterOutputGain);

    const { input: enhancerIn, output: enhancerOut } = audioEnhancer.init(ctx);
    masterOutputGain.connect(enhancerIn);
    enhancerOut.connect(ctx.destination);

    const graph: AudioEffectsGraph = {
      ctx,
      mixerInputGain,
      deckA: null,
      deckB: null,
      pitchDryGain,
      pitchWetGain,
      pitchStageOutput,
      shifter,
      masterDryGain,
      masterOutputGain,
      reverbSendGain,
      convolver,
      reverbHighpass,
      reverbWetGain,
    };

    win.__liner_pitch_graph = graph;
    this.graph = graph;
    this.context = ctx;
    this.isConnected = true;
    return graph;
  }

  public attachDeck(audio: HTMLAudioElement, deckId: "A" | "B"): void {
    if (typeof window === "undefined") return;
    const win = window as any;

    try {
      const AudioCtx = window.AudioContext || win.webkitAudioContext;
      if (!AudioCtx) return;

      if (!win.__liner_audio_context) {
        win.__liner_audio_context = new AudioCtx();
      }
      const ctx = win.__liner_audio_context as AudioContext;
      this.context = ctx;

      if (ctx.state === "suspended") {
        void ctx.resume().catch((err) => {
          console.warn("[AudioEffects] AudioContext resume failed:", err);
        });
      }

      const graph = this.ensureGraph(ctx);

      const audioObj = audio as any;
      let sourceNode = audioObj.__liner_source_node as MediaElementAudioSourceNode | undefined;

      if (!sourceNode) {
        try {
          sourceNode = ctx.createMediaElementSource(audio);
          audioObj.__liner_source_node = sourceNode;
        } catch (sourceErr: any) {
          console.warn(`[AudioEffects] createMediaElementSource for Deck ${deckId} failed:`, sourceErr);
          return;
        }
      }

      const existingDeck = deckId === "A" ? graph.deckA : graph.deckB;
      if (existingDeck && existingDeck.sourceNode === sourceNode) {
        return;
      }

      const filterNode = ctx.createBiquadFilter();
      filterNode.type = "highpass";
      filterNode.frequency.value = 20;
      filterNode.Q.value = 0.707;

      const gainNode = ctx.createGain();
      gainNode.gain.value = deckId === "A" ? 1.0 : 0.0;

      sourceNode.connect(filterNode);
      filterNode.connect(gainNode);
      gainNode.connect(graph.mixerInputGain);

      const deckNodes: DeckNodes = { sourceNode, filterNode, gainNode };
      if (deckId === "A") {
        graph.deckA = deckNodes;
      } else {
        graph.deckB = deckNodes;
      }
    } catch (err) {
      console.error(`[AudioEffects] Failed to attach deck ${deckId}:`, err);
    }
  }

  public attach(audio: HTMLAudioElement): void {
    this.attachDeck(audio, "A");
  }

  public setDeckGain(deck: "A" | "B", gain: number, rampTimeSec: number = 0.02): void {
    if (!this.graph || !this.context) return;
    const deckNodes = deck === "A" ? this.graph.deckA : this.graph.deckB;
    if (!deckNodes) return;
    const now = this.context.currentTime;
    deckNodes.gainNode.gain.setTargetAtTime(Math.max(0, Math.min(1.5, gain)), now, rampTimeSec);
  }

  public setDeckFilter(deck: "A" | "B", frequencyHz: number, rampTimeSec: number = 0.02): void {
    if (!this.graph || !this.context) return;
    const deckNodes = deck === "A" ? this.graph.deckA : this.graph.deckB;
    if (!deckNodes) return;
    const now = this.context.currentTime;
    deckNodes.filterNode.frequency.setTargetAtTime(Math.max(20, Math.min(2000, frequencyHz)), now, rampTimeSec);
  }

  public resetDecks(activeDeck: "A" | "B" = "A"): void {
    this.setDeckGain("A", activeDeck === "A" ? 1.0 : 0.0, 0.01);
    this.setDeckGain("B", activeDeck === "B" ? 1.0 : 0.0, 0.01);
    this.setDeckFilter("A", 20, 0.01);
    this.setDeckFilter("B", 20, 0.01);
  }

  public resumeContext(): void {
    if (this.context && this.context.state === "suspended") {
      void this.context.resume().catch(() => {});
    }
  }

  public update(
    arg1: number | AudioEffectsParams,
    arg2?: boolean,
    arg3?: boolean,
    arg4?: number,
  ): void {
    if (!this.isConnected || !this.context || !this.graph) {
      if (typeof window !== "undefined") {
        const win = window as any;
        const audio = win.__liner_audio || (typeof document !== "undefined" && document.getElementById("liner-audio"));
        if (audio) {
          this.attach(audio);
        }
      }
      if (!this.isConnected || !this.context || !this.graph) {
        return;
      }
    }

    this.resumeContext();

    let semitones = 0;
    let isPitchLinked = true;
    let isReverbEnabled = false;
    let reverbLevel = 0.35;

    if (typeof arg1 === "object" && arg1 !== null) {
      semitones = arg1.pitchSemitones ?? 0;
      isPitchLinked = arg1.isPitchLinked ?? true;
      isReverbEnabled = arg1.isReverbEnabled ?? false;
      reverbLevel = arg1.reverbLevel ?? 0.35;
    } else {
      semitones = typeof arg1 === "number" ? arg1 : 0;
      isPitchLinked = arg2 ?? true;
      isReverbEnabled = arg3 ?? false;
      reverbLevel = arg4 ?? 0.35;
    }

    const isPitchActive = !isPitchLinked && Math.abs(semitones) >= 0.05;
    const now = this.context.currentTime;

    // Pitch shift routing
    if (isPitchActive) {
      this.graph.shifter.setPitchOffset(semitones);
      this.graph.pitchDryGain.gain.setTargetAtTime(0, now, 0.015);
      this.graph.pitchWetGain.gain.setTargetAtTime(1.0, now, 0.015);
    } else {
      this.graph.pitchDryGain.gain.setTargetAtTime(1.0, now, 0.015);
      this.graph.pitchWetGain.gain.setTargetAtTime(0, now, 0.015);
      this.graph.shifter.setPitchOffset(0);
    }

    // Reverb routing
    if (isReverbEnabled && reverbLevel > 0.01) {
      // Natural wet scaling
      const targetWet = Math.min(1.2, Math.max(0, reverbLevel));
      this.graph.reverbWetGain.gain.setTargetAtTime(targetWet, now, 0.020);
    } else {
      this.graph.reverbWetGain.gain.setTargetAtTime(0, now, 0.020);
    }
  }
}

export const pitchShifter = new PitchShifterController();
if (typeof window !== "undefined") {
  const win = window as any;
  const audio = win.__liner_audio || (typeof document !== "undefined" && document.getElementById("liner-audio"));
  if (audio) {
    pitchShifter.attach(audio);
  }
}

if (import.meta.hot) {
  import.meta.hot.accept();
}
