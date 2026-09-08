import test from 'node:test';import assert from 'node:assert/strict';
import {RaceGame} from '../src/gameplay.js';import {createTrack} from '../src/track.js';
import {CRATERS,ImpactCraters,craterContact,craterScale} from '../src/impact-craters.js';
import {CRASH,crashPose} from '../src/kart-crash.js';import {encodeSnapshot} from '../server/snapshot-codec.js';
const track=createTrack();
function race(){const g=new RaceGame({track,aiCount:0});g.start('practice');g.state.phase='racing';g.state.countdown=0;g.state.elapsed=5;g.state.robot.barrage.time=5;g.state.robot.barrage.nextRoundAt=999;g.state.robot.cooldown=999;g.state.granny.nextAt=999;Object.assign(g.state.kong,{x:1000,z:1000,phase:'recover',at:999});return g;}
function missile(g){const v=g.player,b=g.state.robot.barrage;b.missiles=[{attackId:'missile-test',kind:'missile',radius:1.3,aim:{x:v.x,y:track.y,z:v.z},origin:{x:0,y:25,z:0},launchAt:4,impactAt:b.time+1/60,impacted:false,launched:true}];}
function pit(g,{id='pit-test',x=g.player.x,z=g.player.z,at=g.state.elapsed,radius=2}={}){const c={id,kind:'slam',x,y:track.y,z,at,expiresAt:at+CRATERS.lifetime,radius};g.state.craters.push(c);return c;}
test('an actual missile landing burns the car and retains its pit after the barrage expires',()=>{
 const g=race(),progress=g.player.progress;missile(g);g.update(1/60,{});const c=g.player.crash;
 assert.equal(c.mode,'burn');assert.equal(c.sourceKind,'missile');assert.equal(g.player.speed,0);assert.equal(g.player.progress,progress);
 assert.equal(g.state.craters.length,1);assert.equal(g.state.craters[0].id,'missile-test');assert(g.drainEvents().some(e=>e.type==='kart-crash'&&e.sourceKind==='missile'));
 for(let i=0;i<50;i++)g.update(1/60,{});assert.equal(g.state.robot.barrage.missiles.length,0);assert.equal(g.state.craters.length,1);assert(g.player.crash);
});
test('burning locks control/progress for 1.5 seconds and restores a protected car',()=>{
 const g=race();missile(g);g.update(1/60,{});const c=g.player.crash,progress=g.player.progress;
 for(let i=0;i<80;i++)g.update(1/60,{throttle:1,steer:1,reset:true,useItem:true});assert.equal(g.player.crash.id,c.id);assert.equal(g.player.progress,progress);assert.equal(g.player.speed,0);
 const pose=crashPose(c,c.at+.65);assert(pose.y<0);assert(Math.hypot(pose.x-c.x,pose.z-c.z)<1);assert.equal(pose.held,false);
 g.state.elapsed=c.at+CRASH.seconds;g._updateCrash(g.player);assert.equal(g.player.crash,null);assert.equal(g.player.progress,progress);assert(g.player.respawnProtection>0);assert(Math.abs(track.closest(g.player.x,g.player.z).signedDistance)<track.width/2-1.55+.01);
});
test('shielded missile contact is not applied again as a simultaneous pit hit',()=>{
 const g=race();g.player.shield=5;missile(g);g.update(1/60,{});assert.equal(g.player.shield,0);assert.equal(g.player.crash,null);
 for(let i=0;i<10;i++)g.update(1/60,{});assert.equal(g.player.crash,null);assert.equal(g.drainEvents().filter(e=>e.type==='shield-block').length,1);
});
test('driving into an active pit burns a car; moving clear of the rim does not',()=>{
 const g=race(),p=g.player,t=track.getTangent(p.progress),c=pit(g,{x:p.x+t.x*2.8,z:p.z+t.z*2.8});p.speed=25;p._vx=t.x*25;p._vz=t.z*25;
 g.update(1/60,{throttle:1});assert.equal(p.crash?.sourceKind,'crater');assert.equal(p.crash.sourceId,c.id);
 const safe=race(),v=safe.player,n=track.getNormal(v.progress);pit(safe,{x:v.x+n.x*4,z:v.z+n.z*4});safe.update(1/60,{throttle:1});assert.equal(v.crash,null);
});
test('pit contact uses swept motion, shrinks with the visual fade and ends exactly at expiry',()=>{
 const c={id:'pit',x:0,z:0,radius:2,at:10,expiresAt:36},fast={_stepX:-12,_stepZ:0,x:12,z:0};
 assert.equal(craterContact(c,fast,12),.5);assert.equal(craterContact(c,{...fast,_stepZ:4,z:4},12),null);assert.equal(craterScale(c,9.9),0);
 const edge={x:1.4,z:0};assert.notEqual(craterContact(c,edge,30),null);assert.equal(craterScale(c,35),.25);assert.equal(craterContact(c,edge,35),null);
 assert.equal(craterContact(c,{x:0,z:0},36),null);assert.equal(craterContact(c,fast,37),null);
 const g=race();pit(g,{at:g.state.elapsed-CRATERS.lifetime});g.update(1/60,{throttle:1});assert.equal(g.player.crash,null);assert.equal(g.state.craters.length,0);
});
test('each car has its own entry contact; leaving and re-entering can trigger again',()=>{
 const field=new ImpactCraters();field.records.push({id:'pit',x:0,z:0,radius:2,at:0,expiresAt:26});const hits=[],cars=[{id:0,x:0,z:0},{id:1,x:0,z:0}];
 field.update(1,cars,v=>hits.push(v.id));field.update(2,cars,v=>hits.push(v.id));assert.deepEqual(hits,[0,1]);
 cars[0].x=10;field.update(3,cars,v=>hits.push(v.id));cars[0].x=0;field.update(4,cars,v=>hits.push(v.id));assert.deepEqual(hits,[0,1,0]);
});
test('evicted pits cannot leave invisible hazards; authoritative snapshots retain active pits',()=>{
 const g=race(),v=g.player;
 for(let i=0;i<=CRATERS.max;i++)g.craterField.add({type:'robot-strike',attackId:i,kind:'slam',radius:2,aim:{x:v.x+i*10,y:track.y,z:v.z}},g.state);
 assert.equal(g.state.craters.length,CRATERS.max);g.update(1/60,{});assert.equal(v.crash,null);
 const packet=JSON.parse(encodeSnapshot({game:g,raceId:'crater'},g.state,[],0));assert.equal(packet.state.craters.length,CRATERS.max);assert(packet.state.craters.every(c=>c.expiresAt===c.at+CRATERS.lifetime));
});
test('pausing freezes pit expiry and restarting removes the hazards',()=>{
 const g=race();pit(g,{x:g.player.x+20});g.pause();g.update(30,{});assert.equal(g.state.elapsed,5);assert.equal(g.state.craters.length,1);g.restart();assert.deepEqual(g.state.craters,[]);assert.equal(g.player.crash,null);
});
