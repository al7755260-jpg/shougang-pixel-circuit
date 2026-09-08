import test from 'node:test';import assert from 'node:assert/strict';
import {RaceGame} from '../src/gameplay.js';import {createTrack} from '../src/track.js';
import {GRANNY,GRANNY_CROSSINGS,GrannyEncounter,crossingContact,granniesForState,interpolateGrannies} from '../src/granny-encounter.js';
import {isRearImpact} from '../src/kart-crash.js';import {encodeSnapshot} from '../server/snapshot-codec.js';
const track=createTrack();
function race(){const g=new RaceGame({track,aiCount:0});g.start('practice');g.state.phase='racing';return g;}
test('swept pedestrian contact catches fast karts and allows a clean lane dodge',()=>{
 assert.equal(crossingContact({_stepX:-12,_stepZ:0,x:12,z:0},{x:0,z:0},{x:0,z:0}),.5);
 assert.equal(crossingContact({_stepX:-12,_stepZ:3,x:12,z:3},{x:0,z:0},{x:0,z:0}),null);
});
test('the encounter holds the seated position and clears after two seconds',()=>{
 const hits=[],events=[];const e=new GrannyEncounter({track,onHit:v=>{hits.push(v.id);return true;},onEvent:(type,event)=>events.push({type,...event})});
 Object.assign(e.state,{phase:'crossing',lane:0,x:e.center.x,z:e.center.z});
 const t=track.getTangent(GRANNY.progress),car={id:0,x:e.center.x,z:e.center.z,speed:60,heading:Math.atan2(t.x,t.z)};
 e.update(1/60,[car,{...car,id:1}],'racing',2);assert.deepEqual(hits,[0]);assert.equal(e.state.phase,'sitting');
 e.update(1.5,[car],'racing',3.5);assert.equal(e.state.phase,'sitting');assert.equal(hits.length,1);
 assert.equal(e.state.x,e.state.front.x);assert.equal(e.state.z,e.state.front.z);
 e.update(.48,[car],'racing',3.98);assert.equal(e.state.phase,'sitting');
 e.update(.02,[car],'racing',4);assert.equal(e.state.phase,'returning');assert.equal(events.filter(e=>e.type==='granny-clear').length,1);
});
for(const hz of [30,60,120])test(`a collision locks position for exactly two seconds at ${hz} Hz`,()=>{
 const g=race(),p=g.player;g.state.elapsed=2;p.speed=30;const tangent=track.getTangent(p.progress);p._vx=tangent.x*30;p._vz=tangent.z*30;p.item='boost';p.shield=5;
 g._stopForGranny(p,g.state.granny);const {x,z,progress,coins}=p;
 for(let i=1;i<2*hz;i++){
  g.update(1/hz,{throttle:1,steer:1,reset:true,useItem:true});assert(p.grannyBlock);assert.equal(p.x,x);assert.equal(p.z,z);assert.equal(p.speed,0);assert.equal(p.progress,progress);
  g._robotHit(p,{aim:{x:x+2,z:z+2},kind:'slam'});assert.equal(p.x,x);assert.equal(p.z,z);assert.equal(g._kongGrab(p,g.state.kong),false);
 }
 assert.equal(p.item,'boost');assert.equal(p.coins,coins);assert(p.shield>0);assert.equal(p.crash,null);
 g.update(1/hz,{throttle:1});assert.equal(p.grannyBlock,null);assert(p.speed>0);assert(Math.hypot(p.x-x,p.z-z)>0);
});
test('pause preserves the remaining stop and restart removes the event',()=>{
 const g=race();g._stopForGranny(g.player,g.state.granny);g.update(.1,{});g.pause();const at=g.state.elapsed;g.update(1,{});assert.equal(g.state.elapsed,at);assert(g.player.grannyBlock);g.resume();g.restart();assert.equal(g.player.grannyBlock,null);assert.equal(g.state.granny.hits,0);assert.equal(g.state.granny.phase,'waiting');
});
test('stopped karts cannot be rammed and the room snapshot carries the same stop',()=>{
 const g=race();g._stopForGranny(g.player,g.state.granny);assert.equal(isRearImpact({grannyBlock:{}},{}),false);
 const packet=JSON.parse(encodeSnapshot({game:g,raceId:'granny'},g.state,[],0));assert.equal(packet.state.vehicles[0].grannyBlock.until,2);assert.equal(packet.state.granny.phase,'waiting');
});
test('the crossing repeats during normal AI racing',()=>{
 const g=new RaceGame({track,multiplayer:true});g.setHumanPlayers([]);g.start();let hits=0;const crossings=new Set();
 for(let i=0;i<10800;i++){g.update(1/60);for(const e of g.drainEvents())if(e.type==='granny-hit'){hits++;crossings.add(e.crossingId);}}
 assert(hits>=3);assert.equal(crossings.size,3);assert(g.state.vehicles.every(v=>Number.isFinite(v.x)&&Number.isFinite(v.z)));
});

