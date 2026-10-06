/**
 * All audio is synthesized with Web Audio: a small synthwave loop and short, soft effects.
 * Nothing is loaded from files.
 */

export type SoundMode = 'all' | 'sfx' | 'off';
export type MusicState = 'off' | 'title' | 'race' | 'final';

const MODE_KEY = 'mobius-kart-sound';
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

// Am – F – C – G, one bar each.
const CHORDS = [
  [57, 60, 64],
  [57, 60, 65],
  [55, 60, 64],
  [55, 59, 62],
];
const BASS = [45, 41, 48, 43];
const ARP = [0, 1, 2, 3, 2, 1, 0, 1];
const BASS_STEPS = new Set([0, 3, 6, 8, 11, 14]);
const STEPS = 64;

export class SoundSystem {
  mode: SoundMode = 'all';
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private noiseBuf!: AudioBuffer;

  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private engineOsc: OscillatorNode[] = [];

  private music: MusicState = 'off';
  private bpm = 112;
  private step = 0;
  private nextStepTime = 0;

  constructor() {
    try {
      const saved = localStorage.getItem(MODE_KEY);
      if (saved === 'all' || saved === 'sfx' || saved === 'off') this.mode = saved;
    } catch {
      // Storage unavailable (private mode etc.): keep the default.
    }
  }

  /** Must run inside a user gesture, or browsers keep the audio context suspended. */
  init() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(comp);

    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 3200;
    this.musicBus = ctx.createGain();
    this.musicFilter.connect(this.musicBus).connect(this.master);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Engine: two detuned low oscillators through a lowpass, so it's a hum rather than a buzz.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 300;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.sfxBus);
    for (const [type, detune] of [['sawtooth', 0], ['square', 7]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 50;
      o.detune.value = detune;
      o.connect(this.engineFilter);
      o.start();
      this.engineOsc.push(o);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void ctx.suspend();
      else void ctx.resume();
    });

