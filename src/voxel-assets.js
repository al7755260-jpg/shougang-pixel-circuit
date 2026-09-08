import {GRANNY} from './granny-encounter.js';
/* Original voxel racing assets. Every static colour is baked into vertex colours. */
const PALETTE = {
  cream: 0xe4e8da, coral: 0xd97565, dark: 0x263c49, black: 0x172832,
  grey: 0x49707c, steel: 0xb8cdd0, cyan: 0x8bdee2, magenta: 0xdb92a2,
  yellow: 0xeec487, rubber: 0x252e35,
};

function geometryBatch(THREE) {
  const positions = [], normals = [], colors = [], indices = [];
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler(), position = new THREE.Vector3(), scale = new THREE.Vector3(1, 1, 1);
  const vertex = new THREE.Vector3(), normal = new THREE.Vector3(), normalMatrix = new THREE.Matrix3();
  function add(geometry, center, color, rotation = [0, 0, 0]) {
    position.set(...center); euler.set(...rotation); quaternion.setFromEuler(euler);
    matrix.compose(position, quaternion, scale); normalMatrix.getNormalMatrix(matrix);
    const p = geometry.attributes.position, n = geometry.attributes.normal, c = new THREE.Color(color);
    const offset = positions.length / 3;
    for (let i = 0; i < p.count; i++) {
      vertex.fromBufferAttribute(p, i).applyMatrix4(matrix);
      normal.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize();
      positions.push(vertex.x, vertex.y, vertex.z);
      normals.push(normal.x, normal.y, normal.z); colors.push(c.r, c.g, c.b);
    }
    if (geometry.index) for (let i = 0; i < geometry.index.count; i++) indices.push(offset + geometry.index.getX(i));
    else for (let i = 0; i < p.count; i++) indices.push(offset + i);
    geometry.dispose();
  }
  return {
    box(x, y, z, w, h, d, color, rotation = [0, 0, 0]) {
      add(new THREE.BoxGeometry(w, h, d), [x, y, z], color, rotation);
    },
    cylinder(x, y, z, radius, height, color, rotation = [0, 0, Math.PI / 2], segments = 12, radiusTop = radius) {
      add(new THREE.CylinderGeometry(radiusTop, radius, height, segments, 1, false), [x, y, z], color, rotation);
    },
    mesh(material) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    },
  };
}

function standard(THREE, opts = {}) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.04, ...opts });
}
function glowMaterial(THREE, intensity = 1.5) {
  return new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:true,color:new THREE.Color().setRGB(intensity*2.5,intensity*2.5,intensity*2.5)});
}

// Seven-segment digits remain crisp at every render resolution.
function addDigit(batch, value, x, y, z, pixel, color, face = 'front') {
  const glyphs = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111'];
  const glyph = glyphs[Math.abs(value) % 10];
  for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) {
    if (glyph[row * 3 + col] === '0') continue;
    if (face === 'top') batch.box(x + (col - 1) * pixel, y, z + (2 - row) * pixel, pixel * 0.86, .012, pixel * 0.86, color);
    else batch.box(x + (col - 1) * pixel, y + (2 - row) * pixel, z, pixel * .86, pixel * .86, .016, color);
  }
}