test('three crossings independently stop different karts and serialize all three pedestrians',()=>{
 const g=new RaceGame({track,aiCount:2});g.start();g.state.phase='racing';g.state.elapsed=3;
 g.state.robot.barrage.nextRoundAt=999;g.state.robot.cooldown=999;Object.assign(g.state.kong,{x:1000,z:1000,phase:'recover',at:999});
 assert.equal(g.state.grannies.length,3);
 for(const [i,s] of g.state.grannies.entries()){
  const p=track.getPoint(s.progress),t=track.getTangent(s.progress),v=g.state.vehicles[i];
  Object.assign(s,{phase:'crossing',lane:0,x:p.x,z:p.z});
  Object.assign(v,{x:p.x,z:p.z,heading:Math.atan2(t.x,t.z),progress:s.progress,_lastT:s.progress,speed:24,_vx:t.x*24,_vz:t.z*24});
 }
 g.update(1/60,{throttle:1});const events=g.drainEvents().filter(e=>e.type==='granny-hit');
 assert.deepEqual(events.map(e=>[e.crossingId,e.vehicleId]),[[0,0],[1,1],[2,2]]);
 for(const [i,s] of g.state.grannies.entries()){
  assert.equal(s.phase,'sitting');assert.equal(s.targetId,i);assert.equal(g.state.vehicles[i].grannyBlock.crossingId,i);
 }
 for(let i=0;i<90;i++)g.update(1/60,{throttle:1});
 assert(g.state.vehicles.every(v=>v.grannyBlock&&v.speed===0));
 const state=JSON.parse(encodeSnapshot({game:g},g.state,[],0)).state;
 assert.equal(state.grannies.length,3);assert.deepEqual(state.grannies.map(s=>s.targetId),[0,1,2]);assert.deepEqual(state.granny,state.grannies[0]);
 g.pause();const paused=JSON.stringify(g.state.grannies);g.update(1,{});assert.equal(JSON.stringify(g.state.grannies),paused);g.resume();
 for(let i=0;i<30;i++)g.update(1/60,{throttle:1});
 assert(g.state.vehicles.every(v=>!v.grannyBlock&&v.speed>0));assert(g.state.grannies.every(s=>s.phase==='returning'));
 g.restart();assert(g.state.grannies.every(s=>s.hits===0&&s.targetId===null&&s.phase==='waiting'));
});

test('each grandmother waits for traffic approaching her own straight crossing',()=>{
 for(const crossing of GRANNY_CROSSINGS){
  const e=new GrannyEncounter({track,crossing});
  const car={id:0,progress:crossing.progress-.15};e.update(1/60,[car],'racing',3);assert.equal(e.state.phase,'waiting');
  car.progress=crossing.progress-20/track.length;e.update(1/60,[car],'racing',3.1);assert.equal(e.state.phase,'crossing');
  assert(track.getTangent(crossing.progress-.015).dot(track.getTangent(crossing.progress+.015))>.999);
 }
});

test('snapshot interpolation preserves separate granny identities, targets and clocks',()=>{
 const g=race(),from=g.state.grannies.map((s,i)=>({...s,x:i*100,z:i*50,phase:'crossing'}));
 const to=from.map((s,i)=>({...s,x:s.x+2,z:s.z+4,phase:i===1?'sitting':'crossing',targetId:i===1?1:null,hitId:i===1?1:0})).reverse();
 const halfway=interpolateGrannies(from,to,.5,7.5);
 for(const s of halfway){assert.equal(s.x,s.crossingId*100+1);assert.equal(s.z,s.crossingId*50+2);assert.equal(s.time,7.5);assert.equal(s.phase,'crossing');}
 const end=interpolateGrannies(from,to,1,8);assert.equal(end.find(s=>s.crossingId===1).targetId,1);assert.equal(end.find(s=>s.crossingId===0).targetId,null);
 assert.equal(granniesForState({granny:from[0]}).length,1);assert.deepEqual(granniesForState({}),[]);
});
