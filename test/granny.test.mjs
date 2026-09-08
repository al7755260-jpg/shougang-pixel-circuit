import test from 'node:test';import assert from 'node:assert/strict';
import {RaceGame} from '../src/gameplay.js';import {createTrack} from '../src/track.js';
import {GRANNY,GrannyEncounter,crossingContact} from '../src/granny-encounter.js';
import {isRearImpact} from '../src/kart-crash.js';import {encodeSnapshot} from '../server/snapshot-codec.js';
const track=createTrack();
function race(){const g=new RaceGame({track,aiCount:0});g.start('practice');g.state.phase='racing';return g;}
test('swept pedestrian contact catches fast karts and allows a clean lane dodge',()=>{
 assert.equal(crossingContact({_stepX:-12,_stepZ:0,x:12,z:0},{x:0,z:0},{x:0,z:0}),.5);
 assert.equal(crossingContact({_stepX:-12,_stepZ:3,x:12,z:3},{x:0,z:0},{x:0,z:0}),null);
});
test('the encounter hits one kart once, then clears after one second',()=>{
 const hits=[],events=[];const e=new GrannyEncounter({track,onHit:v=>{hits.push(v.id);return true;},onEvent:(type,event)=>events.push({type,...event})});
 Object.assign(e.state,{phase:'crossing',lane:0,x:e.center.x,z:e.center.z});
 const t=track.getTangent(GRANNY.progress),car={id:0,x:e.center.x,z:e.center.z,speed:60,heading:Math.atan2(t.x,t.z)};
 e.update(1/60,[car,{...car,id:1}],'racing',2);assert.deepEqual(hits,[0]);assert.equal(e.state.phase,'sitting');
 e.update(.98,[car],'racing',2.98);assert.equal(e.state.phase,'sitting');assert.equal(hits.length,1);
 e.update(.02,[car],'racing',3);assert.equal(e.state.phase,'returning');assert.equal(events.filter(e=>e.type==='granny-clear').length,1);
});
for(const hz of [30,60,120])test(`a collision locks position for exactly one second at ${hz} Hz`,()=>{
 const g=race(),p=g.player;g.state.elapsed=2;p.speed=30;const tangent=track.getTangent(p.progress);p._vx=tangent.x*30;p._vz=tangent.z*30;p.item='boost';p.shield=5;
 g._stopForGranny(p,g.state.granny);const {x,z,progress,coins}=p;
 for(let i=1;i<hz;i++){
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
 const packet=JSON.parse(encodeSnapshot({game:g,raceId:'granny'},g.state,[],0));assert.equal(packet.state.vehicles[0].grannyBlock.until,1);assert.equal(packet.state.granny.phase,'waiting');
});
test('the crossing repeats during normal AI racing',()=>{
 const g=new RaceGame({track,multiplayer:true});g.setHumanPlayers([]);g.start();let hits=0;
 for(let i=0;i<10800;i++){g.update(1/60);hits+=g.drainEvents().filter(e=>e.type==='granny-hit').length;}
 assert(hits>=2);assert(g.state.vehicles.every(v=>Number.isFinite(v.x)&&Number.isFinite(v.z)));
});
