/** Slow, hysteretic resolution changes; isolated stalls never lower quality. */
export class AdaptiveResolution {
  constructor(onChange = () => {}) {this.onChange = onChange; this.scale = 1; this.enabled = true; this.reset();}
  reset() {this.samples = []; this.windowMs = 0; this.goodMs = 0; this.cooldownMs = 0;}
  setEnabled(enabled) {
    if (this.enabled === !!enabled) return;
    this.enabled = !!enabled; this.reset();
    if (!this.enabled && this.scale !== 1) {this.scale = 1; this.onChange(this.scale);}
  }
  sample(ms, active) {
    if (!this.enabled || !active || !Number.isFinite(ms) || ms <= 0 || ms > 250) {this.samples.length = 0; this.windowMs = 0; this.goodMs = 0; return;}
    this.cooldownMs = Math.max(0, this.cooldownMs - ms);
    this.samples.push(ms); this.windowMs += ms;
    if (this.windowMs < 1800) return;
    const samples = this.samples.sort((a, b) => a - b), p50 = samples[Math.floor(samples.length * .50)], p90 = samples[Math.floor(samples.length * .90)];
    const elapsed = this.windowMs; this.samples = []; this.windowMs = 0;
    if (p50 > 20 && p90 > 23) {
      this.goodMs = 0;
      if (!this.cooldownMs && this.scale > .62) {this.scale = Math.max(.62, Math.round((this.scale - .10) * 100) / 100); this.cooldownMs = 1800; this.onChange(this.scale);}
    } else if (p90 < 17.8) {
      this.goodMs += elapsed;
      if (this.goodMs > 9000 && !this.cooldownMs && this.scale < 1) {this.scale = Math.min(1, Math.round((this.scale + .05) * 100) / 100); this.goodMs = 0; this.cooldownMs = 5000; this.onChange(this.scale);}
    } else this.goodMs = 0;
  }
}
