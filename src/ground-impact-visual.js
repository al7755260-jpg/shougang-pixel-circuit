import * as THREE from 'three';
import {CRATERS,craterScale} from './impact-craters.js';

const CELL=CRATERS.cell,MAX_CRATERS=CRATERS.max,LIFETIME=CRATERS.lifetime,GRAVITY=18;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
function randomFor(key) {
  let seed = 2166136261;
  for (const c of String(key)) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}
// Write one final buffer directly. Hundreds of temporary BoxGeometry objects
// and merge copies previously caused allocation/GC bursts on each impact.
const unitBox = new THREE.BoxGeometry(1, 1, 1), linearColors = new Map();
function coloredBox(parts, x, y, z, w, h, d, hex) {
  let color = linearColors.get(hex); if (!color) {color = new THREE.Color(hex); linearColors.set(hex, color);}
  const vertex = parts.count * 24, offset = vertex * 3, p = unitBox.attributes.position.array;
  for (let i = 0; i < 72; i += 3) {
    parts.positions[offset + i] = p[i] * w + x; parts.positions[offset + i + 1] = p[i + 1] * h + y; parts.positions[offset + i + 2] = p[i + 2] * d + z;
    parts.colors[offset + i] = color.r; parts.colors[offset + i + 1] = color.g; parts.colors[offset + i + 2] = color.b;
  }
  parts.normals.set(unitBox.attributes.normal.array, offset);
  for (let i = 0; i < 36; i++) parts.indices[parts.count * 36 + i] = unitBox.index.array[i] + vertex;
  parts.count++;
}

/** Pixel pits cut the visible asphalt with the authoritative hazard footprint.
 * One deterministic seed per attack keeps fragments identical for every client.
 */
