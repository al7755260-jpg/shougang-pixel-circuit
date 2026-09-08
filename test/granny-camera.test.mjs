import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createGrannyCamera} from '../src/granny-camera.js';
import {createTrack} from '../src/track.js';

function fixture(aspect=16/9){
  const track=createTrack(),p=track.getPoint(.09),t=track.getTangent(.09);
  const vehicle={id:0,x:p.x,z:p.z,heading:Math.atan2(t.x,t.z)};
  const granny={phase:'sitting',time:5,at:5,hitId:1,targetId:0,front:{x:p.x+t.x*2.25,z:p.z+t.z*2.25}};
  const camera=new THREE.PerspectiveCamera(68,aspect,.15,1800);
  const chase=p.clone().addScaledVector(t,-18);chase.y+=12;
  const target=p.clone().addScaledVector(t,8);target.y+=4;
  camera.position.copy(chase);camera.lookAt(target);
  const shot=createGrannyCamera();
  return {track,vehicle,granny,camera,chase,target,shot,apply:(phase='racing')=>shot.apply(camera,vehicle,granny,phase,track,chase,target,68)};
}
test('a pedestrian collision changes only the struck player camera and resets between races',()=>{
  const f=fixture(),original=f.camera.position.clone();f.granny.targetId=1;
  assert.equal(f.apply(),false);assert(f.camera.position.equals(original));
  f.granny.targetId=0;assert(f.apply());f.granny.time=5.4;f.apply();assert.equal(f.shot.stats.stage,'closeup');
  assert.equal(f.apply('menu'),false);assert.equal(f.shot.stats.active,false);
  f.granny.time=f.granny.at=0;assert(f.apply());assert.equal(f.shot.stats.stage,'entering');
});
test('closeup starts without a cut, freezes on pause and returns continuously to a moving kart',()=>{
  const f=fixture(),position=f.camera.position.clone(),rotation=f.camera.quaternion.clone();
  f.apply();assert(f.camera.position.equals(position));assert(f.camera.quaternion.angleTo(rotation)<1e-7);assert.equal(f.camera.fov,68);
  f.granny.time=5.5;f.apply();position.copy(f.camera.position);rotation.copy(f.camera.quaternion);
  for(let i=0;i<60;i++)f.apply('paused');assert(f.camera.position.equals(position));assert(f.camera.quaternion.angleTo(rotation)<1e-7);
  f.granny.phase='returning';f.granny.at=6;f.granny.time=6.2;f.apply();assert.equal(f.shot.stats.stage,'returning');
  f.chase.x+=3;f.target.x+=3;f.granny.time=6.649;f.apply();
  assert(f.camera.position.distanceTo(f.chase)<.00001);assert(Math.abs(f.camera.fov-68)<.00001);
  f.granny.time=6.65;assert.equal(f.apply(),false);assert.equal(f.shot.stats.active,false);
});
for(const aspect of [16/9,390/844])test(`closeup keeps the seated face and dialogue inside the frame at aspect ${aspect}`,()=>{
  const f=fixture(aspect);f.apply();f.granny.time=5.45;f.apply();f.camera.updateMatrixWorld(true);
  const {x,z}=f.granny.front;
  for(const y of [f.track.y+.3,f.track.y+1.8,f.track.y+3.08]){
    const projected=new THREE.Vector3(x,y,z).project(f.camera);
    assert(Math.abs(projected.x)<.78);assert(Math.abs(projected.y)<.8);assert(projected.z>-1&&projected.z<1);
  }
  const bubbleCenter=new THREE.Vector3(x,f.track.y+2.56,z).applyMatrix4(f.camera.matrixWorldInverse);
  const visibleWidth=2*-bubbleCenter.z*Math.tan(THREE.MathUtils.degToRad(50/2))*aspect;
  assert(2.05<visibleWidth*.85,'dialogue should leave space beside both screen edges');
});