export function createKart(THREE, { color = PALETTE.coral, number = 8, scale = 1 } = {}) {
  const kart = new THREE.Group(); kart.name = `Neon Sparrow ${number}`;
  const material = new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.34,metalness:.18,clearcoat:.32,clearcoatRoughness:.24});
  const rubber=standard(THREE,{roughness:.88,metalness:.02}),driverMaterial=standard(THREE,{roughness:.58,metalness:.035});
  const emissive = glowMaterial(THREE, 1.6);
  const chassis = new THREE.Group(); chassis.name = 'Sprung chassis'; kart.add(chassis);
  const b = geometryBatch(THREE), lights = geometryBatch(THREE);
  // Low, layered monocoque; shoulder plates and staggered edges make the voxel silhouette intentional.
  b.box(0, .31, -.07, 1.14, .14, 1.88, PALETTE.dark);
  b.box(0, .43, -.10, 1.24, .16, 1.84, color);
  b.box(0, .51, .55, .88, .17, .81, color);
  b.box(0, .58, .58, .65, .06, .62, color);
  b.box(0, .49, 1.01, .75, .18, .24, color);
  b.box(0, .46, 1.16, 1.21, .11, .12, PALETTE.cream);
  b.box(0, .40, 1.23, 1.31, .07, .075, PALETTE.dark);
  b.box(0, .35, 1.15, .73, .09, .15, PALETTE.black);
  b.box(0, .61, .53, .125, .013, .75, PALETTE.cream);
  b.box(-.105, .613, .54, .045, .014, .75, PALETTE.dark);
  // Racing number plate, bolts, geometric air intakes.
  b.box(.255, .615, .68, .27, .02, .36, PALETTE.cream);
  addDigit(b, number, .255, .632, .68, .055, PALETTE.dark, 'top');
  for (const side of [-1, 1]) {
    b.box(side * .56, .51, -.26, .17, .19, 1.31, color);
    b.box(side * .57, .64, -.24, .14, .055, .76, PALETTE.cream);
    b.box(side * .655, .44, -.23, .052, .16, .69, PALETTE.dark);
    b.box(side * .53, .48, -.92, .24, .22, .31, color);
    b.box(side * .44, .50, .92, .20, .13, .15, PALETTE.cream);
    lights.box(side * .45, .515, 1.004, .14, .055, .022, PALETTE.cyan);
    lights.box(side * .68, .32, -.18, .025, .05, 1.53, PALETTE.cyan);
    lights.box(side * .51, .50, -1.09, .20, .042, .02, PALETTE.magenta);
    b.box(side * .58, .667, -.52, .045, .014, .045, PALETTE.steel);
    b.box(side * .58, .667, .05, .045, .014, .045, PALETTE.steel);
    for (let i = 0; i < 5; i++) b.box(side * .688, .47, -.45 + i * .105, .022, .082, .038, PALETTE.steel);
    // Exposed rods and coil spring blocks beside each wheel.
    for (const z of [-.73, .76]) {
      b.box(side * .58, .29, z, .30, .055, .07, PALETTE.steel, [0, .10 * side, .14 * side]);
      b.box(side * .56, .41, z, .06, .26, .06, PALETTE.dark, [0, 0, .36 * side]);
      for (let j = 0; j < 4; j++) b.box(side * (.56 + (.47 - j * .035) * .06), .33 + j * .044, z, .105, .019, .105, PALETTE.yellow);
    }
  }
  // Carbon bucket seat, rear power cell and little brass engine hardware.
  b.box(0, .56, -.26, .57, .13, .68, PALETTE.black);
  b.box(0, .81, -.53, .54, .56, .14, PALETTE.dark, [-.10, 0, 0]);
  b.box(0, 1.05, -.55, .35, .13, .14, PALETTE.black);
  b.box(0, .61, -.91, .55, .30, .42, PALETTE.grey);
  b.box(0, .79, -.92, .44, .07, .32, PALETTE.dark);
  for (let i = 0; i < 6; i++) b.box(-.22 + i * .087, .82, -.92, .035, .04, .29, PALETTE.steel);
  for (const side of [-1, 1]) {
    b.box(side * .27, .67, -1.07, .055, .20, .065, PALETTE.yellow);
    b.cylinder(side * .32, .42, -1.12, .095, .27, PALETTE.dark, [Math.PI / 2, 0, 0], 8);
    b.cylinder(side * .32, .42, -1.265, .087, .055, PALETTE.steel, [Math.PI / 2, 0, 0], 8);
    lights.cylinder(side * .32, .42, -1.296, .061, .01, PALETTE.magenta, [Math.PI / 2, 0, 0], 8);
    b.box(side * .41, .75, -.91, .04, .36, .065, PALETTE.dark);
  }
  // Small split rear aerofoil with endplates, and a cyan rear ticker.
  b.box(0, .96, -.94, 1.23, .072, .24, color);
  b.box(0, 1.006, -.97, .85, .018, .05, PALETTE.cream);
  lights.box(0, .962, -1.069, .83, .028, .014, PALETTE.cyan);
  for (const s of [-1, 1]) b.box(s * .62, .985, -.94, .047, .19, .30, PALETTE.dark);
  chassis.add(b.mesh(material));
  const glow = lights.mesh(emissive); glow.castShadow = false; chassis.add(glow);

  const wheels = [], frontWheels = [];
  for (const z of [-.73, .76]) for (const side of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(side * .72, .30, z); kart.add(pivot);
    const rolling = new THREE.Group(); pivot.add(rolling);
    const w = geometryBatch(THREE);
    w.cylinder(0, 0, 0, .293, .29, PALETTE.rubber, undefined, 12);
    for (let j = 0; j < 12; j++) {
      const a = j / 12 * Math.PI * 2;
      for (const strip of [-1, 1]) w.box(strip * .070, Math.cos(a) * .292, Math.sin(a) * .292, .075, .025, .105, PALETTE.black, [a, 0, strip * .13]);
    }
    for (const s of [-1, 1]) {
      w.cylinder(s * .151, 0, 0, .212, .016, PALETTE.black, undefined, 12);
      w.cylinder(s * .164, 0, 0, .166, .018, PALETTE.cream, undefined, 8);
      w.cylinder(s * .18, 0, 0, .118, .022, PALETTE.dark, undefined, 8);
      w.cylinder(s * .196, 0, 0, .052, .035, PALETTE.yellow, undefined, 8);
      for (let j = 0; j < 4; j++) {
        const a = j * Math.PI / 2;
        w.box(s * .197, Math.cos(a) * .096, Math.sin(a) * .096, .028, .044, .055, PALETTE.steel, [a, 0, 0]);
      }
    }
    rolling.add(w.mesh(rubber)); wheels.push(rolling);
    if (z > 0) frontWheels.push(pivot);
  }

  const driver = new THREE.Group(); driver.name = 'Pixel courier'; driver.position.set(0, .59, -.19); chassis.add(driver);
  const d = geometryBatch(THREE);
  // Boots and bent knees tuck under the dashboard.
  for (const side of [-1, 1]) {
    d.box(side * .13, .014, .18, .18, .14, .35, PALETTE.dark);
    d.box(side * .13, .028, .39, .18, .09, .15, PALETTE.cream);
    d.box(side * .13, .13, .09, .16, .26, .18, color, [.52, 0, 0]);
  }
  d.box(0, .26, -.07, .40, .42, .29, color);
  d.box(0, .39, -.066, .46, .18, .30, color);
  d.box(0, .265, .086, .30, .24, .016, PALETTE.dark);
  d.box(-.105, .35, .102, .065, .25, .029, PALETTE.cream);
  d.box(.105, .35, .102, .065, .25, .029, PALETTE.cream);
  d.box(0, .24, .126, .20, .045, .016, PALETTE.cream);
  d.box(.105, .25, .148, .063, .063, .016, PALETTE.yellow);
  // Box-built shoulders, angled sleeves and gloved hands.
  for (const side of [-1, 1]) {
    d.box(side * .268, .36, .023, .16, .20, .18, color, [-.42, 0, side * .16]);
    d.box(side * .265, .28, .16, .13, .13, .23, color, [-.30, side * .28, 0]);
    d.box(side * .237, .265, .294, .12, .12, .12, PALETTE.dark);
    d.box(side * .263, .316, .18, .142, .031, .11, PALETTE.cream, [-.30, side * .28, 0]);
  }
  // Stepped helmet, scalloped cheek guards and a continuous black visor.
  d.box(0, .735, -.015, .55, .42, .46, color);
  d.box(0, .966, -.015, .43, .06, .38, color);
  d.box(0, .717, .027, .61, .24, .38, color);
  d.box(0, .515, .032, .43, .066, .35, color);
  d.box(0, .751, .238, .47, .185, .035, PALETTE.black);
  d.box(0, .775, .261, .40, .102, .012, 0x164f5b);
  d.box(-.115, .808, .269, .18, .019, .013, 0xa5ede1);
  d.box(.135, .727, .262, .085, .014, .012, 0x3c8590);
  d.box(0, .998, -.015, .11, .013, .36, PALETTE.cream);
  d.box(0, .949, .208, .11, .076, .018, PALETTE.cream);
  d.box(0, .736, -.254, .11, .42, .018, PALETTE.cream);
  d.box(0, .528, .214, .10, .044, .022, PALETTE.dark);
  for (const side of [-1, 1]) {
    d.box(side * .289, .686, .161, .043, .12, .10, color);
    d.box(side * .311, .726, .02, .021, .068, .074, PALETTE.dark);
    for (let j = 0; j < 3; j++) d.box(side * .285, .603, .11 - .062 * j, .018, .022, .035, PALETTE.dark);
  }
  driver.add(d.mesh(driverMaterial));

  const steering = new THREE.Group(); steering.position.set(0, .86, .185); steering.rotation.x = -.50; chassis.add(steering);
  const s = geometryBatch(THREE);
  s.box(0, 0, 0, .39, .036, .047, PALETTE.dark);
  s.box(-.20, 0, 0, .056, .18, .06, PALETTE.black);
  s.box(.20, 0, 0, .056, .18, .06, PALETTE.black);
  s.box(0, -.082, 0, .35, .035, .045, PALETTE.dark);
  s.box(0, .027, .021, .09, .06, .029, PALETTE.yellow);
  steering.add(s.mesh(material));
  const exhaust = new THREE.Group(); exhaust.position.set(0, .42, -1.30); chassis.add(exhaust);
  const fire = geometryBatch(THREE);
  for (const side of [-1, 1]) {
    fire.box(side * .32, 0, -.11, .09, .10, .22, PALETTE.cyan);
    fire.box(side * .32, 0, -.26, .06, .06, .19, PALETTE.magenta);
  }
  exhaust.add(fire.mesh(emissive)); exhaust.visible = false;
  kart.scale.setScalar(scale);
  kart.userData = { ...kart.userData, wheels, frontWheels, driver, steering, chassis, exhaust, glow, wheelRadius: .293, number, color, travel: 0 };
  return kart;
}

