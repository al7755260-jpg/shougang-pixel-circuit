export const BARRAGE = Object.freeze({ interval: 15, count: 4, flight: 2.6, stagger: .16, radius: 1.3, aftermath: .65 });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = t => ((t % 1) + 1) % 1;

/** Server-owned targets, clocks and hits; independent of the close-range fists. */
export class RobotBarrage {
  constructor({track, position, kartRadius, onEvent, onHit}) {
    Object.assign(this, {track, position, kartRadius, onEvent, onHit});
    this.state = {time: 0, round: 0, nextRoundAt: BARRAGE.interval, targetId: null, missiles: []};
  }

  update(dt, vehicles) {
    const s = this.state;
    s.time += dt;
    if (s.time + 1e-9 >= s.nextRoundAt) {
      const scheduledAt = s.nextRoundAt;
      s.nextRoundAt += BARRAGE.interval;
      const leader = vehicles.filter(v => !v.finished && !v.dnf && !v.crash && Number.isFinite(v.x) && Number.isFinite(v.z))
        .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || (b.totalProgress ?? 0) - (a.totalProgress ?? 0) || a.id - b.id)[0];
      if (leader) this._launch(leader, scheduledAt);
    }
    for (const missile of s.missiles) {
      if (!missile.launched && s.time + 1e-9 >= missile.launchAt) {
        missile.launched = true;
        this._event('robot-missile-launch', missile);
      }
      if (!missile.impacted && s.time + 1e-9 >= missile.impactAt) {
        missile.impacted = true;
        this._event('robot-missile-impact', missile);
        // Instantaneous blast: one hit per missile per car, never during warning.
        for (const v of vehicles) {
          if (v.finished || v.dnf || v.crash || v.respawnProtection > 0 || !Number.isFinite(v.x) || !Number.isFinite(v.z)) continue;
          if (Math.hypot(v.x - missile.aim.x, v.z - missile.aim.z) <= missile.radius + this.kartRadius) this.onHit(v, missile);
        }
      }
    }
    s.missiles = s.missiles.filter(m => s.time < m.impactAt + BARRAGE.aftermath);
    return s;
  }

  _launch(target, startAt) {
    const s = this.state, near = this.track.closest(target.x, target.z), tangent = this.track.getTangent(near.t);
    s.round++; s.targetId = target.id;
    const vx = Number.isFinite(target._vx) ? target._vx : Math.sin(target.heading || 0) * (target.speed || 0);
    const vz = Number.isFinite(target._vz) ? target._vz : Math.cos(target.heading || 0) * (target.speed || 0);
    const speed = clamp(vx * tangent.x + vz * tangent.z, 0, 50);
    const side = Math.abs(near.signedDistance) > .4 ? Math.sign(near.signedDistance) : (s.round % 2 ? 1 : -1);
    const width = this.track.width || 10, radius = Math.min(BARRAGE.radius, width * .15);
    const lane = side * Math.min(clamp(Math.abs(near.signedDistance), 1.75, 2.3), width / 2 - radius - .15);
    s.missiles = Array.from({length: BARRAGE.count}, (_, i) => {
      // Spread forward along the road, including corners; leave the opposite lane open.
      const distance = Math.max(8, speed * BARRAGE.flight - 7.5) + i * (5 + speed * BARRAGE.stagger);
      const t = wrap(near.t + distance / this.track.length), p = this.track.getPoint(t), d = this.track.getTangent(t);
      const length = Math.hypot(d.x, d.z) || 1;
      const aim = Object.freeze({x: p.x + d.z / length * lane, y: p.y ?? this.track.y ?? 0, z: p.z - d.x / length * lane});
      const launchAt = startAt + i * BARRAGE.stagger;
      return {attackId: `missile-${s.round}-${i + 1}`, kind: 'missile', round: s.round, index: i,
        targetId: target.id, aim, radius, trackT: t, launchAt, impactAt: launchAt + BARRAGE.flight,
        origin: {x: this.position.x + (i % 2 ? 6.2 : -6.2), y: this.position.y + 26.3, z: this.position.z - 1.2},
        launched: false, impacted: false};
    });
  }

  _event(type, m) {
    this.onEvent(type, {attackId: m.attackId, kind: m.kind, round: m.round, index: m.index, targetId: m.targetId,
      aim: {...m.aim}, origin: {...m.origin}, radius: m.radius, launchAt: m.launchAt, impactAt: m.impactAt});
  }
}

/** Analytic flight shared by the missile and its pixel smoke trail. World coordinates. */
export function missilePosition(missile, time, out = {}) {
  const t = clamp((time - missile.launchAt) / (missile.impactAt - missile.launchAt), 0, 1);
  const a = missile.origin, b = missile.aim, height = 26 + Math.hypot(b.x - a.x, b.z - a.z) * .16;
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t + 4 * height * t * (1 - t);
  out.z = a.z + (b.z - a.z) * t;
  return out;
}
