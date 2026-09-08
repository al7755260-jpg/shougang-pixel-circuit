export const REACTION_SECONDS = 2.6;
export const REACTION_LINES = Object.freeze({
  overtake: [
    {face: '(￣▽￣)✧', text: '先走一步！'},
    {face: '( •̀ᴗ•́ )و', text: '这波稳了！'},
    {face: 'ヾ(≧▽≦)ノ', text: '芜湖～起飞！'},
    {face: '(⌐■_■)', text: '拜拜咯～'},
  ],
  overtaken: [
    {face: '(⊙_⊙;)', text: '欸？！这么快！'},
    {face: '(╬￣皿￣)', text: '给我等着！'},
    {face: '(；▽；)', text: '我的名次啊！'},
    {face: '(ง •̀_•́)ง', text: '马上追回来！'},
  ],
});
const arcGap = (a, b, length) => (((a - b + 1.5) % 1) - .5) * length;

/** Presentation only. Uses the same simulation positions in solo and online races. */
export class RacerReactions {
  constructor(length) { this.length = length; this.reset(); }
  reset() { this.pairs = new Map(); this.previous = new Map(); this.reactions = new Map(); this.suppressed = new Map(); this.time = null; }
  suppress(vehicleId, until) {
    this.suppressed.set(vehicleId, until); this.reactions.delete(vehicleId);
    for (const [key, pair] of this.pairs) if (pair.ids.includes(vehicleId)) this.pairs.delete(key);
  }
  update(state) {
    const time = state.elapsed || 0;
    if (['menu', 'countdown', 'finished'].includes(state.phase) || state.mode === 'practice') { this.reset(); return []; }
    if (state.phase !== 'racing' && !(state.multiplayer && state.phase === 'paused')) return this.active();
    if (this.time !== null && (time < this.time || time - this.time > .75)) this.reset();
    if (time === this.time) return this.active();
    const dt = this.time === null ? 0 : time - this.time; this.time = time;
    const cars = state.vehicles.filter(v => !v.finished && !v.dnf && !v.crash && !(v.respawnProtection > 0) && !v.wrongWay && Number.isFinite(v.progress) && Number.isFinite(v.x) && Number.isFinite(v.z)).sort((a, b) => a.id - b.id);
    const ids = new Set(cars.map(v => v.id));
    for (const [key, pair] of this.pairs) if (pair.ids.some(id => !ids.has(id))) this.pairs.delete(key);
    for (const id of this.reactions.keys()) if (!ids.has(id)) this.reactions.delete(id);
    for (const v of cars) {
      const previous = this.previous.get(v.id);
      if (previous && Math.hypot(v.x - previous.x, v.z - previous.z) > Math.max(8, dt * 65 + 2)) this.suppress(v.id, time + 1);
    }
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j], key = `${a.id}:${b.id}`;
      if ((this.suppressed.get(a.id) || 0) > time || (this.suppressed.get(b.id) || 0) > time) { this.pairs.delete(key); continue; }
      const gap = arcGap(a.progress, b.progress, this.length), order = Math.abs(gap) > .75 ? Math.sign(gap) : 0;
      let pair = this.pairs.get(key);
      if (!pair) { this.pairs.set(key, {ids: [a.id, b.id], order, pending: 0, since: time, last: -Infinity, count: 0}); continue; }
      // The half-lap wrap changes sign too, but it is never a nearby overtake.
      if (Math.hypot(a.x - b.x, a.z - b.z) > 16) { pair.order = order; pair.pending = 0; continue; }
      if (!pair.order) { pair.order = order; continue; }
      if (!order || order === pair.order) { pair.pending = 0; continue; }
      if (pair.pending !== order) { pair.pending = order; pair.since = time; continue; }
      if (time - pair.since < .12) continue;
      pair.order = order; pair.pending = 0;
      const winner = order > 0 ? a : b, loser = order > 0 ? b : a;
      if (time < .6 || time - pair.last < .85 || winner.speed < 1 || loser.speed < -.5) continue;
      pair.last = time; pair.count++;
      const variant = (a.id * 7 + b.id * 3 + pair.count - 1) % 4;
      for (const [v, other, kind] of [[winner, loser, 'overtake'], [loser, winner, 'overtaken']]) {
        this.reactions.set(v.id, {vehicleId: v.id, againstId: other.id, kind, variant, at: time, ...REACTION_LINES[kind][variant]});
      }
    }
    this.previous = new Map(cars.map(v => [v.id, {x: v.x, z: v.z}]));
    return this.active();
  }
  active() {
    for (const [id, r] of this.reactions) if ((this.time ?? 0) - r.at >= REACTION_SECONDS) this.reactions.delete(id);
    return [...this.reactions.values()];
  }
}

/** Place nearby speech balloons in separate rows, retaining a tail to each car. */
export function layoutReactions(anchors, width, height, obstacles = []) {
  const placed = [], margin = 8;
  for (const a of [...anchors].sort((a, b) => b.y - a.y || a.id - b.id)) {
    let best = null, score = Infinity;
    for (const offset of [0, -a.width - 8, a.width + 8]) {
      const x = Math.max(a.width / 2 + margin, Math.min(width - a.width / 2 - margin, a.x + offset));
      let bottom = Math.min(height - margin, Math.max(a.height + margin, a.y));
      for (let attempt = 0; attempt < placed.length + obstacles.length + 1; attempt++) {
        const hit = [...placed, ...obstacles].find(b => x - a.width / 2 < b.x + b.width / 2 + 6 && x + a.width / 2 > b.x - b.width / 2 - 6 && bottom > b.bottom - b.height - 6 && bottom - a.height < b.bottom + 6);
        if (!hit) break;
        bottom = hit.bottom - hit.height - 8;
      }
      const cost = (x - a.x) ** 2 + (bottom - a.y) ** 2;
      if (bottom - a.height >= margin && cost < score) { score = cost; best = {...a, x, bottom}; }
    }
    // Very crowded/offscreen cars can wait for space instead of covering the whole sky.
    if (best) placed.push(best);
  }
  return placed;
}
