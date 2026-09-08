import {kongHandPose} from './kong-motion.js';
/** Shared, deterministic crash rules and poses for solo, server and rendering. */
export const CRASH = Object.freeze({minSpeed: 27, minClosingSpeed: 8, seconds: 1.5, protection: 1.5, flight: .95});
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export function isRearImpact(attacker, target) {
  if (attacker.crash || target.crash || attacker.grannyBlock || target.grannyBlock || attacker.respawnProtection > 0 || target.respawnProtection > 0 ||
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
  const age = clamp(time - crash.at, 0, crash.duration||CRASH.seconds), grab=crash.grabDuration||0;
  out.age=age;out.flightAge=Math.max(0,age-grab);out.held=age<grab;
  if(out.held){
    kongHandPose(crash.holdOrigin,age/grab,out);const blend=clamp(age/.16,0,1);
    out.x=crash.x+(out.x-crash.x)*blend;out.z=crash.z+(out.z-crash.z)*blend;out.y*=blend;
    out.pitch=-.2*(age/grab);out.roll=crash.side*.12;out.heading=crash.heading;return out;
  }
  const u = clamp(out.flightAge / CRASH.flight, 0, 1);
  const travel = 1 - (1 - u) ** 2;
  const startX=crash.releaseX??crash.x,startZ=crash.releaseZ??crash.z;
  out.x = startX + (crash.endX - startX) * travel;
  out.z = startZ + (crash.endZ - startZ) * travel;
  out.y = (crash.releaseY||0)*(1-u)+Math.sin(Math.PI * u) * 4.4 + u * .8;
  out.pitch = -u * Math.PI * 1.25;
  out.roll = crash.side * u * Math.PI * 2.7;
  out.heading = crash.heading + crash.side * u * 1.3;
  return out;
}