export function animateKart(kart, { speed = 0, steer = 0, drift = false, time = 0, boost = false } = {}, dt = 1 / 60) {
  const u = kart.userData;
  if (!u.wheels) return;
  const motion = Math.min(Math.abs(speed) / 16, 1);
  u.travel = (u.travel + speed * Math.min(dt, .10) / u.wheelRadius) % (Math.PI * 2);
  for (const wheel of u.wheels) wheel.rotation.x = u.travel;
  for (const wheel of u.frontWheels) wheel.rotation.y = steer * .46;
  u.chassis.position.y = Math.sin(time * 34) * .007 * motion;
  u.chassis.rotation.z = -steer * motion * (drift ? .085 : .043);
  u.driver.rotation.z = -steer * (drift ? .15 : .065);
  u.driver.rotation.x = Math.sin(time * 21) * .007 * motion + (boost ? .065 : 0);
  u.steering.rotation.z = -steer * .42;
  u.exhaust.visible = Boolean(boost);
  u.exhaust.scale.z = 1 + Math.sin(time * 47) * .23;
}

export function createItemBox(THREE, color = PALETTE.cyan) {
  const item = new THREE.Group(); item.name = 'Neon data pickup';
  const b = geometryBatch(THREE), g = geometryBatch(THREE);
  b.box(0, 0, 0, .69, .69, .69, PALETTE.coral);
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    g.box(x * .355, y * .355, z * .355, .17, .07, .07, color);
    g.box(x * .355, y * .355, z * .355, .07, .17, .07, color);
    g.box(x * .355, y * .355, z * .355, .07, .07, .17, color);
  }
  const question = ['111', '001', '011', '010', '000', '010'];
  for (let row = 0; row < question.length; row++) for (let col = 0; col < 3; col++) if (question[row][col] === '1') {
    const x = (col - 1) * .091, y = (.5 * (question.length - 1) - row) * .081;
    for (const side of [-1, 1]) {
      g.box(x * side, y, side * .355, .074, .066, .018, PALETTE.yellow);
      g.box(side * .355, y, -x * side, .018, .066, .074, PALETTE.yellow);
    }
  }
  b.box(0, .357, 0, .25, .025, .25, PALETTE.grey, [0, Math.PI / 4, 0]);
  g.box(0, .374, 0, .10, .015, .10, color, [0, Math.PI / 4, 0]);
  item.add(b.mesh(standard(THREE)), g.mesh(glowMaterial(THREE, 1.8)));
  item.userData.radius = .68;
  return item;
}

