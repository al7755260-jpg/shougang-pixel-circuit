import * as THREE from 'three';
import {RacerReactions, REACTION_LINES, REACTION_SECONDS, layoutReactions} from './racer-reactions.js';

function bubbleTexture(reaction, kind, compact = false) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = compact ? 218 : 288;
  const ctx = canvas.getContext('2d');
  const outline = compact ? [[34, 12], [470, 12], [490, 30], [490, 162], [470, 180], [279, 180], [250, 209], [242, 180], [34, 180], [16, 162], [16, 30]] : [[42, 16], [462, 16], [482, 36], [482, 210], [462, 230], [284, 230], [252, 273], [247, 230], [42, 230], [22, 210], [22, 36]];
  function path(dx, dy) { ctx.beginPath(); outline.forEach(([x, y], i) => i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)); ctx.closePath(); }
  path(5, 7); ctx.fillStyle = '#182c3bb0'; ctx.fill();
  path(0, 0); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = '#192e3b'; ctx.lineWidth = 8; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.fillStyle = '#172b37'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 70px "Microsoft YaHei", "Segoe UI Symbol", sans-serif'; ctx.fillText(reaction.face, 252, compact ? 67 : 98, 408);
  ctx.font = `bold ${compact ? 56 : 46}px "Microsoft YaHei", sans-serif`; ctx.fillText(reaction.text, 252, compact ? 142 : 181, 402);
  ctx.fillStyle = kind === 'overtake' ? '#daa43e' : '#dc6758';
  if (kind === 'overtake') {
    ctx.fillRect(434, 45, 7, 31); ctx.fillRect(422, 57, 31, 7);
  } else {
    ctx.fillRect(435, 43, 8, 22); ctx.fillRect(435, 71, 8, 8);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false;
  return texture;
}

export function createRacerReactionVisual(track, {getObstacles = () => []} = {}) {
  const tracker = new RacerReactions(track.length), scene = new THREE.Scene(), slots = new Map();
  const textures = Object.fromEntries(Object.entries(REACTION_LINES).map(([kind, lines]) => [kind, lines.map(line => bubbleTexture(line, kind))]));
  const compactTextures = Object.fromEntries(Object.entries(REACTION_LINES).map(([kind, lines]) => [kind, lines.map(line => bubbleTexture(line, kind, true))]));
  const anchor = new THREE.Vector3(), projected = new THREE.Vector3(), point = new THREE.Vector3();
  let visible = [];
  function slotFor(id) {
    if (slots.has(id)) return slots.get(id);
    // Three.js sprites construct their quad in camera space, even when orbiting 360°.
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false, sizeAttenuation: false}));
    sprite.name = `车手 ${id} · 漫画表情气泡`; sprite.center.set(.5, 0); sprite.frustumCulled = false; sprite.renderOrder = 2;
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const tail = new THREE.Line(geometry, new THREE.LineBasicMaterial({color: 0x243b49, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false}));
    tail.frustumCulled = false; tail.renderOrder = 1; scene.add(tail, sprite);
    const slot = {sprite, tail}; slots.set(id, slot); return slot;
  }
  return {
    tracker, scene,
    prepare(vehicles) {for (const v of vehicles) {const {sprite} = slotFor(v.id); sprite.material.map = textures.overtake[0]; sprite.visible = false;}},
    get visible() { return visible; },
    reset() { tracker.reset(); visible = []; for (const {sprite, tail} of slots.values()) sprite.visible = tail.visible = false; },
    suppress(id, elapsed) { tracker.suppress(id, elapsed + 1); },
    update(state, camera, width, height) {
      const portrait = width <= 760 && height > width, duration = portrait ? 1.7 : REACTION_SECONDS;
      const reactions = tracker.update(state); visible = [];
      for (const {sprite, tail} of slots.values()) sprite.visible = tail.visible = false;
      if (!['racing', 'paused'].includes(state.phase)) return;
      camera.updateMatrixWorld();
      const anchors = [];
      for (const reaction of reactions) {
        const v = state.vehicles.find(v => v.id === reaction.vehicleId); if (!v) continue;
        anchor.set(v.x, track.y + 2.6, v.z); const distance = anchor.distanceTo(camera.position);
        projected.copy(anchor).project(camera);
        if (distance > 105 || projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1.08 || Math.abs(projected.y) > 1.08) continue;
        const age = Math.max(0, (tracker.time ?? state.elapsed) - reaction.at);
        if (age > duration || (portrait && distance > 65)) continue;
        const pop = 1 + Math.sin(Math.min(1, age / .20) * Math.PI) * .08;
        const w = (portrait ? 92 : width < 600 ? 110 : 130) * THREE.MathUtils.clamp(1.12 - distance / 180, portrait ? .88 : .72, 1) * pop;
        anchors.push({id: v.id, name: v.name, reaction, age, anchor: anchor.clone(), depth: projected.z,
          distance, x: (projected.x + 1) * width / 2, y: (1 - projected.y) * height / 2 - 5 - Math.sin(age * 3) * 2, width: w, height: w * (portrait ? 218 : 288) / 512});
      }
      if (portrait) {
        anchors.sort((a, b) => Number(b.id === (state.localPlayerId ?? 0)) - Number(a.id === (state.localPlayerId ?? 0)) || b.reaction.at - a.reaction.at || a.distance - b.distance);
        anchors.splice(2);
      }
      const perPixel = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / height;
      for (const a of layoutReactions(anchors, width, height, anchors.length ? getObstacles() : [])) {
        if (portrait && Math.hypot(a.x - (a.anchor.clone().project(camera).x + 1) * width / 2, a.bottom - a.y) > 100) continue;
        const {sprite, tail} = slotFor(a.id), opacity = Math.min(1, a.age / .07, (duration - a.age) / .3);
        sprite.visible = true; sprite.material.map = (portrait ? compactTextures : textures)[a.reaction.kind][a.reaction.variant]; sprite.material.opacity = Math.max(0, opacity);
        sprite.position.set(a.x / width * 2 - 1, 1 - a.bottom / height * 2, a.depth).unproject(camera);
        sprite.scale.set(a.width * perPixel, a.height * perPixel, 1);
        // A fine comic pointer keeps raised balloons tied to the right driver.
        point.copy(a.anchor).project(camera); const delta = Math.hypot((point.x + 1) * width / 2 - a.x, (1 - point.y) * height / 2 - a.bottom);
        tail.visible = delta > 14; tail.material.opacity = Math.max(0, opacity) * .7;
        const positions = tail.geometry.attributes.position;
        positions.setXYZ(0, a.anchor.x, a.anchor.y, a.anchor.z); positions.setXYZ(1, sprite.position.x, sprite.position.y, sprite.position.z); positions.needsUpdate = true;
        visible.push({vehicleId: a.id, kind: a.reaction.kind, text: a.reaction.text, face: a.reaction.face, name: a.name,
          x: a.x, y: a.bottom, width: a.width, height: a.height});
      }
    },
    render(renderer, camera) {
      if (!visible.length) return;
      const autoClear = renderer.autoClear; renderer.autoClear = false;
      try { renderer.render(scene, camera); } finally { renderer.autoClear = autoClear; }
    },
    dispose() {
      for (const {sprite, tail} of slots.values()) { sprite.material.dispose(); tail.material.dispose(); tail.geometry.dispose(); }
      for (const maps of Object.values(textures)) for (const texture of maps) texture.dispose();
      for (const maps of Object.values(compactTextures)) for (const texture of maps) texture.dispose();
      scene.clear(); slots.clear(); tracker.reset(); visible = [];
    },
  };
}
