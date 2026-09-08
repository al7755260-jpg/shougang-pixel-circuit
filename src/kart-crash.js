/** Shared, deterministic crash rules and poses for solo, server and rendering. */
export const CRASH = Object.freeze({minSpeed: 27, minClosingSpeed: 8, seconds: 1.5, protection: 1.5, flight: .95});
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export function isRearImpact(attacker, target) {
  if (attacker.crash || target.crash || attacker.respawnProtection > 0 || target.respawnProtection > 0 ||
      attacker.finished || target.finished || attacker.dnf || target.dnf || attacker._ramCooldown > 0 || attacker.stun > 0) return false;
  const dx = target.x - attacker.x, dz = target.z - attacker.z, distance = Math.hypot(dx, dz);
  if (distance < .001 || distance >= 2 || attacker.speed < CRASH.minSpeed || target.speed < -.5) return false;
  const fx = Math.sin(target.heading), fz = Math.cos(target.heading);
  const afx = Math.sin(attacker.heading), afz = Math.cos(attacker.heading);
  const forward = dx * fx + dz * fz, lateral = Math.abs(dx * fz - dz * fx);
  const closing = (attacker._vx - target._vx) * fx + (attacker._vz - target._vz) * fz;
  return forward / distance > .72 && lateral < 1.05 && afx * fx + afz * fz > .8 &&
    attacker._vx * fx + attacker._vz * fz >= CRASH.minSpeed && closing >= CRASH.minClosingSpeed;
}

export function crashPose(crash, time, out = {}) {
  const age = clamp(time - crash.at, 0, CRASH.seconds), u = clamp(age / CRASH.flight, 0, 1);
  const travel = 1 - (1 - u) ** 2;
  out.x = crash.x + (crash.endX - crash.x) * travel;
  out.z = crash.z + (crash.endZ - crash.z) * travel;
  out.y = Math.sin(Math.PI * u) * 4.4 + u * .8;
  out.pitch = -u * Math.PI * 1.25;
  out.roll = crash.side * u * Math.PI * 2.7;
  out.heading = crash.heading + crash.side * u * 1.3;
  out.age = age;
  return out;
}
