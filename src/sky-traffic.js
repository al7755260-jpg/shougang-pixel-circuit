import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const C={hull:0xb3c4c5,ivory:0xe0dfcf,plate:0x718f99,teal:0x4b717e,deep:0x314c59,glass:0x6eacb5,cyan:0xb4e7e7,amber:0xdbb57e,steel:0x8da5ad};
const TAU=Math.PI*2;
function batch(){
  const pieces=[];
  return {
    box(x,y,z,w,h,d,color,rotation){
      const g=new THREE.BoxGeometry(w,h,d);if(rotation)g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
      g.translate(x,y,z);const c=new THREE.Color(color),a=new Float32Array(g.attributes.position.count*3);
      for(let i=0;i<a.length;i+=3){a[i]=c.r;a[i+1]=c.g;a[i+2]=c.b;}
      g.setAttribute('color',new THREE.BufferAttribute(a,3));pieces.push(g);
    },
    mesh(material,name){
      const g=mergeGeometries(pieces,false);for(const part of pieces)part.dispose();
      const mesh=new THREE.Mesh(g,material);mesh.name=name;return mesh;
    },
  };
}

// Only exposed faces are emitted from a genuinely three-dimensional occupied sphere.
// Colour follows latitude and radial illumination, while every face stays square.
function voxelSphere(radius,cell,palette,seed=0){
  const n=Math.ceil(radius/cell),positions=[],normals=[],colors=[],indices=[];
  const directions=[
    {n:[1,0,0],u:[0,1,0],v:[0,0,1]}, {n:[-1,0,0],u:[0,0,1],v:[0,1,0]},
    {n:[0,1,0],u:[0,0,1],v:[1,0,0]}, {n:[0,-1,0],u:[1,0,0],v:[0,0,1]},
    {n:[0,0,1],u:[1,0,0],v:[0,1,0]}, {n:[0,0,-1],u:[0,1,0],v:[1,0,0]},
  ];
  const occupied=(x,y,z)=>x*x+y*y+z*z<=(radius/cell)**2;
  const color=new THREE.Color(),sun=new THREE.Vector3(-.48,.63,.62).normalize();let voxels=0;
  for(let x=-n;x<=n;x++)for(let y=-n;y<=n;y++)for(let z=-n;z<=n;z++){
    if(!occupied(x,y,z))continue;voxels++;
    const latitude=y/n,wave=Math.sin(x*.27+seed)+Math.sin(z*.19-seed)*.7;
    const band=((Math.floor((latitude+1)*4.2+wave*.32)%palette.length)+palette.length)%palette.length;
    const distance=Math.hypot(x,y,z)||1,lit=Math.max(0,(x*sun.x+y*sun.y+z*sun.z)/distance);
    const shade=.52+.46*lit,noise=((x*17+y*31+z*13+seed*7)&7)*.004;
    for(const face of directions){
      if(occupied(x+face.n[0],y+face.n[1],z+face.n[2]))continue;
      const start=positions.length/3;color.setHex(palette[band]);
      color.multiplyScalar(Math.max(.25,shade+noise+(face.n[1]>0?.04:face.n[1]<0?-.035:0)));
      for(const [u,v]of [[-1,-1],[1,-1],[1,1],[-1,1]]){
        positions.push((x+(face.n[0]+u*face.u[0]+v*face.v[0])*.5)*cell,(y+(face.n[1]+u*face.u[1]+v*face.v[1])*.5)*cell,(z+(face.n[2]+u*face.u[2]+v*face.v[2])*.5)*cell);
        normals.push(...face.n);colors.push(color.r,color.g,color.b);
      }
      indices.push(start,start+1,start+2,start,start+2,start+3);
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeBoundingSphere();
  geometry.userData.voxels=voxels;return geometry;
}

function createShip(type,solid,glow){
  const group=new THREE.Group();group.name=['Harbour freight carrier','Arrow courier','Twin-pod survey craft','Skyline passenger liner'][type];
  const hull=batch(),lit=batch(),exhaust=batch();
  const length=[14,13,11,19][type],width=[6.8,4.2,8.0,5.5][type];
  hull.box(0,0,0,width,1.65,length,C.deep);hull.box(0,.68,.4,width-.6,1.35,length-1.2,C.hull);
  hull.box(0,-1.0,-.1,width-.9,.45,length-1.4,C.plate);
  // Stepped bow and dark front bridge are visible in both front and side profiles.
  hull.box(0,.18,length/2+.45,width*.66,1.30,1.35,C.hull);hull.box(0,.26,length/2+1.32,width*.39,.76,.70,C.ivory);
  hull.box(0,1.72,length*.23,width*.69,1.02,3.4,C.plate);lit.box(0,1.77,length*.23+1.74,width*.59,.55,.11,C.glass);
  for(const side of [-1,1]){
    hull.box(side*(width/2+.40),-.14,-length*.15,1.0,1.18,length*.77,C.plate);
    hull.box(side*(width/2+.35),.42,-length*.18,.88,.24,length*.70,C.ivory);
    for(let i=0;i<(type===3?8:5);i++){
      const z=-length*.30+i*(length*.58/(type===3?7:4));
      lit.box(side*(width/2+.925),.02,z,.085,.35,.70,i%4?C.cyan:C.amber);
      hull.box(side*(width/2+.96),-.45,z,.07,.14,.78,C.deep);
    }
    hull.box(side*(width*.31),-.2,-length/2-.65,1.43,1.56,1.82,C.deep);
    hull.box(side*(width*.31),-.2,-length/2-1.48,1.65,1.76,.42,C.steel);
    lit.box(side*(width*.31),-.2,-length/2-1.73,1.10,1.12,.12,C.cyan);
    exhaust.box(side*(width*.31),-.2,-length/2-2.02,.78,.81,.58,C.glass);
    exhaust.box(side*(width*.31),-.2,-length/2-2.51,.46,.51,.42,C.cyan);
    lit.box(side*(width/2+1),.45,length*.28,.34,.17,.31,side<0?C.amber:C.cyan);
  }
  if(type===0){
    // Container shoulders, crane-like dorsal spine and a broad cargo belly.
    for(const side of [-1,1])for(let i=0;i<3;i++){
      hull.box(side*1.85,1.72,-4.3+i*2.7,2.5,1.68,2.1,i===1?C.ivory:C.teal);
      for(let j=0;j<3;j++)hull.box(side*1.85+(-.72+j*.72),2.60,-4.3+i*2.7,.11,.12,2.17,C.steel);
    }
    hull.box(0,3.06,-2.5,.46,.45,9.5,C.plate);hull.box(0,3.77,-4.0,.24,1.0,.25,C.steel);lit.box(0,4.32,-4,.34,.21,.34,C.amber);
  }else if(type===1){
    // A low dart with stepped swept wings and one tall offset dorsal fin.
    for(const side of [-1,1])for(let step=0;step<4;step++){
      hull.box(side*(3+step*.82),-.02,-1.3-step*.92,.95,.31,3.7-step*.45,step%2?C.plate:C.ivory);
      if(step===3)lit.box(side*(3+step*.82),.02,-1.3-step*.92,.62,.10,.44,C.cyan);
    }
    hull.box(0,1.79,-3.9,.40,3.15,2.15,C.teal);hull.box(0,3.32,-4.18,.43,.25,1.5,C.ivory);
  }else if(type===2){
    // Twin survey pods and a central hanging scanner make a U-shaped silhouette.
    for(const side of [-1,1]){
      hull.box(side*5.1,.2,-.7,2.1,2.25,13.9,C.hull);hull.box(side*5.1,.28,6.52,1.46,1.51,.88,C.ivory);
      hull.box(side*5.1,1.47,-.4,1.78,.35,9.8,C.teal);lit.box(side*5.1,-.1,-7.75,1.16,1.25,.14,C.cyan);
    }
    hull.box(0,-1.93,1.0,2.6,1.60,2.6,C.plate);lit.box(0,-2.78,1.0,1.68,.12,1.68,C.glass);
    hull.box(0,2.4,-2.7,.21,2.1,.24,C.steel);hull.box(0,3.24,-2.7,3.3,.22,.32,C.ivory);
  }else{
    // Longer two-deck liner with cream roof, promenade windows and a small tail.
    hull.box(0,2.13,-1.2,4.0,1.54,13.8,C.ivory);hull.box(0,3.03,-1.2,3.7,.25,12.8,C.steel);
    for(const side of [-1,1])for(let i=0;i<8;i++)lit.box(side*2.055,2.1,-6.7+i*1.6,.10,.52,.87,i%3?C.cyan:C.amber);
    hull.box(0,3.02,-7.7,.42,3.0,2.0,C.teal);hull.box(0,1.0,-8.0,9.9,.31,1.7,C.hull);
  }
  group.add(hull.mesh(solid,'Merged hull and mechanical details'),lit.mesh(glow,'Windows, running lights and thrusters'));
  const plume=exhaust.mesh(glow,'Restrained ion exhaust');group.add(plume);
  group.userData={type,plume};return group;
}

/** Actual voxel geometry above and around the park; no textures or camera overlays. */
export function createSkyTraffic(){
  const group=new THREE.Group();group.name='雾青城市 · 行星与空中航道';
  const planetMaterial=new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false,fog:false});
  const shipMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.63,metalness:.27});
  const lightMaterial=new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false});
  const planet=new THREE.Group();planet.name='Main banded voxel planet';planet.position.set(-930,145,0);group.add(planet);
  const globe=new THREE.Mesh(voxelSphere(80,4,[0x849da7,0xb6c5c6,0x829aa1,0xd4d4c3,0x6e8b96],3),planetMaterial);globe.name='Solid stepped planetary strata';planet.add(globe);
  const ringParts=batch();
  for(let x=-25;x<=25;x++)for(let z=-25;z<=25;z++){
    const r=Math.hypot(x,z);if(r<19.5||r>25)continue;
    const band=Math.floor(r),color=band===20?0x667f87:band<23?0xa6b8b7:0xc5c8b9;
    ringParts.box(x*4,-3,z*4,3.86,1.1,3.86,((x*11+z*7)&63)===0?0xb7a68e:color);
  }
  const ring=ringParts.mesh(planetMaterial,'Tilted voxel ring bands');ring.rotation.set(.58,0,.60);ring.scale.setScalar(120/101.93);planet.add(ring);
  const moon=new THREE.Mesh(voxelSphere(24,3,[0x8fa5ab,0xc2caca,0xa1b4b4,0x718e99],11),planetMaterial);moon.name='Small quiet voxel satellite';moon.position.set(235,102,-720);group.add(moon);

  const lanes=[
    {type:0,center:[-235,61,35],rx:25,rz:55,phase:3.72,rate:.028,scale:2.0,bob:1.15},
    {type:1,center:[-203,75,-38],rx:30,rz:132,phase:4.12,rate:-.036,scale:1.28,bob:.75},
    {type:2,center:[68,79,-279],rx:111,rz:41,phase:2.15,rate:-.022,scale:1.6,bob:1.1},
    {type:3,center:[25,68,224],rx:185,rz:37,phase:1.3,rate:.019,scale:1.62,bob:.6},
  ];
  for(const lane of lanes){lane.ship=createShip(lane.type,shipMaterial,lightMaterial);lane.ship.scale.setScalar(lane.scale);group.add(lane.ship);}
  const stars=batch();let seed=1207;const rand=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<26;i++){
    const angle=rand()*TAU,distance=760+rand()*420,height=145+rand()*200,size=.65+rand()*.8;
    stars.box(Math.sin(angle)*distance,height,Math.cos(angle)*distance,size,size,size,i%5?0xacc9ce:0xd5d2bd);
  }
  const starMesh=stars.mesh(new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.52,depthWrite:false,toneMapped:false,fog:false}),'Sparse atmospheric star points');group.add(starMesh);
  function animate(time=0){
    // No object/vector allocations in the frame loop, and identical time reproduces the pose.
    globe.rotation.y=time*.004;moon.rotation.y=-time*.007;
    for(const lane of lanes){
      const a=time*lane.rate+lane.phase,s=Math.sin(a),c=Math.cos(a),ship=lane.ship;
      ship.position.set(lane.center[0]+c*lane.rx,lane.center[1]+Math.sin(time*.42+lane.phase)*lane.bob,lane.center[2]+s*lane.rz);
      const dx=-s*lane.rx*lane.rate,dz=c*lane.rz*lane.rate;
      ship.rotation.set(Math.sin(a*2)*.016,Math.atan2(dx,dz),Math.sin(a)*.025);
      ship.userData.plume.scale.x=ship.userData.plume.scale.y=.94+.06*Math.sin(time*7+lane.phase);
    }
  }
  animate(0);
  group.userData={mainPlanet:{position:planet.position.toArray(),radius:80,ringOuterRadius:120,ringRotation:[ring.rotation.x,ring.rotation.y,ring.rotation.z]},satellite:{position:moon.position.toArray(),radius:24},shipLanes:lanes.map(({type,center,rx,rz,scale,rate})=>({type,center,rx,rz,scale,periodSeconds:TAU/Math.abs(rate)})),starCount:26};
  return {group,animate};
}
