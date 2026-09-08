import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {BARRAGE, missilePosition} from './robot-barrage.js';

const UP = new THREE.Vector3(0, 1, 0), TAU = Math.PI * 2;
function blocks(parts) {
  const geometries = parts.map(([x, y, z, w, h, d, hex = 0xffffff]) => {
    const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z);
    const c = new THREE.Color(hex), colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); return g;
  });
  const merged = mergeGeometries(geometries, false); geometries.forEach(g => g.dispose()); return merged;
}
const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({color, transparent: true, opacity, depthWrite: false, toneMapped: false});

/** Four reusable visual slots; the simulation supplies every landing position. */
export function createRobotMissiles() {
  const group = new THREE.Group(); group.name = 'SG-01 · 四联追击导弹';
  const bodyGeometry = blocks([
    [0, 0, 0, .56, 1.65, .56, 0xdce6df], [0, .86, 0, .43, .35, .43, 0xf09256],
    [0, 1.12, 0, .23, .2, .23, 0xffb75e], [0, -.45, 0, .60, .26, .60, 0x344d58],
    [0, -.95, 0, .35, .25, .35, 0x223641], [0, -.67, 0, 1.16, .50, .16, 0x568998],
    [0, -.67, 0, .16, .50, 1.16, 0x568998], [0, .20, .30, .20, .55, .055, 0xc45f39],
  ]);
  const bodyMaterial = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .35, metalness: .38});
  const box = new THREE.BoxGeometry(1, 1, 1), flameMaterial = glow(0xffcc74);
  const ringParts = [];
  for (let i = 0; i < 48; i++) {
    const a = i / 48 * TAU;
    ringParts.push([Math.round(Math.cos(a) * 13) / 13, 0, Math.round(Math.sin(a) * 13) / 13, .09, .035, .09]);
  }
  const ringGeometry = blocks(ringParts), crossParts = [[0, 0, 0, .80, .045, .12], [0, 0, 0, .12, .045, .80]];
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    crossParts.push([x * .83, 0, z, .35, .045, .085], [x, 0, z * .83, .085, .045, .35]);
  }
  const crossGeometry = blocks(crossParts);
  const slots = Array.from({length: BARRAGE.count}, (_, i) => {
    const rocket = new THREE.Group(); rocket.name = `追击导弹 ${i + 1}`;
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial); rocket.add(body);
    const flame = new THREE.Mesh(box, flameMaterial); flame.position.y = -1.3; flame.scale.set(.33, .75, .33); rocket.add(flame); group.add(rocket);
    const marker = new THREE.Group(); marker.name = `道路落点准心 ${i + 1}`; group.add(marker);
    const markerMaterial = glow(0xff593b), timerMaterial = glow(0xffd580);
    const cross = new THREE.Mesh(crossGeometry, markerMaterial), ring = new THREE.Mesh(ringGeometry, markerMaterial);
    const timer = new THREE.Mesh(ringGeometry, timerMaterial); timer.position.y = .014;
    marker.add(cross, ring, timer);
    const shockMaterial = glow(0xffd485), shock = new THREE.Mesh(ringGeometry, shockMaterial); group.add(shock);
    return {rocket, flame, marker, timer, markerMaterial, timerMaterial, shock, shockMaterial};
  });
  const smoke = new THREE.InstancedMesh(box, glow(0xd9c9af, .55), 48); smoke.name = '导弹像素尾迹'; smoke.frustumCulled = false;
  smoke.setColorAt(0, new THREE.Color(0xffffff)); smoke.instanceColor.setUsage(THREE.DynamicDrawUsage);
  smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(smoke);
  const point = new THREE.Vector3(), next = new THREE.Vector3(), direction = new THREE.Vector3(), dummy = new THREE.Object3D(), color = new THREE.Color();
  function update(state, position) {
    // This group is under the translated robot; trajectories remain in world space.
    group.position.set(-position.x, -(position.y || 0), -position.z);
    const time = state?.renderTime ?? state?.time ?? 0, missiles = state?.missiles || [];
    let smokeCount = 0;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i], m = missiles[i];
      slot.rocket.visible = slot.marker.visible = slot.shock.visible = false;
      if (!m) continue;
      const remaining = m.impactAt - time, flight = m.impactAt - m.launchAt;
      slot.marker.visible = remaining > 0;
      slot.marker.position.set(m.aim.x, m.aim.y + .10, m.aim.z); slot.marker.scale.set(m.radius, 1, m.radius);
      slot.markerMaterial.opacity = .73 + .27 * Math.sin(time * (remaining < .7 ? 24 : 12)) ** 2;
      slot.timer.scale.setScalar(THREE.MathUtils.clamp(remaining / flight, .08, 1));
      slot.timerMaterial.color.setHex(remaining < .65 ? 0xfff1ba : 0xffc16c);
      slot.rocket.visible = time >= m.launchAt && remaining > 0;
      if (slot.rocket.visible) {
        missilePosition(m, time, point); missilePosition(m, time + .003, next);
        slot.rocket.position.copy(point); direction.subVectors(next, point).normalize();
        slot.rocket.quaternion.setFromUnitVectors(UP, direction);
        slot.flame.scale.y = .8 + Math.sin(time * 50 + i) * .22;
      }
      for (let j = 0; j < 12; j++) {
        const trailTime = time - (j + 1) * .055;
        if (trailTime < m.launchAt || trailTime >= m.impactAt) continue;
        missilePosition(m, trailTime, point);
        dummy.position.copy(point); dummy.position.x += Math.sin(j * 7 + i) * j * .018;
        dummy.position.z += Math.cos(j * 5 + i) * j * .018;
        dummy.rotation.set(j, i + j * .7, j * .3); dummy.scale.setScalar(.27 + j * .035); dummy.updateMatrix();
        smoke.setMatrixAt(smokeCount, dummy.matrix); color.setHex(j < 3 ? 0xffc67a : 0xd6d5c8); smoke.setColorAt(smokeCount++, color);
      }
      const aftermath = (time - m.impactAt) / BARRAGE.aftermath;
      slot.shock.visible = aftermath >= 0 && aftermath < 1;
      if (slot.shock.visible) {
        slot.shock.position.set(m.aim.x, m.aim.y + .13, m.aim.z);
        slot.shock.scale.setScalar(m.radius * (.3 + aftermath * 1.6)); slot.shock.scale.y = 1;
        slot.shockMaterial.opacity = 1 - aftermath;
      }
    }
    smoke.count = smokeCount; smoke.instanceMatrix.needsUpdate = true; if (smoke.instanceColor) smoke.instanceColor.needsUpdate = true;
    group.userData.round = state?.round || 0; group.userData.targetId = state?.targetId ?? null;
    group.userData.crosshairs = slots.filter(s => s.marker.visible).length; group.userData.flying = slots.filter(s => s.rocket.visible).length;
  }
  return {group, update};
}
