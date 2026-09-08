import test from 'node:test';
import assert from 'node:assert/strict';
import {SnapshotClock} from '../src/snapshot-clock.js';
import {encodeSnapshot,compactNumber} from '../server/snapshot-codec.js';
import {RaceGame} from '../src/gameplay.js';
import {createTrack} from '../src/track.js';
import {roomInviteUrl,inviteAddresses} from '../src/room-invite.js';

test('jittered packet arrivals never rewind the playback clock or jump a car forward',()=>{
  const clock=new SnapshotClock(),packets=[];
  for(let i=0;i<100;i++)packets.push({server:i*50,arrival:i*50+[40,60,105,45,75][i%5]});
  packets.sort((a,b)=>a.arrival-b.arrival);let last=null,previousServer=-1,maxStep=0;
  for(let now=0;now<5000;now+=16){
    while(packets.length&&packets[0].arrival<=now){const packet=packets.shift();if(packet.server>previousServer){clock.push(packet.server,now);previousServer=packet.server;}}
    const time=clock.sample(now);if(time===null)continue;
    if(last!==null){assert(time>=last);maxStep=Math.max(maxStep,time-last);}
    last=time;
  }
  assert(maxStep<=22);assert(clock.delay>=65&&clock.delay<=150);
  clock.reset();assert.equal(clock.sample(0),null);
});

test('static pickup layout is sent once while collection and respawn stay exact',()=>{
  const pickups=[{id:0,x:1.234567,z:8.123456,type:'coin',active:true,respawn:0},{id:1,x:5,z:3,type:'box',active:true,respawn:0}];
  const room={game:{pickups,hazards:[]},raceId:'one'};
  let packet=JSON.parse(encodeSnapshot(room,{},[],0));assert.equal(packet.pickups.length,2);
  pickups[0].active=false;pickups[0].respawn=7.5;
  packet=JSON.parse(encodeSnapshot(room,{},[{type:'pickup'}],50));assert(!packet.pickups);assert.deepEqual(packet.pickupStates,[[0,7.5]]);assert.equal(packet.events.length,1);
  pickups[0].active=true;pickups[0].respawn=0;
  packet=JSON.parse(encodeSnapshot(room,{},[],100));assert.deepEqual(packet.pickupStates,[]);assert.deepEqual(packet.events,[]);
  room.snapshotSequence=99;assert(JSON.parse(encodeSnapshot(room,{},[],5000)).pickups);
  room.snapshotSequence=0;assert(JSON.parse(encodeSnapshot(room,{},[],0)).pickups);
});

test('wire precision stays below 0.1 mm, without rounding lap progress too far',()=>{
  for(const n of [-41.128376,0.123456789,79.382098,Math.PI])assert(Math.abs(compactNumber('x',n)-n)<=.00005);
  assert(Math.abs(compactNumber('progress',.812345678)-.812345678)<=.0000005);
  assert.equal(compactNumber('vehicleId',5),5);
});

test('solo and online races finish on lap six; practice remains unlimited',()=>{
  for(const multiplayer of [false,true]){const game=new RaceGame({track:createTrack(),multiplayer});game.start();for(let lap=1;lap<=6;lap++){game.state.elapsed=lap*30;game._completeLap(game.player);assert.equal(game.player.finished,lap===6);}assert.equal(game.state.totalLaps,6);}
  const practice=new RaceGame({track:createTrack()});practice.start('practice');for(let i=0;i<7;i++)practice._completeLap(practice.player);assert(!practice.player.finished);
});

test('room invitations retain the GitHub Pages project path',()=>{
  assert.equal(roomInviteUrl('https://example.github.io/racing/?v=old','ABC123'),'https://example.github.io/racing/?multiplayer=1&room=ABC123');
  assert.equal(roomInviteUrl('javascript:alert(1)','ABC123'),'');
  assert.equal(new URL(roomInviteUrl('https://example.github.io/racing/?server=https%3A%2F%2Ftest.trycloudflare.com','ABC123')).searchParams.get('server'),'https://test.trycloudflare.com');
});

test('public room invitations prefer a direct live endpoint and retain the old page fallback',()=>{
  const page='https://example.github.io/racing/?v=old',direct='https://example.github.io/racing/?server=https%3A%2F%2Flive.trycloudflare.com';
  const addresses=inviteAddresses(['http://192.168.1.2:4199/',direct],page,'ABC123');
  assert.equal(new URL(addresses[0]).searchParams.get('server'),'https://live.trycloudflare.com');
  assert.equal(new URL(addresses[0]).searchParams.get('room'),'ABC123');
  assert(addresses.includes('https://example.github.io/racing/?multiplayer=1&room=ABC123'));
  assert.equal(new URL(inviteAddresses(['http://192.168.1.2:4199/'],page,'ABC123')[0]).hostname,'example.github.io');
});
