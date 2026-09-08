import test from 'node:test';
import assert from 'node:assert/strict';
import {RaceGame} from '../src/gameplay.js';
import {createTrack} from '../src/track.js';
import {KONG} from '../src/kong-encounter.js';
import {CRASH,crashPose} from '../src/kart-crash.js';
import {kongHandPose} from '../src/kong-motion.js';
import {encodeSnapshot} from '../server/snapshot-codec.js';
const track=createTrack();
function race(){const g=new RaceGame({track,multiplayer:true});g.start();g.state.phase='racing';g.state.elapsed=10;return g;}
test('Kong chases and throws multiple racers on the actual road, with bounded recovery',()=>{
 const g=new RaceGame({track,multiplayer:true});g.setHumanPlayers([]);g.start();const events=[];let maxTravel=0,previous={...g.state.kong};
 for(let i=0;i<60*180;i++){
  g.update(1/60);events.push(...g.drainEvents());const k=g.state.kong;
  maxTravel=Math.max(maxTravel,Math.hypot(k.x-previous.x,k.z-previous.z));previous={...k};
  assert(Number.isFinite(k.heading));assert(Math.abs(track.closest(k.x,k.z).signedDistance)<=1.51);
 }
 assert(events.filter(e=>e.type==='kong-throw').length>=3);
 assert(new Set(events.filter(e=>e.type==='kong-grab').map(e=>e.vehicleId)).size>=3);
 assert(maxTravel<1);assert(events.some(e=>e.type==='kart-respawn'));
});
test('shield prevents grab; held kart cannot accelerate, reset or gain progress',()=>{
 const g=race(),p=g.player,k=g.state.kong;k.time=10;
 p.shield=2;assert.equal(g._kongGrab(p,k),false);assert.equal(p.crash,null);assert.equal(p.shield,0);
 const progress=p.progress;assert.equal(g._kongGrab(p,k),true);
 const c=p.crash;assert.equal(c.duration,KONG.grab+CRASH.seconds);
 const expected=kongHandPose(c.holdOrigin,.5),pose=crashPose(c,c.at+KONG.grab*.5);
 assert.equal(pose.held,true);assert(Math.abs(pose.x-expected.x)<.001);assert(Math.abs(pose.y-expected.y)<.001);
 g.update(.1,{throttle:1,reset:true,useItem:true});assert.equal(p.progress,progress);assert.equal(p.speed,0);assert.equal(p.crash.id,c.id);
 g.state.elapsed=c.at+c.duration-.001;g._updateCrash(p);assert(p.crash);
 g.state.elapsed=c.at+c.duration+.001;g._updateCrash(p);assert.equal(p.crash,null);assert.equal(p.progress,progress);assert(p.respawnProtection>0);
 assert(Math.abs(track.closest(p.x,p.z).signedDistance)<=track.width/2-1.55+.01);
});
test('throw begins at the palms, ends outside the road and remains wire-compatible',()=>{
 const g=race(),p=g.player;g._kongGrab(p,g.state.kong);const c=p.crash;
 const before=crashPose(c,c.at+KONG.grab-1e-6),after=crashPose(c,c.at+KONG.grab);
 assert(Math.hypot(before.x-after.x,before.y-after.y,before.z-after.z)<.002);assert.equal(after.held,false);
 assert(Math.abs(track.closest(c.endX,c.endZ).signedDistance)>track.width/2);
 const packet=JSON.parse(encodeSnapshot({game:g,raceId:'kong'},g.state,[],1000));
 assert.equal(packet.state.kong.phase,g.state.kong.phase);assert.equal(packet.state.vehicles[0].crash.sourceKind,'kong');
 const ram={...c,duration:CRASH.seconds,grabDuration:0,releaseX:undefined,releaseZ:undefined,releaseY:undefined};
 assert.equal(crashPose(ram,c.at).y,0);assert.equal(crashPose(ram,c.at).held,false);
});
test('menu and paused states freeze Kong; restarting clears the encounter',()=>{
 const g=race(),k=g.state.kong;g.kongEncounter.update(.1,g.state.vehicles,'racing',10);
 const frozen=JSON.stringify(k);g.kongEncounter.update(10,g.state.vehicles,'paused',20);assert.equal(JSON.stringify(k),frozen);
 g.kongEncounter.update(10,g.state.vehicles,'menu',30);assert.equal(JSON.stringify(k),frozen);
 g.start();assert.equal(g.state.kong.throws,0);assert.equal(g.state.kong.phase,'idle');assert(g.state.vehicles.every(v=>!v.crash));
});
