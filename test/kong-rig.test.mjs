import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {kongHandPose} from '../src/kong-motion.js';

// Exercise the shipped skin and animations, without browser-only texture decoding.
const file=await fs.readFile(new URL('../public/assets/kong/kong.glb',import.meta.url));
const jsonLength=file.readUInt32LE(12),json=JSON.parse(file.toString('utf8',20,20+jsonLength));
delete json.images;delete json.textures;delete json.materials;
for(const mesh of json.meshes)for(const p of mesh.primitives)delete p.material;
let encoded=Buffer.from(JSON.stringify(json));encoded=Buffer.concat([encoded,Buffer.alloc((4-encoded.length%4)%4,32)]);
const binary=file.subarray(20+jsonLength),header=Buffer.alloc(20);
header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+encoded.length+binary.length,8);header.writeUInt32LE(encoded.length,12);header.writeUInt32LE(0x4e4f534a,16);
const buffer=Buffer.concat([header,encoded,binary]);
const gltf=await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),'');
const mixer=new THREE.AnimationMixer(gltf.scene),bones=new Map(),skins=[];
gltf.scene.traverse(o=>{if(o.isBone)bones.set(o.name,o);if(o.isSkinnedMesh)skins.push(o);});
const clips=new Map(gltf.animations.map(c=>[c.name.split('|').at(-1),c]));
function sample(name,u){
  mixer.stopAllAction();const clip=clips.get(name),action=mixer.clipAction(clip);action.reset().play();action.paused=true;
  const first=Math.min(...clip.tracks.map(t=>t.times[0]));action.time=first+(clip.duration-first)*u;
  mixer.update(0);gltf.scene.updateMatrixWorld(true);for(const skin of skins)skin.skeleton.update();
}
const position=name=>bones.get(name).getWorldPosition(new THREE.Vector3());

test('the shipped gorilla has normalized skin weights and keeps rigid bone lengths',()=>{
  assert.deepEqual([...clips.keys()].sort(),['Grab','Idle','Run','Throw']);assert.equal(skins.length,1);
  const weights=skins[0].geometry.attributes.skinWeight;
  for(let i=0;i<weights.count;i++)assert(Math.abs(weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i)-1)<.0001);
  for(const name of clips.keys())for(let f=0;f<=60;f++){
    sample(name,f/60);
    for(const bone of bones.values()){
      const scale=bone.getWorldScale(new THREE.Vector3());assert(scale.toArray().every(v=>Number.isFinite(v)&&Math.abs(v-1)<.001),`${name}: stretched ${bone.name}`);
    }
  }
});
test('grab palms stay on the existing network car trajectory throughout the lift',()=>{
  for(let frame=0;frame<=140;frame++){
    const u=frame/140;sample('Grab',u);
    const center=position('LHand').add(position('RHand')).multiplyScalar(.5);
    const expected=kongHandPose({x:0,z:0,heading:0},u);
    assert(center.distanceTo(new THREE.Vector3(expected.x,expected.y+.4,expected.z))<.006,`palm contact at ${u}`);
  }
});
test('running keeps a support foot planted and swings opposite arms and legs',()=>{
  let covariance=0;
  for(let frame=0;frame<=120;frame++){
    sample('Run',frame/120);const left=position('LFoot'),right=position('RFoot');
    assert(Math.abs(Math.min(left.y,right.y)-.42)<.02,`floating support foot at ${frame}`);
    covariance+=(left.z-right.z)*(position('LHand').z-position('RHand').z);
  }
  assert(covariance<0,'arms must counter-swing, not follow the same-side leg');
});
test('loop seams and the held-car release do not snap or flip joints',()=>{
  const snapshot=()=>new Map([...bones].map(([n,b])=>[n,{p:position(n),q:b.getWorldQuaternion(new THREE.Quaternion())}]));
  for(const [from,to] of [['Idle','Idle'],['Run','Run'],['Grab','Throw']]){
    sample(from,1);const last=snapshot();sample(to,0);
    for(const [name,b] of bones){assert(position(name).distanceTo(last.get(name).p)<.005,`${from}->${to}: ${name} position`);assert(b.getWorldQuaternion(new THREE.Quaternion()).angleTo(last.get(name).q)<.005,`${from}->${to}: ${name} rotation`);}
  }
  for(const clip of clips.keys()){
    sample(clip,0);let previous=snapshot();
    for(let frame=1;frame<=120;frame++){
      sample(clip,frame/120);const current=snapshot();
      for(const [name,b] of current)assert(b.q.angleTo(previous.get(name).q)<.35,`${clip}: ${name} flipped at ${frame}`);
      previous=current;
    }
  }
});