function labelTexture(THREE, { headline, subline = '', color = '#eec487', background = '#254652', width = 512, height = 192 }) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, 6); ctx.fillRect(0, height - 6, width, 6);
  ctx.fillRect(0, 0, 6, height); ctx.fillRect(width - 6, 0, 6, height);
  for (let x = 16; x < width - 12; x += 13) ctx.fillRect(x, height - 20, 6, 5);
  ctx.font = `900 ${Math.round(height * .27)}px "Arial Black", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff4da'; ctx.fillText(headline, width / 2, height * .38, width - 48);
  if (subline) {
    ctx.font = `bold ${Math.round(height * .125)}px monospace`; ctx.fillStyle = color;
    ctx.fillText(subline, width / 2, height * .71, width - 40);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false; return texture;
}

export function createTrackProps(THREE, track) {
  const group = new THREE.Group(); group.name = '首钢 · Neon track furnishings';
  const solid = geometryBatch(THREE), neon = geometryBatch(THREE), flora = geometryBatch(THREE);
  const material = standard(THREE), glow = glowMaterial(THREE, 1.4);
  const width = track.width || 10, length = track.length || 500;
  const vector = v => new THREE.Vector3(v.x, v.y, v.z);
  const point = t => vector(track.getPoint(((t % 1) + 1) % 1));
  const tangent = t => vector(track.getTangent(((t % 1) + 1) % 1)).normalize();
  const normal = t => track.getNormal ? vector(track.getNormal(((t % 1) + 1) % 1)).normalize() : new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), tangent(t)).normalize();
  function worldBox(batch, center, ox, oy, oz, w, h, d, color, angle) {
    batch.box(center.x + ox * Math.cos(angle) + oz * Math.sin(angle), center.y + oy,
      center.z - ox * Math.sin(angle) + oz * Math.cos(angle), w, h, d, color, [0, angle, 0]);
  }
  // Discrete light rails leave the Gaussian heritage visible between the track and the park.
  const railCount = Math.min(480, Math.ceil(length / 3.3));
  for (let i = 0; i < railCount; i++) {
    const t = i / railCount, p = point(t), n = normal(t), tan = tangent(t);
    if(Math.abs(t-GRANNY.progress)*length<3.3)continue;
    const yaw = Math.atan2(tan.x, tan.z), spacing = length / railCount;
    for (const side of [-1, 1]) {
      const q = p.clone().addScaledVector(n, side * (width / 2 + .40));
      solid.box(q.x, q.y + .22, q.z, .20, .44, .22, PALETTE.dark, [0, yaw, 0]);
      solid.box(q.x, q.y + .47, q.z, .13, .105, Math.min(spacing * .91, 3.35), PALETTE.grey, [0, yaw, 0]);
      neon.box(q.x, q.y + .53, q.z, .075, .037, Math.min(spacing * .87, 3.2), side === 1 ? PALETTE.cyan : (i % 9 === 0 ? PALETTE.magenta : PALETTE.cream), [0, yaw, 0]);
      if (i % 4 === 0) {
        solid.box(q.x, q.y + .13, q.z, .28, .08, .31, PALETTE.steel, [0, yaw, 0]);
        neon.box(q.x, q.y + .70, q.z, .07, .13, .07, PALETTE.yellow, [0, yaw, 0]);
      }
    }
  }
  // Suspended start arch: refurbished steel, luminous inner edges, pixel checkerboard endcaps.
  const start = point(0), startTan = tangent(0), yaw = Math.atan2(startTan.x, startTan.z);
  for (const side of [-1, 1]) {
    worldBox(solid, start, side * (width / 2 + .9), 2.35, 0, .45, 4.7, .65, PALETTE.dark, yaw);
    worldBox(solid, start, side * (width / 2 + .9), .23, 0, .95, .46, 1.16, PALETTE.grey, yaw);
    worldBox(neon, start, side * (width / 2 + .64), 2.5, .03, .052, 4.2, .18, side === 1 ? PALETTE.cyan : PALETTE.magenta, yaw);
    worldBox(solid, start, side * (width / 2 + .9), 4.83, 0, .76, .25, .86, PALETTE.cream, yaw);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) worldBox(solid, start,
      side * (width / 2 + .9) + (c - .5) * .18, 1.1 + r * .19, -.333, .17, .18, .015, (r + c) % 2 ? PALETTE.cream : PALETTE.dark, yaw);
  }
  worldBox(solid, start, 0, 4.45, 0, width + 2.2, .74, .62, PALETTE.dark, yaw);
  worldBox(neon, start, 0, 4.04, .20, width + 1.6, .07, .12, PALETTE.cyan, yaw);
  worldBox(neon, start, 0, 4.89, -.14, width + 1.85, .046, .10, PALETTE.magenta, yaw);
  for (let i = 0; i < 5; i++) worldBox(neon, start, (i - 2) * .46, 3.87, 0, .20, .14, .20, i === 2 ? PALETTE.yellow : PALETTE.cyan, yaw);
  // Tiny raised geometry avoids a transparent shader and stays readable through a low-res pass.
  const squares = Math.floor(width / .46);
  for (let col = 0; col < squares; col++) for (let row = 0; row < 3; row++) worldBox(solid, start,
    (col - (squares - 1) / 2) * .46, .022, (row - 1) * .46, .455, .014, .455,
    (col + row) % 2 ? PALETTE.cream : PALETTE.dark, yaw);

  const signs = new THREE.Group(); signs.name = 'Holographic signs'; group.add(signs);
  function billboard(pos, angle, headline, subline, color, w = 4.8, h = 1.5) {
    const map = labelTexture(THREE, { headline, subline, color });
    const material = new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide, toneMapped: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    plane.position.copy(pos); plane.rotation.y = angle; signs.add(plane); return plane;
  }
  const signPosition = start.clone(); signPosition.y += 4.46;
  signPosition.addScaledVector(startTan, -.329);
  billboard(signPosition, yaw + Math.PI, 'SHOUGANG / 首钢园', 'PIXEL CIRCUIT · PARK RALLY 2077', '#eec487', Math.min(width - 1, 8), .65);
  const backPosition = start.clone().addScaledVector(startTan, .329); backPosition.y += 4.46;
  billboard(backPosition, yaw, 'SHOUGANG / 首钢园', 'PIXEL CIRCUIT · PARK RALLY 2077', '#dca0ab', Math.min(width - 1, 8), .65);

  const holoMarkers = [];
  const markerCount = Math.min(24, Math.max(10, Math.ceil(length / 60)));
  const turnProbe = Math.min(.018, 9 / length);
  const adHeadlines = ['园区电台', 'PARK NOODLES', '首钢 · 未来街区', 'PIXEL ENERGY'];
  const adSublines = ['87.7 FM / PARK RUN', 'OPEN 24H / 园区拉面', 'STEEL · SKY · MOTION', '超频补给 / OVERDRIVE'];
  for (let i = 0; i < markerCount; i++) {
    const t = (i + .6) / markerCount, p = point(t), n = normal(t), tan = tangent(t);
    const turn = tangent(t + turnProbe).sub(tangent(t - turnProbe)).dot(n);
    const side = turn > 0 ? -1 : 1, a = Math.atan2(tan.x, tan.z);
    const q = p.clone().addScaledVector(n, side * (width / 2 + 1.5));
    solid.box(q.x, q.y + 1.1, q.z, .13, 2.2, .13, PALETTE.grey, [0, a, 0]);
    neon.box(q.x, q.y + .06, q.z, 1.4, .034, 1.4, i % 2 ? PALETTE.cyan : PALETTE.magenta, [0, a, 0]);
    q.y += 2.42;
    const arrow = turn > 0 ? '› › ›' : '‹ ‹ ‹';
    const mark = billboard(q, a + Math.PI, arrow, `${String(i + 1).padStart(2, '0')} / ${i % 2 ? 'FOLLOW THE ROAD' : 'FUTURE PARK'}`, i % 2 ? '#eec487' : '#dcebea', 2.25, 1.08);
    mark.userData.baseY = q.y; holoMarkers.push(mark);
    if (i % 4 === 0) {
      const ad = p.clone().addScaledVector(n, -side * (width / 2 + 4.7)); ad.y += 3.6;
      const adIndex = Math.floor(i / 4) % adHeadlines.length;
      billboard(ad, a + Math.PI, adHeadlines[adIndex], adSublines[adIndex], adIndex % 2 ? '#dca0ab' : '#eec487', 3.0, 1.45);
      solid.box(ad.x, ad.y - 2.0, ad.z, .17, 2.5, .17, PALETTE.dark, [0, a, 0]);
    }
  }
  // Restrained park vegetation, faceted hedges and geometric ground tufts.
  const treeCount = Math.min(96, Math.max(38, Math.ceil(length / 14.5)));
  for (let i = 0; i < treeCount; i++) {
    const t = ((i * .61803398875) + .072) % 1;
    const p = point(t), n = normal(t), side = i % 2 ? -1 : 1;
    const q = p.addScaledVector(n, side * (width / 2 + 3.2 + (i % 5) * 1.1));
    const h = 1.2 + (i % 4) * .20;
    flora.box(q.x, q.y + h * .45, q.z, .18, h * .9, .18, 0x927143);
    flora.box(q.x, q.y + h, q.z, 1.10, .62, 1.10, i % 3 ? 0x457666 : 0x608275);
    flora.box(q.x + .11, q.y + h + .47, q.z -.1, .75, .37, .82, 0x78bd46);
    flora.box(q.x -.32, q.y + h + .08, q.z + .17, .65, .51, .78, 0x228846);
    for (let j = 0; j < 3; j++) flora.box(q.x - .42 + j * .38, q.y + .075 + j * .012, q.z + 1.1, .08, .16 + j * .025, .08, 0x75b94c, [0, j, -.13 + j * .13]);
    if (i % 5 === 0) neon.box(q.x, q.y + .07, q.z, .72, .025, .72, PALETTE.cyan);
  }
  group.add(solid.mesh(material), neon.mesh(glow), flora.mesh(standard(THREE, { roughness: 1, metalness: 0 })));

  const items = [];
  for (const t of [.14, .39, .65, .86]) for (const lane of [-2.2, 2.2]) {
    const box = createItemBox(THREE, lane < 0 ? PALETTE.cyan : PALETTE.magenta);
    box.position.copy(point(t)).addScaledVector(normal(t), lane); box.position.y += 1.05;
    box.rotation.y = t * 8 + lane;
    box.userData.baseY = box.position.y; box.userData.trackT = t; box.userData.active = true;
    group.add(box); items.push(box);
  }
  function animate(time) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      item.rotation.y = time * .75 + i;
      item.position.y = item.userData.baseY + Math.sin(time * 2.4 + i) * .16;
      item.rotation.z = Math.sin(time * 1.3 + i) * .07;
    }
    for (let i = 0; i < holoMarkers.length; i++) holoMarkers[i].position.y = holoMarkers[i].userData.baseY + Math.sin(time * 1.6 + i) * .06;
  }
  group.userData.railSegmentsPerSide = railCount;
  group.userData.railSpacing = length / railCount;
  group.userData.guideMarkers = markerCount;
  group.userData.parkTrees = treeCount;
  return { group, items, animate };
}
