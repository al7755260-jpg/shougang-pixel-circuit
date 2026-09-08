import {RaceMusic} from './race-music.js';

/** Gesture-unlocked audio with independently mixed music and race effects. */
export class GameAudio {
  constructor({ volume = 0.5, muted = false, music } = {}) {
    this.context = null;
    this.master = null;
    this.muted = Boolean(muted);
    this.volume = clamp(Number(volume) || 0, 0, 1);
    this.supported = true;
    this._unlocking = null;
    this._voices = new Set();
    this._lastEvents = new Map();
    this._continuous = [];
    this._visibilityHandler = null;
    this._disposed = false;
    this.music = new RaceMusic(music);this.music.setMuted(this.muted);
  }

  /** Call directly from a start-button / keyboard / pointer event. */
  async unlock() {
    if (this._disposed) return false;
    if (this._unlocking) return this._unlocking;
    this._unlocking = this._unlock();
    try {
      return await this._unlocking;
    } finally {
      this._unlocking = null;
    }
  }

  async _unlock() {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) {
      this.supported = false;
      return false;
    }
    try {
      if (!this.context) {
        this.context = new AudioContextClass({ latencyHint: 'interactive' });
        this._buildGraph();
      }
      this.music.unlock();
      if (this.context.state === 'suspended' || this.context.state === 'interrupted') {
        await this.context.resume();
      }
      this._applyVolume();
      return this.context.state === 'running';
    } catch (error) {
      // Audio is optional: privacy settings or device errors must not stop a race.
      this.lastError = String(error?.message || error);
      return false;
    }
  }

  _buildGraph() {
    const c = this.context;
    this.master = c.createGain();
    this.master.gain.value = 0;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 14;
    limiter.ratio.value = 5;
    limiter.attack.value = 0.006;
    limiter.release.value = 0.16;
    this.master.connect(limiter);
    limiter.connect(c.destination);
    this.music.connect(c,limiter);

    this.engineGain = c.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = c.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 900;
    this.engineFilter.Q.value = 0.45;
    this.engineGain.connect(this.engineFilter);
    this.engineFilter.connect(this.master);

    // A quiet triangle body and restrained square overtone suggest a tiny motor.
    this.engineLow = this._loopOscillator('triangle', 58, 0.30, this.engineGain);
    this.engineBody = this._loopOscillator('triangle', 116, 0.55, this.engineGain);
    this.enginePixel = this._loopOscillator('square', 232, 0.07, this.engineGain);

    this.noiseBuffer = c.createBuffer(1, Math.ceil(c.sampleRate * 2), c.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    let seed = 17329;
    let smooth = 0;
    for (let i = 0; i < data.length; i += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const white = seed / 2147483648 - 1;
      smooth = smooth * 0.75 + white * 0.25;
      data[i] = smooth;
    }
    const driftNoise = c.createBufferSource();
    driftNoise.buffer = this.noiseBuffer;
    driftNoise.loop = true;
    this.driftFilter = c.createBiquadFilter();
    this.driftFilter.type = 'bandpass';
    this.driftFilter.frequency.value = 1500;
    this.driftFilter.Q.value = 0.7;
    this.driftGain = c.createGain();
    this.driftGain.gain.value = 0;
    driftNoise.connect(this.driftFilter);
    this.driftFilter.connect(this.driftGain);
    this.driftGain.connect(this.master);
    driftNoise.start();
    this._continuous.push(driftNoise);

    this._visibilityHandler = () => {
      this._applyVolume();
      if (globalThis.document?.hidden) this._fadeEngine();
    };
    globalThis.document?.addEventListener('visibilitychange', this._visibilityHandler);
    this._applyVolume();
  }

  _loopOscillator(type, frequency, level, destination) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.value = level;
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();
    this._continuous.push(oscillator);
    return oscillator;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this.music.setMuted(this.muted);
    this._applyVolume();
  }

  setMusicVolume(volume) {this.music.setVolume(volume);}

  setVolume(volume) {
    const value = Number(volume);
    if (Number.isFinite(value)) this.volume = clamp(value, 0, 1);
    this._applyVolume();
  }

  _applyVolume() {
    if (!this.context || !this.master || this.context.state === 'closed') return;
    const audible = !this.muted && !globalThis.document?.hidden;
    this.master.gain.setTargetAtTime(audible ? this.volume * 0.48 : 0, this.context.currentTime, 0.025);
  }

  _fadeEngine() {
    if (!this.context || this.context.state === 'closed') return;
    const time = this.context.currentTime;
    this.engineGain?.gain.setTargetAtTime(0, time, 0.085);
    this.driftGain?.gain.setTargetAtTime(0, time, 0.04);
  }

  /** speed is world units / second; throttle / drift / boost accept bool or 0..1. */
  update({ speed = 0, throttle = 0, drift = 0, boost = 0, phase = 'menu', musicPhase = phase } = {}, dt = 1 / 60) {
    this.music.update(musicPhase);
    if (!this.context || this.context.state !== 'running' || this._disposed) return;
    const active = ['racing', 'race', 'running', 'playing', 'active'].includes(phase);
    if (!active || globalThis.document?.hidden) {
      this._fadeEngine();
      return;
    }
    const time = this.context.currentTime;
    const pace = clamp(Math.abs(Number(speed) || 0) / 58, 0, 1.35);
    const pedal = clamp(Number(throttle) || 0, 0, 1);
    const sliding = clamp(Number(drift) || 0, 0, 1);
    const boosted = clamp(Number(boost) || 0, 0, 1);
    // Smooth small rev changes while retaining a subtle stepped chiptune timbre.
    const frequency = 52 + pace * 102 + pedal * 9 + boosted * 20;
    const smoothing = clamp(Number(dt) || 1 / 60, 0.008, 0.10) + 0.055;
    this.engineLow.frequency.setTargetAtTime(frequency, time, smoothing);
    this.engineBody.frequency.setTargetAtTime(frequency * 2.006, time, smoothing);
    this.enginePixel.frequency.setTargetAtTime(frequency * 4, time, smoothing);
    this.engineFilter.frequency.setTargetAtTime(650 + pace * 1650 + boosted * 600, time, 0.1);
    this.engineGain.gain.setTargetAtTime(0.040 + Math.min(pace, 1) * 0.067 + pedal * 0.014, time, 0.06);
    this.driftFilter.frequency.setTargetAtTime(1050 + pace * 1150, time, 0.08);
    this.driftGain.gain.setTargetAtTime(sliding * Math.min(pace * 1.5, 1) * 0.13, time, 0.055);
  }

  /** e: { type, count? } or a type string. Returns whether a sound was scheduled. */
  event(e) {
    if (!this.context || this.context.state !== 'running' || this.muted || this._disposed || globalThis.document?.hidden) return false;
    const event = typeof e === 'string' ? { type: e } : (e || {});
    const type = event.type;
    const time = this.context.currentTime;
    const cooldown = { collision: 0.22, pickup: 0.055, countdown: 0.25, boost: 0.16, driftBoost: 0.16, item: 0.08, lap: 0.5, finish: 2, go: 0.5, 'robot-warning': 1, 'robot-strike': .3, 'robot-hit': .3, 'shield-block': .3, 'robot-missile-launch': .12, 'robot-missile-impact': .12, 'kart-crash': .2, 'kart-respawn': .2 }[type];
    if (cooldown === undefined) return false;
    if (time - (this._lastEvents.get(type) ?? -Infinity) < cooldown) return false;
    this._lastEvents.set(type, time);

    switch (type) {
      case 'kart-crash':
        this._tone(130, .42, {to: 32, level: .16});
        this._noise(.36, .18, 650);
        this._tone(720, .24, {delay: .05, to: 180, level: .045, type: 'square'});
        this._noise(.12, .07, 2300);
        break;
      case 'kart-respawn':
        this._sequence([440, 660, 880], .07, .16, .06);
        break;
      case 'robot-missile-launch':
        this._tone(480, .23, {to: 920, level: .045, type: 'square'});
        this._noise(.25, .07, 1800);
        break;
      case 'robot-missile-impact':
        this._tone(110, .30, {to: 36, level: .13});
        this._noise(.24, .15, 670);
        break;
      case 'robot-warning':
        this._tone(220, .24, { to: 440, level: .08, type: 'square' });
        this._tone(330, .25, { delay: .32, to: 660, level: .065, type: 'square' });
        break;
      case 'robot-strike':
        this._tone(140, .38, { to: 44, level: .17 });
        this._tone(370, .16, { to: 96, level: .055, type: 'square' });
        this._noise(.32, .18, 430);
        break;
      case 'robot-hit':
        this._noise(.16, .12, 1000);
        this._tone(260, .22, { to: 120, level: .08, type: 'square' });
        break;
      case 'shield-block':
        this._sequence([440, 880, 1320], .06, .17, .06);
        break;
      case 'countdown': {
        const count = Number(event.count ?? event.value ?? event.remaining ?? 3);
        this._tone(count <= 1 ? 660 : 523.25, 0.13, { level: 0.105, type: 'square' });
        break;
      }
      case 'go':
        this._sequence([523.25, 659.25, 783.99, 1046.50], 0.065, 0.16, 0.115);
        break;
      case 'pickup':
        this._sequence([987.77, 1318.51, 1567.98], 0.045, 0.12, 0.064);
        break;
      case 'item':
        this._sequence([523.25, 783.99, 1046.50], 0.048, 0.15, 0.079);
        break;
      case 'boost':
        this._tone(170, 0.32, { to: 510, level: 0.09, type: 'triangle' });
        this._tone(510, 0.19, { delay: 0.08, to: 1020, level: 0.027, type: 'square' });
        this._noise(0.22, 0.065, 1450);
        break;
      case 'driftBoost':
        this._sequence([659.25, 987.77, 1318.51], 0.06, 0.17, 0.076);
        this._tone(180, 0.28, { to: 460, level: 0.065 });
        break;
      case 'granny-hit':
        this._tone(320,.19,{to:145,level:.08,type:'triangle'});this._tone(480,.14,{delay:.12,to:240,level:.055});
        break;
      case 'granny-clear':
        this._sequence([440,660],.055,.10,.04);
        break;
      case 'kong-warning':
        this._noise(.42,.12,240);this._tone(78,.44,{to:46,level:.09,type:'sawtooth'});
        break;
      case 'kong-grab':
        this._noise(.16,.13,500);this._tone(100,.3,{to:44,level:.09});
        break;
      case 'collision':
        this._noise(0.12, 0.10, 720);
        this._tone(150, 0.12, { to: 72, level: 0.065, type: 'triangle' });
        break;
      case 'lap':
        this._sequence([659.25, 783.99, 1046.50, 1318.51], 0.10, 0.22, 0.08);
        break;
      case 'finish':
        this._fadeEngine();
        // One short victory sting; never loops and never becomes background music.
        this._sequence([523.25, 659.25, 783.99, 1046.50, 783.99, 1046.50, 1318.51], 0.15, 0.23, 0.085);
        this._tone(523.25, 0.58, { delay: 1.05, level: 0.055 });
        this._tone(783.99, 0.58, { delay: 1.05, level: 0.038 });
        this._tone(1046.50, 0.58, { delay: 1.05, level: 0.037 });
        break;
    }
    return true;
  }

  _sequence(notes, interval, duration, level) {
    notes.forEach((frequency, index) => this._tone(frequency, duration, { delay: index * interval, level, type: 'square' }));
  }

  _tone(frequency, duration, { delay = 0, level = 0.08, type = 'triangle', to = null } = {}) {
    if (this._voices.size >= 36) return;
    const c = this.context;
    const start = c.currentTime + delay;
    const oscillator = c.createOscillator();
    const envelope = c.createGain();
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3900;
    filter.Q.value = 0.35;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (to) oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(level, start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(filter);
    filter.connect(this.master);
    this._trackVoice(oscillator, [envelope, filter]);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  _noise(duration, level, frequency) {
    if (this._voices.size >= 36) return;
    const c = this.context;
    const start = c.currentTime;
    const noise = c.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 0.8;
    const envelope = c.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(level, start + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    noise.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master);
    this._trackVoice(noise, [filter, envelope]);
    noise.start(start);
    noise.stop(start + duration + 0.025);
  }

  _trackVoice(source, nodes) {
    this._voices.add(source);
    source.onended = () => {
      this._voices.delete(source);
      source.disconnect();
      nodes.forEach((node) => node.disconnect());
    };
  }

  /** Optional cleanup when leaving the application. */
  async dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.music.dispose();
    if (this._visibilityHandler) globalThis.document?.removeEventListener('visibilitychange', this._visibilityHandler);
    for (const source of [...this._continuous, ...this._voices]) {
      try { source.stop(); } catch { /* Already ended. */ }
      source.disconnect();
    }
    this._voices.clear();
    this._continuous.length = 0;
    if (this.context && this.context.state !== 'closed') await this.context.close();
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
