import * as THREE from 'three';
import {CRASH, crashPose} from './kart-crash.js';

const clamp = THREE.MathUtils.clamp, TAU = Math.PI * 2;
const random = n => {const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x);};

/** Reuses the kart's actual wheels; pooled particles follow authoritative race time. */
export function createKartCrashVisual(scene, track) {
  const group = new THREE.Group(); group.name = '追尾撞飞 · 车体碎片与轮胎'; scene.add(group);
  const box = new THREE.BoxGeometry(1, 1, 1), dummy = new THREE.Object3D(), color = new THREE.Color();
  const createPool = (name, material, count) => {
    const mesh = new THREE.InstancedMesh(box, material, count); mesh.name = name;
    mesh.frustumCulled = false; mesh.count = 0; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.setColorAt(0, color.setHex(0xffffff)); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage); group.add(mesh); return mesh;
  };
  const debris = createPool('车漆与金属碎片', new THREE.MeshStandardMaterial({roughness: .67, metalness: .2}), 256);
  debris.castShadow = true; debris.receiveShadow = true;
  const fire = createPool('橙黄像素火焰', new THREE.MeshBasicMaterial({color: 0xffffff, toneMapped: false}), 320);
  const smoke = createPool('方块烟尘', new THREE.MeshStandardMaterial({roughness: 1, transparent: true, opacity: .63, depthWrite: false}), 176);
  const sparks = createPool('撞击火星与复位光点', new THREE.MeshBasicMaterial({color: 0xffd6a0, toneMapped: false}), 320);
  const slots = new Map(), pose = {}, launch = {};
  const stats = {crashes: 0, burning:0, wheels: 0, debris: 0, flames: 0};
  function setBurning(slot,burning){
    if(slot.burning===burning)return;slot.burning=burning;
    if(burning&&!slot.charred){
      const cache=new Map();slot.charred=[];slot.kart.traverse(o=>{if(!o.isMesh)return;const base=o.material;
        const materials=(Array.isArray(base)?base:[base]).map(material=>{
          if(!cache.has(material)){const ash=material.clone();ash.color?.lerp(new THREE.Color(0x17191c),.90);if(ash.emissive)ash.emissive.setHex(0);if('emissiveIntensity'in ash)ash.emissiveIntensity=0;if('roughness'in ash)ash.roughness=.95;if('metalness'in ash)ash.metalness=.06;cache.set(material,ash);}return cache.get(material);
        });slot.charred.push({mesh:o,base,ash:Array.isArray(base)?materials:materials[0]});
      });slot.ashMaterials=[...cache.values()];
    }
    for(const part of slot.charred||[])part.mesh.material=burning?part.ash:part.base;
  }
  function put(mesh, index, x, y, z, sx, sy, sz, seed, hex) {
    dummy.position.set(x, track.y + .009 + y, z); dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(seed * 1.3, seed * .71, seed * .47); dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
    if (hex !== undefined) {color.set(hex); mesh.setColorAt(index, color);}
  }
  function slotFor(v, kart) {
    const previous=slots.get(v.id);
    if(previous?.kart===kart)return previous;
    if(previous){setBurning(previous,false);for(const material of previous.ashMaterials||[])material.dispose();for(const wheel of previous.wheels)group.remove(wheel);group.remove(previous.ring);previous.ring.geometry.dispose();previous.ring.material.dispose();slots.delete(v.id);}
    const wheels = kart.userData.wheels.map(wheel => {
      const copy = wheel.clone(true); copy.name = '脱落轮胎'; copy.visible = false; group.add(copy); return copy;
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.67, 16), new THREE.MeshBasicMaterial({color: 0x9af5ed, transparent: true, opacity: .7, side: THREE.DoubleSide, depthWrite: false, toneMapped: false}));
    ring.rotation.x = -Math.PI / 2; ring.visible = false; group.add(ring);
    const slot = {kart,wheels, ring, scale: kart.scale.x}; slots.set(v.id, slot); return slot;
  }
  function update(state, karts) {
    const time = state.renderTime ?? state.elapsed ?? 0;
    let di = 0, fi = 0, si = 0, pi = 0; stats.crashes = stats.burning = stats.wheels = 0;
    for (const slot of slots.values()) {slot.ring.visible = false; for (const w of slot.wheels) w.visible = false;}
    for (const v of state.vehicles) {
      const kart = karts[v.id]; if (!kart) continue;
      const slot = slotFor(v, kart), u = kart.userData;
      kart.rotation.set(0, v.heading + (v.drift ? v.steering * .10 : 0), 0); kart.scale.setScalar(slot.scale);
      for (const w of u.wheels) w.visible = true;
      const c = v.crash;
      setBurning(slot,c?.mode==='burn');if(slot.burning)stats.burning++;
      if (!c) {
        if (v.respawnProtection > 0 && !['menu', 'countdown', 'finished'].includes(state.phase)) {
          slot.ring.visible = true; slot.ring.position.set(v.x, track.y + .07, v.z);
          slot.ring.material.opacity = .35 + .3 * Math.sin(time * 14) ** 2;
          slot.ring.scale.setScalar(1 + .04 * Math.sin(time * 11));
          for (let j = 0; j < 12; j++) {
            const a = j / 12 * TAU + time * 1.2, y = ((time * 1.3 + j / 12) % 1) * 1.7;
            put(sparks, pi++, v.x + Math.cos(a) * 1.2, y, v.z + Math.sin(a) * 1.2, .09, .12, .09, j, 0xa5fff1);
          }
        }
        continue;
      }
      crashPose(c, time, pose); const age = pose.flightAge;
      const fade = clamp((CRASH.seconds - age) / .2, 0, 1), seed = c.id * 41 + v.id * 17;
      stats.crashes++;
      kart.position.set(pose.x, track.y + .009 + pose.y, pose.z);
      kart.rotation.set(pose.pitch, pose.heading, pose.roll); kart.scale.setScalar(slot.scale * fade);
      u.exhaust.visible = false;
      if(pose.held)continue;
      for (const w of u.wheels) w.visible = age < .12;
      crashPose(c, c.at + (c.grabDuration||0) + .12, launch);
      const cs = Math.cos(c.heading), sn = Math.sin(c.heading);
      // Four separate original voxel tires, each with a different trajectory and spin.
      for (let j = 0; j < 4 && age >= .12; j++) {
        const wheel = slot.wheels[j], t = age - .12, side = j % 2 ? 1 : -1, mount=u.wheelMounts?.[j], front=mount?.z??(j < 2 ? -.73 : .76), lateralMount=mount?.x??side*.72;
        const lateral = side * (3.3 + random(seed + j) * 2) + c.side * 2.3, forward = 1.7 + (j < 2 ? -1.8 : 2.7);
        const y = launch.y + .45 + (3.3 + random(seed + j + 8) * 2) * t - 7 * t * t;
        wheel.visible = true; wheel.position.set(launch.x + cs * lateralMount + sn * front + (cs * lateral + sn * forward) * t,
          track.y + Math.max(u.wheelRadius+.04, y), launch.z - sn * lateralMount + cs * front + (-sn * lateral + cs * forward) * t);
        wheel.rotation.set(t * (11 + j * 2), c.heading + side * t * 5, side * t * 7);
        wheel.scale.setScalar(slot.scale * fade); stats.wheels++;
      }
      for (let j = 0; j < 32; j++) {
        const a = j * 2.39996 + seed, r = 2.5 + random(seed + j * 3) * 5.5;
        const y = .65 + (3 + random(seed + j * 7) * 7) * age - 7.8 * age * age;
        const size = (.10 + random(seed + j * 2) * .22) * fade;
        put(debris, di++, (c.releaseX??c.x) + (Math.cos(a) * r + c.fx * 2) * age, Math.max(.08, y+(c.releaseY||0)*(1-clamp(age,0,1))), (c.releaseZ??c.z) + (Math.sin(a) * r + c.fz * 2) * age,
          size * (j % 3 ? 1 : 2.7), size * (j % 3 ? 1 : .35), size, j + age * 12, j % 4 === 0 ? 0xc2c9c6 : j % 4 === 1 ? 0x263239 : v.color);
      }
      // Emitter history attaches the fire trail to the tumbling wreck.
      for (let j = 0; j < 40; j++) {
        const life = (time * 2.5 + j / 40) % 1, past = life * .38;
        if (age < past) continue;
        crashPose(c, time - past, launch);
        const a = j * 2.39996, r = .3 + random(seed + j) * .5, size = (.18 + (1 - life) * .5) * fade;
        put(fire, fi++, launch.x + Math.cos(a) * r, launch.y + .5 + life * 1.7, launch.z + Math.sin(a) * r,
          size * .75, size * (1.4 + random(j) * .5), size * .75, Math.floor(time * 12) + j, life < .3 ? 0xfff0a0 : life < .65 ? 0xffb125 : 0xf25b1e);
      }
      for (let j = 0; j < 22; j++) {
        const life = (time * 1.1 + j / 22) % 1, past = life * .65;
        if (age < past) continue;
        crashPose(c, time - past, launch);
        const size = (.25 + life * .65) * fade, a = j * 2.39996;
        put(smoke, si++, launch.x + Math.cos(a) * life * 1.3, launch.y + 1 + life * 3, launch.z + Math.sin(a) * life * 1.3,
          size, size, size, j + life, j % 3 ? 0x424851 : 0x777971);
      }
      if (age < .55) for (let j = 0; j < 24; j++) {
        const a = j * 2.39996, radius = age * (4 + j % 5), size = .10 * (1 - age / .55);
        put(sparks, pi++, c.x + Math.cos(a) * radius, .4 + Math.sin(age / .55 * Math.PI) * (1 + j % 4), c.z + Math.sin(a) * radius,
          size, size, size * 3, a, 0xffdda0);
      }
    }
    for (const [mesh, count] of [[debris, di], [fire, fi], [smoke, si], [sparks, pi]]) {
      mesh.count = count; mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    Object.assign(stats, {debris: di, flames: fi}); return stats;
  }
  return {group, update, stats};
}