export function createGroundImpactVisual(scene, road, track) {
  const group = new THREE.Group(); group.name = '攻击落地 · 体素弹坑与路面碎片'; scene.add(group);
  const dummy = new THREE.Object3D(), color = new THREE.Color(), box = new THREE.BoxGeometry(1, 1, 1);
  const solidMaterial = new THREE.MeshStandardMaterial({roughness: .96, metalness: 0});
  const fireMaterial = new THREE.MeshBasicMaterial({toneMapped: false});
  const dustMaterial = new THREE.MeshStandardMaterial({roughness: 1, transparent: true, opacity: .48, depthWrite: false});
  const craterMaterial = new THREE.MeshStandardMaterial({vertexColors: true, roughness: .98, metalness: 0});
  const warmGeometry = box.clone(); warmGeometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(72).fill(1), 3));
  const warmMesh = new THREE.Mesh(warmGeometry, craterMaterial); warmMesh.name = '弹坑材质预热'; warmMesh.receiveShadow = true; warmMesh.visible = false; group.add(warmMesh);
  function pool(name, material, capacity) {
    const mesh = new THREE.InstancedMesh(box, material, capacity); mesh.name = name; mesh.count = 0;
    mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.setColorAt(0, color.setHex(0xffffff)); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage); group.add(mesh); return mesh;
  }
  const debris = pool('沥青块、骨料石屑、破碎板片', solidMaterial, 640);
  debris.receiveShadow = true;
  const embers = pool('爆炸火星与灼热碎粒', fireMaterial, 320);
  const dust = pool('巨锤灰尘与导弹黑烟', dustMaterial, 200);
  const records = [], seen = new Set();
  let previousTime = null, disposed = false;
  const stats = {craters: 0, debris: 0, embers: 0, dust: 0, impacts: []};

  // The pit has an actual stepped floor below the road. Discard only the same
  // grid cells from asphalt and painted crossings, so neither covers the hole.
  const uniforms = {sgPitCount: {value: 0}, sgPits: {value: Array.from({length: MAX_CRATERS}, () => new THREE.Vector4())}};
  const materialHooks = [...new Set([road.userData.surface.material, ...(road.userData.impactMaterials || [])])].map(material => {
  const previousCompile = material.onBeforeCompile, previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = function(shader, renderer) {
    previousCompile.call(this, shader, renderer); Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `varying vec2 vSgPitWorld;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvSgPitWorld=(modelMatrix*vec4(transformed,1.0)).xz;');
    shader.fragmentShader = `varying vec2 vSgPitWorld;\nuniform int sgPitCount;\nuniform vec4 sgPits[${MAX_CRATERS}];\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      for(int i=0;i<${MAX_CRATERS};i++) {
        if(i>=sgPitCount) break;
        vec4 pit=sgPits[i];
        vec2 cell=floor((vSgPitWorld-pit.xy)/max(pit.w,.0001)/${CELL}+.5)*${CELL};
        if(dot(cell,cell)<pit.z*pit.z) discard;
      }`);
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}|voxel-impact-pits-v1`;
  material.needsUpdate = true;
  return {material,previousCompile,previousKey};
  });

  function makeCrater(record) {
    const {radius: r, kind, aim, seed} = record, random = randomFor(seed), depth = kind === 'slam' ? .55 : .38;
    const extent = Math.ceil(r * 1.3 / CELL), base = -depth - .06, capacity = (extent * 2 + 1) ** 2 + 54;
    const parts = {count: 0, positions: new Float32Array(capacity * 72), normals: new Float32Array(capacity * 72), colors: new Float32Array(capacity * 72), indices: new Uint16Array(capacity * 36)};
    for (let ix = -extent; ix <= extent; ix++) for (let iz = -extent; iz <= extent; iz++) {
      const x = ix * CELL, z = iz * CELL, distance = Math.hypot(x, z), q = distance / r;
      if (q < 1) {
        const top = q < .38 ? -depth : q < .66 ? -depth * .70 : q < .86 ? -depth * .38 : -.055;
        const shades = q < .66 ? [0x17191b, 0x232529, 0x302d2a] : [0x4d4a43, 0x68665b, 0x3a3d3d];
        coloredBox(parts, x, (top + base) / 2, z, CELL, top - base, CELL, shades[Math.floor(random() * shades.length)]);
      } else if (q < 1.24 && random() > .33 && track.closest(aim.x + x, aim.z + z).distance < track.width / 2 - .05) {
        const h = .045 + random() * .15;
        coloredBox(parts, x, h / 2, z, CELL * (.85 + random() * .2), h, CELL, random() > .45 ? 0x737269 : 0x404342);
      }
    }
    // Thin branching block cracks and scattered aggregate around the broken rim.
    for (let arm = 0; arm < 9; arm++) {
      const angle = arm * Math.PI * 2 / 9 + random() * .25;
      for (let j = 0; j < 6; j++) {
        const d = r + j * CELL * .65, bend = angle + Math.sin(j * 2 + arm) * .1;
        const x = Math.round(Math.cos(bend) * d / .11) * .11, z = Math.round(Math.sin(bend) * d / .11) * .11;
        if (track.closest(aim.x + x, aim.z + z).distance > track.width / 2 - .08) continue;
        coloredBox(parts, x, .014, z, .13, .012, .13, 0x222525);
      }
    }
    const geometry = new THREE.BufferGeometry();
    for (const [name, array] of [['position', parts.positions], ['normal', parts.normals], ['color', parts.colors]]) geometry.setAttribute(name, new THREE.BufferAttribute(array.subarray(0, parts.count * 72), 3));
    geometry.setIndex(new THREE.BufferAttribute(parts.indices.subarray(0, parts.count * 36), 1));
    const mesh = new THREE.Mesh(geometry, craterMaterial); mesh.name = `${kind === 'slam' ? '巨锤' : '导弹'} · 分层焦黑弹坑 ${record.id}`;
    mesh.position.set(aim.x, aim.y + .008, aim.z); mesh.receiveShadow = true; group.add(mesh); record.mesh = mesh;
    record.particles = [];
    const solidCount = kind === 'slam' ? 64 : 48;
    for (let i = 0; i < solidCount + 26 + 22; i++) {
      const type = i < solidCount ? 'debris' : i < solidCount + 26 ? 'embers' : 'dust';
      const angle = random() * Math.PI * 2, initial = random() * r * .65;
      const velocity = type === 'dust' ? .9 + random() * 2 : 2.2 + random() * (kind === 'slam' ? 5.5 : 7);
      const size = type === 'debris' ? .10 + random() * (kind === 'slam' ? .35 : .23) : type === 'embers' ? .035 + random() * .10 : .35 + random() * .65;
      const palette = type === 'debris' ? [0x333738, 0x6f7069, 0x969183, 0x494c4b] : type === 'embers' ? [0xffac47, 0xffe297, 0xf36b32] : kind === 'slam' ? [0x888a80, 0xaaa99c, 0x6a6e68] : [0x34383b, 0x545551, 0x79796f];
      record.particles.push({type, x: Math.cos(angle) * initial, z: Math.sin(angle) * initial,
        vx: Math.cos(angle) * velocity, vz: Math.sin(angle) * velocity, vy: 3 + random() * (kind === 'slam' ? 6 : 8),
        size, flat: type === 'debris' && i % 3 === 0, spin: (random() - .5) * 14,
        life: type === 'debris' ? 3.2 + random() * 1.5 : type === 'embers' ? .5 + random() * .9 : 1.3 + random() * 1.2,
        color: palette[Math.floor(random() * palette.length)], phase: random() * Math.PI * 2});
    }
  }

  function remove(record) {if (record.mesh) {record.mesh.removeFromParent(); record.mesh.geometry.dispose();}}
  function reset() {
    records.forEach(remove); records.length = 0; seen.clear(); previousTime = null;
    uniforms.sgPitCount.value = 0; debris.count = embers.count = dust.count = 0;
    Object.assign(stats, {craters: 0, debris: 0, embers: 0, dust: 0, impacts: []});
  }
  function queue(id, kind, aim, radius, at, canonical=false) {
    if (seen.has(id) || !aim || ![aim.x, aim.z, radius, at].every(Number.isFinite)) return;
    seen.add(id); if (seen.size > 2048) seen.delete(seen.values().next().value);
    records.push({id, kind, seed: id, aim: {...aim, y: aim.y ?? track.y}, radius: radius * (canonical||kind==='slam' ? 1 : 1.08), at,expiresAt:at+LIFETIME});
    while (records.length > MAX_CRATERS) remove(records.shift());
  }
  function impactEvent(event, state) {
    if(Array.isArray(state.craters))return;
    if (event.type === 'robot-missile-impact') {
      queue(event.attackId, 'missile', event.aim, event.radius, state.elapsed + event.impactAt - (state.robot?.barrage?.time ?? state.elapsed));
    } else if (event.type === 'robot-strike') {
      const robot = state.robot;
      queue(`close-${event.attackId}`, event.kind, event.aim, event.radius, state.elapsed - Math.max(0, (robot?.phaseTime || 0) - (event.impactTime || 0)));
    }
  }
  function update(state) {
    if (disposed) return;
    if (['menu', 'countdown'].includes(state.phase)) {if (records.length || seen.size) reset(); return;}
    const time = state.renderTime ?? state.elapsed ?? 0;
    if (previousTime !== null && time < previousTime - .1) reset(); previousTime = time;
    const robot = state.robot, barrage = robot?.barrage;
    if(Array.isArray(state.craters)){
      const active=new Set(state.craters.map(c=>c.id));
      for(let i=records.length-1;i>=0;i--)if(!active.has(records[i].id)){remove(records[i]);records.splice(i,1);}
      for(const c of state.craters)queue(c.id,c.kind,c,c.radius,c.at,true);
    }else{
    // Recover an effect even if an event snapshot was skipped. Future missiles
    // are queued, but the pit remains absent until the displayed missile lands.
    for (const m of barrage?.missiles || []) queue(m.attackId, 'missile', m.aim, m.radius, state.elapsed + m.impactAt - barrage.time);
    if (robot?.impacted && robot.phase !== 'warning' && robot.attackId) {
      const strike = robot.kind === 'slam' ? .28 : .42;
      const ago = robot.phase === 'strike' ? robot.phaseTime - robot.impactTime : robot.phase === 'recover' ? robot.phaseTime + strike - robot.impactTime : null;
      if (ago !== null) queue(`close-${robot.attackId}`, robot.kind, robot.aim, robot.radius, state.elapsed - Math.max(0, ago));
    }
    }
    let pitCount = 0;
    const counts = {debris: 0, embers: 0, dust: 0}, meshes = {debris, embers, dust}, visible = [];
    for (let i = records.length - 1; i >= 0; i--) {
      const record = records[i], age = time - record.at;
      if (age >= LIFETIME) {remove(record); records.splice(i, 1); continue;}
      if (age < -1e-7) continue;
      if (!record.mesh) makeCrater(record);
      const fade = craterScale(record,time), {aim, radius} = record;
      record.mesh.scale.set(fade, 1, fade);
      uniforms.sgPits.value[pitCount++].set(aim.x, aim.z, radius, fade);
      visible.push({id: record.id, kind: record.kind, x: aim.x, z: aim.z, at: record.at, age, radius, fade});
      for (const p of age < 4.7 ? record.particles : []) {
        if (age >= p.life) continue;
        const mesh = meshes[p.type], index = counts[p.type]; if (index >= mesh.instanceMatrix.count) continue;
        let travel = age, height;
        if (p.type === 'dust') height = .18 + age * (1.1 + p.size) + Math.sin(age * 2 + p.phase) * .12;
        else {
          const landing = (p.vy + Math.sqrt(p.vy * p.vy + 2 * GRAVITY * .3)) / GRAVITY;
          height = .3 + p.vy * age - .5 * GRAVITY * age * age;
          if (age > landing) {
            const rest = age - landing, bounceVelocity = (GRAVITY * landing - p.vy) * .27;
            height = Math.max(0, bounceVelocity * rest - .5 * GRAVITY * rest * rest);
            travel = landing + (1 - Math.exp(-rest * 3)) / 3;
          }
          height += p.size * .5;
        }
        const shrink = clamp((p.life - age) / (p.type === 'dust' ? .7 : .55));
        const size = p.size * shrink * (p.type === 'dust' ? 1 + age * .8 : 1);
        dummy.position.set(aim.x + p.x + p.vx * travel, aim.y + height, aim.z + p.z + p.vz * travel);
        dummy.rotation.set(p.phase + age * p.spin, p.phase * 2 + age * p.spin * .7, age * p.spin * .35);
        dummy.scale.set(size * (p.flat ? 1.7 : 1), size * (p.flat ? .32 : 1), size);
        dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix); color.setHex(p.color); mesh.setColorAt(index, color); counts[p.type]++;
      }
    }
    uniforms.sgPitCount.value = pitCount;
    for (const [type, mesh] of Object.entries(meshes)) {mesh.count = counts[type]; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;}
    Object.assign(stats, counts, {craters: pitCount, impacts: visible});
  }
  return {group, stats, impactEvent, update, reset, dispose() {
    if (disposed) return; reset(); disposed = true; group.removeFromParent();
    for (const {material,previousCompile,previousKey} of materialHooks) {
      material.onBeforeCompile = previousCompile; material.customProgramCacheKey = previousKey; material.needsUpdate = true;
    }
    for (const mesh of [debris, embers, dust]) mesh.dispose(); box.dispose(); warmGeometry.dispose(); craterMaterial.dispose(); solidMaterial.dispose(); fireMaterial.dispose(); dustMaterial.dispose();
  }};
}