    this.applyMode();
    this.nextStepTime = ctx.currentTime + 0.1;
    window.setInterval(() => this.schedule(), 25);
  }

  cycleMode(): SoundMode {
    this.mode = this.mode === 'all' ? 'sfx' : this.mode === 'sfx' ? 'off' : 'all';
    try {
      localStorage.setItem(MODE_KEY, this.mode);
    } catch {
      // Not persisted; fine.
    }
    this.applyMode();
    return this.mode;
  }

  private applyMode() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfxBus.gain.setTargetAtTime(this.mode === 'off' ? 0 : 1, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.mode === 'all' ? 0.42 : 0, t, 0.1);
  }

  setMusic(state: MusicState) {
    if (state === this.music) return;
    this.music = state;
    this.bpm = state === 'final' ? 124 : 112;
    if (this.ctx) {
      // Title is softer and darker; the race opens the filter up.
      this.musicFilter.frequency.setTargetAtTime(state === 'title' ? 1400 : 3200, this.ctx.currentTime, 0.4);
    }
  }

  /** speed: 0..~1.5 of top speed. on=false fades the engine out. */
  engine(on: boolean, speed: number, boosting: boolean, airborne: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 48 + 70 * speed + (boosting ? 18 : 0) + (airborne ? 22 : 0);
    for (const o of this.engineOsc) o.frequency.setTargetAtTime(f, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(260 + 700 * speed, t, 0.1);
    this.engineGain.gain.setTargetAtTime(on ? 0.025 : 0, t, 0.15);
  }

  // ---------------------------------------------------------------------------
  // Music

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (this.nextStepTime < ctx.currentTime - 0.2) this.nextStepTime = ctx.currentTime + 0.05;
    while (this.nextStepTime < ctx.currentTime + 0.12) {
      if (this.music !== 'off' && this.mode === 'all') this.playStep(this.step, this.nextStepTime);
      this.nextStepTime += 60 / this.bpm / 4;
      this.step = (this.step + 1) % STEPS;
    }
  }

  private playStep(step: number, t: number) {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = CHORDS[bar];
    const barLen = (60 / this.bpm) * 4;
    const full = this.music === 'race' || this.music === 'final';

    if (s === 0) for (const n of chord) this.pad(midi(n), t, barLen);
    if (s % 2 === 0) {
      const tones = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[0] + 24];
      this.pluck(midi(tones[ARP[(s / 2) % ARP.length]]), t, full ? 0.035 : 0.025);
    }
    if (!full) return;

    if (BASS_STEPS.has(s)) this.bass(midi(BASS[bar]), t);
    if (s % 4 === 0) this.kick(t);
    if (s === 4 || s === 12) this.snare(t);
    if (s % 4 === 2 || (this.music === 'final' && s % 2 === 1)) this.hat(t);
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private pad(freq: number, t: number, len: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    o.detune.value = (Math.random() - 0.5) * 12;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.022, t + 0.4);
    g.gain.setValueAtTime(0.022, t + len - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.2);
    o.connect(lp).connect(g).connect(this.musicFilter);
    o.start(t);
    o.stop(t + len + 0.3);
  }

  private pluck(freq: number, t: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    const g = ctx.createGain();
    this.env(g, t, vol, 0.005, 0.18);
    o.connect(lp).connect(g).connect(this.musicFilter);
    o.start(t);
    o.stop(t + 0.25);
  }

  private bass(freq: number, t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    const g = ctx.createGain();
    this.env(g, t, 0.16, 0.005, 0.22);
    o.connect(g).connect(this.musicFilter);
    o.start(t);
    o.stop(t + 0.3);
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = ctx.createGain();
    this.env(g, t, 0.28, 0.003, 0.22);
    o.connect(g).connect(this.musicFilter);
    o.start(t);
    o.stop(t + 0.3);
  }

  private snare(t: number) {
    this.noiseHit(t, 0.07, 0.13, 'bandpass', 1800, this.musicFilter);
  }

  private hat(t: number) {
    this.noiseHit(t, 0.025, 0.04, 'highpass', 7000, this.musicFilter);
  }

  private noiseHit(t: number, vol: number, dur: number, type: BiquadFilterType, freq: number, dest: AudioNode, to?: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    this.env(g, t, vol, 0.005, dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------------------
  // Sound effects

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; vol?: number; to?: number; delay?: number } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (opts.delay ?? 0);
    const o = this.ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, opts.vol ?? 0.15, 0.008, dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private whoosh(dur: number, vol: number, from: number, to: number, delay = 0) {
    if (!this.ctx) return;
    this.noiseHit(this.ctx.currentTime + delay, vol, dur, 'bandpass', from, this.sfxBus, to);
  }

  countdown(go: boolean) {
    if (go) this.tone(880, 0.45, { type: 'square', vol: 0.09 });
    else this.tone(440, 0.16, { type: 'square', vol: 0.08 });
  }

  pickup() {
    [784, 988, 1319].forEach((f, i) => this.tone(f, 0.12, { type: 'triangle', vol: 0.09, delay: i * 0.05 }));
  }

  boost() {
    this.whoosh(0.5, 0.18, 500, 2600);
    this.tone(180, 0.4, { type: 'sawtooth', vol: 0.04, to: 420 });
  }


  slickDrop() {
    this.tone(320, 0.22, { vol: 0.14, to: 110 });
  }

  slicked() {
    [520, 390, 260].forEach((f, i) => this.tone(f, 0.14, { type: 'triangle', vol: 0.1, to: f * 0.8, delay: i * 0.09 }));
  }

  skated() {
    this.whoosh(0.25, 0.12, 3000, 6000);
  }

  thumpHop() {
    this.tone(180, 0.14, { type: 'triangle', vol: 0.08, to: 360 });
  }

  /** proximity 0..1 so slams near you (often right under you) are heard, distant ones aren't. */
  slam(proximity = 1) {
    if (proximity <= 0.05) return;
    this.tone(150, 0.38, { vol: 0.32 * proximity, to: 34 });
    this.whoosh(0.18, 0.08 * proximity, 400, 120);
  }

  warning() {
    this.tone(1250, 0.06, { type: 'square', vol: 0.05 });
    this.tone(1250, 0.06, { type: 'square', vol: 0.05, delay: 0.1 });
  }

  launched() {
    this.tone(160, 0.32, { type: 'triangle', vol: 0.13, to: 640 });
  }

  bigAir() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.14, { type: 'triangle', vol: 0.09, delay: i * 0.055 }));
  }

  thumped() {
    this.tone(120, 0.3, { vol: 0.25, to: 40 });
    this.tone(420, 0.35, { type: 'triangle', vol: 0.07, to: 110, delay: 0.05 });
  }

  gotcha() {
    this.tone(784, 0.1, { type: 'square', vol: 0.06 });
    this.tone(1047, 0.18, { type: 'square', vol: 0.06, delay: 0.09 });
  }

  link() {
    this.tone(1568, 0.5, { type: 'triangle', vol: 0.035 });
    this.tone(2093, 0.5, { type: 'triangle', vol: 0.025, delay: 0.06 });
  }

  lap(final: boolean) {
    const notes = final ? [784, 988, 1175, 1568] : [1047, 1319];
    notes.forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', vol: 0.08, delay: i * 0.08 }));
  }

  finish(won: boolean) {
    const notes = won ? [523, 659, 784, 1047, 1319] : [523, 659, 784, 1047];
    notes.forEach((f, i) => this.tone(f, i === notes.length - 1 ? 0.7 : 0.14, { type: 'square', vol: 0.06, delay: i * 0.1 }));
  }
}
