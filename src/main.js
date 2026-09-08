import * as THREE from 'three';
import {createTrack} from './track.js';
import {createWorld} from './world.js';
import {RaceGame,ITEM_LABELS,KART_ROAD_RADIUS} from './gameplay.js';
import {createKart,animateKart,createItemBox} from './voxel-assets.js';
import {GameAudio} from './audio.js';
import raceMusicTrack from './race-music-track.json';
import {assetUrl} from './asset-url.js';
import {createHUD} from './hud.js';
import {ChaseCameraControls} from './camera-controls.js';
import {createCinematicRenderer} from './cinematic-renderer.js';
import {MultiplayerClient} from './multiplayer.js';
import {createScreenControls} from './screen-controls.js';
import {createRacerReactionVisual} from './racer-reaction-visual.js';
import {createKartCrashVisual} from './kart-crash-visual.js';
import {createGroundImpactVisual} from './ground-impact-visual.js';
import {AdaptiveResolution} from './adaptive-resolution.js';
import {VehicleModelLibrary} from './vehicles/model-library.js';
import {availableVehicles,vehicleById,readVehicleChoice,saveVehicleChoice} from './vehicles/catalog.js';
import {createGarage} from './vehicles/garage.js';
import {createCountdownCamera,COUNTDOWN_HANDOFF_SECONDS} from './vehicles/countdown-camera.js';
import './style.css';
import './portrait.css';

const app=document.querySelector('#app');
const canvas=document.createElement('canvas');canvas.id='game-canvas';canvas.setAttribute('aria-label','首钢园未来城市像素赛车三维场景');canvas.tabIndex=0;app.append(canvas);
const track=createTrack(),game=new RaceGame({track}),sound=new GameAudio({volume:.4,music:{src:raceMusicTrack.src?assetUrl(raceMusicTrack.src):null,onState:status=>{app.dataset.music=status;}}});
const adaptive=new AdaptiveResolution(()=>resize());
let renderer,world,hud,cinematic,reactions,crashes,groundImpacts,garage,ready=false,quality='pixel',environmentStyle='voxel',voxelQuality='original',loadSequence=0,time=0,last=performance.now(),cameraMode=0,renderSizeKey='';
const vehicleLibrary=new VehicleModelLibrary(),introCamera=createCountdownCamera();
game.selectedModelId=readVehicleChoice();
const introCaption=document.createElement('div');introCaption.id='intro-caption';introCaption.hidden=true;
const keys=new Set();let onceItem=false,onceReset=false;
const input={throttle:0,brake:0,steer:0,drift:false,useItem:false,reset:false};
const boostAmount=v=>v.crash||v.grannyBlock||v.stun>0||v.finished||v.dnf?0:Math.max(v.boost>0?1:0,v.catchupBoost||0);
let networkRaceId=null;
const multiplayer=new MultiplayerClient({
  onChange:view=>{
    if(networkRaceId&&(!view.room||view.room.status==='waiting')){
      networkRaceId=null;reactions?.reset();game.playerId=0;game._reset('race');game.state.phase='menu';syncKarts();snapCamera();clearInputs();
    }
    hud?.setMultiplayer({...view,ready});
    app.dataset.multiplayer=String(view.open);app.dataset.room=view.room?.id||'';app.dataset.localPlayer=String(multiplayer.vehicleId);
  },
  onRace:message=>{
    if(networkRaceId!==message.raceId){
      networkRaceId=message.raceId;reactions?.reset();game._events=[];multiplayer.applyTo(game);syncKarts();snapCamera();clearInputs();canvas.focus();
    }
  }
});
function pauseRace(){if(multiplayer.inRace)multiplayer.pause(true);else game.pause();clearInputs();}
function resumeRace(){if(multiplayer.inRace)multiplayer.pause(false);else game.resume();clearInputs();canvas.focus();}
hud=createHUD({track,
  musicTitle:raceMusicTrack.title,musicReady:!!raceMusicTrack.src,
  onStart:mode=>{sound.unlock();if(!ready)return;if(availableVehicles().length)openGarage(id=>{selectVehicle(id);startRace(mode);});else startRace(mode);},
  onGarage:()=>openGarage(id=>selectVehicle(id)),
  onPause:pauseRace,onResume:resumeRace,
  onCamera:()=>{cameraMode=(cameraMode+1)%3;cameraControls.reset(cameraMode);hud.toast(['广角跟随镜头','园区俯瞰镜头','PV 近景镜头'][cameraMode]);},
  onRestart:()=>{if(multiplayer.inRace){multiplayer.action('lobby');return;}game.restart();syncKarts();snapCamera();keys.clear();canvas.focus();},
  onMenu:()=>{if(multiplayer.view.open){multiplayer.leave();return;}game.state.phase='menu';keys.clear();game.playerId=0;game._reset('race');syncKarts();snapCamera();},
  onMultiplayer:(action,payload)=>{
    if(['create','join'].includes(action)&&!ready)return;
    if(action==='open'&&availableVehicles().length){openGarage(id=>{selectVehicle(id);multiplayer.action(action,payload);});return;}
    if(action==='vehicle'){openGarage(id=>selectVehicle(id));return;}
    sound.unlock();clearInputs();multiplayer.action(action,payload);
  },
  onSettingsChange:settings=>{sound.setVolume(settings.volume);sound.setMusicVolume(settings.musicVolume);sound.setMuted(settings.muted);sound.unlock();resize();if(settings.environmentStyle!==environmentStyle||(settings.environmentStyle==='gaussian'&&settings.quality!==quality)||(settings.environmentStyle==='voxel'&&settings.voxelQuality!==voxelQuality))load(settings.quality,settings.environmentStyle,settings.voxelQuality);else{quality=settings.quality;voxelQuality=settings.voxelQuality;}},
  onMute:muted=>{sound.setMuted(muted);sound.unlock();},onReset:()=>{onceReset=true;},onItem:()=>{onceItem=true;},onRetry:()=>{if(world&&renderer&&!renderer.getContext().isContextLost())load(hud.settings.quality,hud.settings.environmentStyle,hud.settings.voxelQuality);else window.location.reload();}
});
sound.setVolume(hud.settings.volume);sound.setMuted(!!hud.settings.muted);
sound.setMusicVolume(hud.settings.musicVolume);
const camera=new THREE.PerspectiveCamera(68,innerWidth/innerHeight,.15,1800);
const cameraTarget=new THREE.Vector3(),cameraDesired=new THREE.Vector3();let cameraHeading=0;
const cameraControls=new ChaseCameraControls(canvas,{
  enabled:()=>ready&&!garage?.visible&&!hud.settingsOpen&&(!multiplayer.view.open||multiplayer.inRace)&&!['paused','finished','countdown'].includes(game.state.phase),
  onReset:()=>hud.toast('视角已恢复')
});
const karts=[],pickupObjects=[],hazardObjects=new Map();
const effects=[];const effectDummy=new THREE.Object3D();let effectMesh,shield;
let reactionRects=[],reactionRectsAt=-Infinity;
function reactionObstacles(){
  if(app.dataset.cleanView==='true')return [];
  const now=performance.now();if(now-reactionRectsAt<200)return reactionRects;reactionRectsAt=now;
  reactionRects=[];
  for(const selector of ['#race-stats','#race-item','#minimap','#mp-race-panel','.driving-hud','#guardian-alert','#boost-message','#hud-toast','#race-warning','.brand','.portrait-top','#portrait-status','#portrait-rankings','.portrait-dpad-wrap','.portrait-actions']){
    const node=document.querySelector(selector);if(!node||node.closest('[hidden]')||!node.getClientRects().length)continue;
    const r=node.getBoundingClientRect();if(r.width&&r.height)reactionRects.push({x:(r.left+r.right)/2,bottom:r.bottom,width:r.width,height:r.height});
  }
  return reactionRects;
}
try {
  createScreenControls(document.getElementById('game-hud'),message=>hud.toast(message));
  renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false,powerPreference:'high-performance'});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.AgXToneMapping;renderer.toneMappingExposure=1;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.info.autoReset=false;
  world=createWorld(renderer,track);
  garage=createGarage({app,library:vehicleLibrary,renderer,getEnvironment:()=>world.scene.environment,onVisibility:()=>clearInputs()});
  document.getElementById('game-hud').append(introCaption);
  cinematic=createCinematicRenderer(renderer,world.scene,camera);
  reactions=createRacerReactionVisual(track,{getObstacles:reactionObstacles});
  crashes=createKartCrashVisual(world.scene,track);
  groundImpacts=createGroundImpactVisual(world.scene,world.road,track);
  effectMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(.095,.095,.095),new THREE.MeshBasicMaterial({vertexColors:false,toneMapped:false}),420);
  effectMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);effectMesh.setColorAt(0,new THREE.Color(0xffffff));effectMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);effectMesh.frustumCulled=false;effectMesh.count=0;world.scene.add(effectMesh);
  shield=new THREE.Mesh(new THREE.IcosahedronGeometry(1.7,1),new THREE.MeshBasicMaterial({color:0x62f5ff,wireframe:true,transparent:true,opacity:.5,depthWrite:false}));world.scene.add(shield);
  syncKarts();createPickups();resize();snapCamera();load(hud.settings.quality,hud.settings.environmentStyle,hud.settings.voxelQuality);
  requestAnimationFrame(frame);
  if((new URLSearchParams(location.search).get('multiplayer')==='1'||multiplayer.view.invitedRoomId)&&!availableVehicles().length)multiplayer.open();
} catch(error){console.error(error);hud.setLoading(0,'3D 场景启动失败：'+error.message,true);}

async function load(nextQuality,nextStyle='voxel',nextVoxelQuality='original'){
  const request=++loadSequence;
  quality=nextQuality;environmentStyle=nextStyle;voxelQuality=nextVoxelQuality;ready=false;clearInputs();
  hud.setMultiplayer({ready:false});
  const message=nextStyle==='voxel'?(nextVoxelQuality==='original'?'正在还原园区细节…':'正在搭建像素首钢园…'):'正在载入园区实景…';
  hud.setLoading(0,message);
  try{
    const info=await world.loadEnvironment(nextQuality,p=>{if(request===loadSequence)hud.setLoading(p*.95,message);},nextStyle,nextVoxelQuality);
    if(!info||request!==loadSequence)return;
    hud.setLoading(.98,'正在预热赛车与特效…');
    await vehicleLibrary.warm(availableVehicles().map(v=>v.id),renderer,camera,world.scene);
    if(request!==loadSequence)return;syncKarts();
    // Replace old crash-wheel slots before compiling. Disposing their ring
    // materials during compileAsync can invalidate a pending shader program.
    crashes.update(game.state,karts);
    // Include zero-count particle pools and the hidden crater material probe.
    // Keep shader compilation out of the first collision/explosion frame.
    await renderer.compileAsync(world.scene,camera);
    reactions.prepare(game.state.vehicles);
    await renderer.compileAsync(reactions.scene,camera);
    if(request!==loadSequence)return;
    adaptive.reset();
    ready=true;hud.setReady(info);app.dataset.environmentStyle=info.environmentStyle;app.dataset.quality=info.quality;
    hud.setMultiplayer({ready:true});
    if((new URLSearchParams(location.search).get('multiplayer')==='1'||multiplayer.view.invitedRoomId)&&availableVehicles().length&&!multiplayer.view.open)openGarage(id=>{selectVehicle(id);multiplayer.open();});
    if(info.numSplats)app.dataset.gaussians=String(info.numSplats);else delete app.dataset.gaussians;
    if(info.numVoxels)app.dataset.voxels=String(info.numVoxels);else delete app.dataset.voxels;
    if(info.voxelQuality){app.dataset.voxelQuality=info.voxelQuality;app.dataset.voxelSize=String(info.voxelSize);}else{delete app.dataset.voxelQuality;delete app.dataset.voxelSize;}
  }catch(error){if(request!==loadSequence||error.name==='AbortError')return;console.error('Environment loading failed',error);hud.setLoading(0,'园区未能加载，请重试。',true);}
}

function selectVehicle(id){
  if(!vehicleById(id)?.available||!vehicleLibrary.has(id))throw new Error('赛车还未准备好。');
  game.selectedModelId=id;saveVehicleChoice(id);multiplayer.setModel(id);
  if(game.state.phase==='menu'&&!multiplayer.inRace){game.player.modelId=id;game.player.color=vehicleById(id).color;syncKarts();snapCamera();}
}
function openGarage(onConfirm){if(!garage||!ready||multiplayer.inRace)return;clearInputs();garage.open({onConfirm,initialId:readVehicleChoice()});}
function startRace(mode){game.playerId=0;game.start(mode);syncKarts();snapCamera();clearInputs();canvas.focus();}

function syncKarts(){
  if(!world)return;
  for(const kart of karts)kart.visible=false;
  for(const v of game.state.vehicles){
    const modelId=v.modelId&&vehicleLibrary.has(v.modelId)?v.modelId:null;
    if(!karts[v.id]||(karts[v.id].userData.modelId||null)!==modelId){
      if(karts[v.id])world.scene.remove(karts[v.id]);
      const kart=modelId?vehicleLibrary.create(modelId,{number:v.id===0?8:v.id+1}):createKart(THREE,{color:v.color,number:v.id===0?8:v.id+1});
      karts[v.id]=kart;world.scene.add(kart);
    }
    const kart=karts[v.id];kart.visible=true;kart.position.set(v.x,track.y+.009,v.z);kart.rotation.set(0,v.heading,0);
  }
}

function createPickups(){
  for(const p of game.pickups){
    let object;
    if(p.type==='item')object=createItemBox(THREE,p.id%2?0xf3be35:0x27bbb3);
    else if(p.type==='coin'){
      object=new THREE.Group();
      const coin=new THREE.Mesh(new THREE.TorusGeometry(.29,.095,4,8),new THREE.MeshStandardMaterial({color:0xffd452,emissive:0xf69c24,emissiveIntensity:.8,metalness:.6,roughness:.3}));object.add(coin);
      const spark=new THREE.Mesh(new THREE.BoxGeometry(.14,.14,.14),new THREE.MeshBasicMaterial({color:0xfff1a4}));object.add(spark);
    }else{
      object=new THREE.Group();
      const floor=new THREE.Mesh(new THREE.BoxGeometry(3.6,.07,2.8),new THREE.MeshBasicMaterial({color:0x247763}));object.add(floor);
      for(let i=0;i<3;i++){
        for(const s of [-1,1]){const part=new THREE.Mesh(new THREE.BoxGeometry(1.2,.09,.18),new THREE.MeshBasicMaterial({color:0xffe17a}));part.position.set(s*.48,.055,-.9+i*.65);part.rotation.y=s*.5;object.add(part);}
      }
      const d=track.getTangent(p.t);object.rotation.y=Math.atan2(d.x,d.z);
    }
    object.position.set(p.x,track.y+(p.type==='boost'?.055:1.02),p.z);object.userData.baseY=object.position.y;world.scene.add(object);pickupObjects[p.id]=object;
  }
}

function updatePickups(dt){
  for(const p of game.pickups){const obj=pickupObjects[p.id];obj.visible=p.active;
    if(p.type!=='boost'){obj.position.y=obj.userData.baseY+Math.sin(time*2.8+p.id)*.13;obj.rotation.y=time*(p.type==='coin'?2:.7)+p.id;}
  }
  const activeIds=new Set();
  for(const h of game.hazards){activeIds.add(h.id);let mesh=hazardObjects.get(h.id);
    if(!mesh){mesh=new THREE.Group();for(let i=0;i<3;i++){const m=new THREE.Mesh(new THREE.BoxGeometry(.18,.17,.64),new THREE.MeshStandardMaterial({color:0xffe850,emissive:0xb27018,emissiveIntensity:.6}));m.rotation.y=i*Math.PI*2/3;m.position.y=.16;mesh.add(m);}world.scene.add(mesh);hazardObjects.set(h.id,mesh);}
    mesh.position.set(h.x,track.y+.08,h.z);
  }
  for(const [id,mesh] of hazardObjects)if(!activeIds.has(id)){world.scene.remove(mesh);mesh.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});hazardObjects.delete(id);}
}

function burst(x,y,z,color,count=12,speed=3){
  for(let i=0;i<count;i++){if(effects.length>=420)effects.shift();effects.push({x,y,z,vx:(Math.random()-.5)*speed,vy:Math.random()*speed*.8,vz:(Math.random()-.5)*speed,life:.3+Math.random()*.4,max:.7,color,size:.05+Math.random()*.11});}
}

function updateEffects(dt){
  const p=game.player;
  if(game.state.phase==='racing'&&Math.abs(p.speed)>5){
    const s=Math.sin(p.heading),c=Math.cos(p.heading);
    if(p.drift||boostAmount(p)>.05){const color=boostAmount(p)>.05?0x31d6da:p.driftCharge>1.3?0xff884a:0x35b5e7;for(const side of [-1,1])burst(p.x-s*1.12+c*.7*side,track.y+.18,p.z-c*1.12-s*.7*side,color,2,2.5);}
  }
  let idx=0;
  for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.life-=dt;if(e.life<=0){effects.splice(i,1);continue;}e.vy-=dt*6;e.x+=e.vx*dt;e.y=Math.max(track.y+.025,e.y+e.vy*dt);e.z+=e.vz*dt;effectDummy.position.set(e.x,e.y,e.z);effectDummy.scale.setScalar(e.size/.095*Math.min(1,e.life/.2));effectDummy.rotation.set(time,time*.4,e.x);effectDummy.updateMatrix();effectMesh.setMatrixAt(idx,effectDummy.matrix);effectMesh.setColorAt(idx,new THREE.Color(e.color));idx++;}
  effectMesh.count=idx;effectMesh.instanceMatrix.needsUpdate=true;if(effectMesh.instanceColor)effectMesh.instanceColor.needsUpdate=true;
  shield.visible=p.shield>0&&!p.crash;shield.position.set(p.x,track.y+1,p.z);shield.rotation.y=time;shield.material.opacity=.28+Math.sin(time*8)*.1;
}

function processEvents(){
  const audioNames={'race-start':'go','item-used':'item','drift-boost':'driftBoost','race-finished':'finish'};
  for(const e of game.drainEvents()){
    if(e.type==='granny-hit'||e.type==='granny-clear'){
      reactions?.suppress(e.vehicleId,game.state.elapsed+1);
      if(e.vehicleId===game.player.id||Math.hypot(game.player.x-e.x,game.player.z-e.z)<22)sound.event(e.type);
      continue;
    }
    groundImpacts?.impactEvent(e,game.state);
    if(e.type==='reset'||e.type==='kong-grab')reactions?.suppress(e.vehicleId,game.state.elapsed+2);
    if(e.type==='kong-warning'||e.type==='kong-grab'){
      if(Math.hypot(game.player.x-e.x,game.player.z-e.z)<45)sound.event(e.type);
      continue;
    }
    if(e.type==='kart-crash'||e.type==='kart-respawn'){
      reactions?.suppress(e.vehicleId,game.state.elapsed+1);
      if(e.vehicleId===game.player.id||Math.hypot(game.player.x-e.x,game.player.z-e.z)<45)sound.event(e.type);
      if(e.type==='kart-crash'&&e.sourceId===game.player.id)hud.toast('高速追尾！对手被撞飞');
      if(e.type==='kart-respawn'&&e.vehicleId===game.player.id)hud.toast('已回到赛道 · 短暂保护');
      continue;
    }
    if(e.type==='robot-missile-launch'||e.type==='robot-missile-impact'){
      if(e.targetId===game.player.id||Math.hypot(game.player.x-e.aim.x,game.player.z-e.aim.z)<70)sound.event(e.type);
      continue;
    }
    if(e.type==='robot-warning'||e.type==='robot-strike'){
      const nearby=Math.hypot(game.player.x-e.aim.x,game.player.z-e.aim.z)<65;
      if(nearby)sound.event(e.type);
      continue;
    }
    if(e.vehicleId!==undefined&&e.vehicleId!==game.player.id)continue;
    sound.event({...e,type:audioNames[e.type]||e.type,count:e.value});
    const p=game.player;
    if(e.type==='pickup'){burst(p.x,track.y+1,p.z,e.kind==='coin'?0xffd865:0x73fef3,16);if(p.item)hud.toast(`${ITEM_LABELS[p.item]}  ·  按 E 使用`);}
    if(e.type==='drift-boost')hud.toast(e.level>1?'超级漂移！涡轮释放':'漂亮漂移！');
    if(e.type==='item-used')hud.toast(`${ITEM_LABELS[e.item]||'道具'}已启动`);
    if(e.type==='lap')hud.toast(`第 ${Math.min(p.lap,game.state.totalLaps)} 圈 · ${p.lap===game.state.totalLaps?'最后冲刺！':'继续加油！'}`);
    if(e.type==='collision'||e.type==='hit'||e.type==='hazard-hit')burst(p.x,track.y+.5,p.z,0xffb46b,18,4);
    if(e.type==='robot-hit'){burst(p.x,track.y+.7,p.z,0xffa46b,26,5);hud.toast(e.kind==='missile'?'导弹命中！继续加速，避开准心':'被巨像击中！短暂失速，继续加速');}
    if(e.type==='shield-block'&&e.sourceKind==='robot')hud.toast('护盾挡住了巨像攻击！');
    if(e.type==='shield-block'&&e.sourceKind==='ram')hud.toast('护盾挡住了追尾撞击！');
    if(e.type==='shield-block'&&e.sourceKind==='kong')hud.toast('护盾挡住了金刚的抓取！');
    if(e.type==='reset')hud.toast('已回到赛道');
    if(e.type==='finish'){for(let i=0;i<12;i++)burst(p.x+(Math.random()-.5)*8,track.y+5+Math.random()*5,p.z+(Math.random()-.5)*8,i%2?0xff64cc:0x60edfc,16,6);saveBest();}
  }
}

function saveBest(){if(game.state.multiplayer)return;try{const key=`shougang-best-${track.version||'v1'}-${game.state.totalLaps}laps`,old=JSON.parse(localStorage.getItem(key)||'null');if(!old||game.state.elapsed<old.time)localStorage.setItem(key,JSON.stringify({time:game.state.elapsed,bestLap:game.player.bestLap}));}catch{}}

function readInput(){
  const touch=hud.touchInput;
  const editing=document.activeElement?.matches('input,select,textarea');
  input.throttle=editing?0:Math.max(Number(keys.has('KeyW')||keys.has('ArrowUp')),Number(touch.throttle)||0);
  input.brake=editing?0:Math.max(Number(keys.has('KeyS')||keys.has('ArrowDown')),Number(touch.brake)||0);
  input.steer=editing?0:THREE.MathUtils.clamp(Number(keys.has('KeyA')||keys.has('ArrowLeft'))-Number(keys.has('KeyD')||keys.has('ArrowRight'))-(Number(touch.steer)||0),-1,1);
  input.drift=!editing&&(keys.has('Space')||touch.drift);input.useItem=keys.has('KeyE')||touch.useItem||onceItem;input.reset=keys.has('KeyR')||touch.reset||onceReset;
  if(hud.settings.assist&&input.throttle&&game.state.phase==='racing'){
    const p=game.player;
    // Assist affects steering only; pedals always preserve the player's input.
    // Start inside the usable kart-center corridor, before the hard boundary.
    const assistEdge=Math.max(0,track.width*.5-KART_ROAD_RADIUS)*.8;
    const n=track.closest(p.x,p.z),tangent=track.getTangent(p.progress);
    const delta=Math.atan2(Math.sin(Math.atan2(tangent.x,tangent.z)-p.heading),Math.cos(Math.atan2(tangent.x,tangent.z)-p.heading));
    if(Math.abs(n.signedDistance)>assistEdge&&Math.abs(delta)<1.3)input.steer=THREE.MathUtils.clamp(input.steer+THREE.MathUtils.clamp(delta*1.4-n.signedDistance*.08,-.45,.45),-1,1);
  }
  onceItem=onceReset=false;return input;
}

function clearInputs(){keys.clear();onceItem=onceReset=false;cameraControls?.cancel();hud?.releaseTouches();Object.assign(input,{throttle:0,brake:0,steer:0,drift:false,useItem:false,reset:false});multiplayer.releaseInput();}

function snapCamera(){if(!world)return;cameraHeading=game.player.heading;cameraControls.reset(cameraMode,true);updateCamera(10);}
function updateCamera(dt){
  const vehicle=game.player,p=vehicle.crash?{...vehicle,x:vehicle.crash.x,z:vehicle.crash.z,heading:vehicle.crash.heading}:vehicle,menu=game.state.phase==='menu';
  const delta=Math.atan2(Math.sin(p.heading-cameraHeading),Math.cos(p.heading-cameraHeading));cameraHeading+=delta*(1-Math.exp(-dt*5));
  const forward=new THREE.Vector3(Math.sin(cameraHeading),0,Math.cos(cameraHeading));
  const right=new THREE.Vector3(forward.z,0,-forward.x),position=new THREE.Vector3(p.x,track.y,p.z);
  const orbit=cameraControls.update(dt),dist=Math.cos(orbit.pitch)*orbit.radius,high=Math.sin(orbit.pitch)*orbit.radius;
  const orbitForward=new THREE.Vector3(Math.sin(cameraHeading+orbit.yaw),0,Math.cos(cameraHeading+orbit.yaw));
  cameraDesired.copy(position).addScaledVector(orbitForward,-dist-boostAmount(p)*.7);cameraDesired.y+=high;
  const kongCrash=vehicle.crash?.sourceKind==='kong'?vehicle.crash:null;
  // A gentle sideways view keeps the lift and thrown kart visible beside Kong's torso.
  if(kongCrash){cameraDesired.addScaledVector(right,kongCrash.side*13);cameraDesired.y=Math.max(cameraDesired.y,track.y+11);}
  if(menu)cameraDesired.addScaledVector(right,-1.2+Math.sin(time*.13)*.2);
  camera.position.lerp(cameraDesired,1-Math.exp(-dt*7));
  cameraTarget.copy(position).addScaledVector(forward,(cameraMode===2?2.5:cameraMode===1?11:8)*Math.max(0,Math.cos(orbit.yaw)));cameraTarget.y+=cameraMode===2?1.1:cameraMode===1?3.5:4;
  if(kongCrash)cameraTarget.set(kongCrash.holdOrigin.x,track.y+5,kongCrash.holdOrigin.z).addScaledVector(forward,1.5);
  if(menu&&innerWidth>780)cameraTarget.addScaledVector(right,3.1);
  const intro=game.state.phase==='countdown'||game.state.phase==='paused'&&game.state.countdown>0;
  const raceTime=game.state.renderTime??game.state.elapsed;
  const handoff=!intro&&['racing','paused'].includes(game.state.phase)&&game.state.countdown===0&&raceTime<COUNTDOWN_HANDOFF_SECONDS;
  const fov=(cameraMode===2?48:cameraMode===1?64:68)+boostAmount(p)*5;
  // Hide the last numeral in the same frame as the layout changes, rather than
  // letting the throttled HUD briefly move "1" into the centre of the picture.
  if(handoff)document.getElementById('countdown').hidden=true;
  app.dataset.intro=String(intro);introCaption.hidden=!intro;
  app.dataset.cameraHandoff=String(handoff);
  if(intro||handoff){
    const shot=introCamera.apply(camera,p,game.state.countdown,track.y,cameraDesired,cameraTarget,fov,intro?0:raceTime);
    if(intro){
      document.getElementById('countdown').textContent=String(Math.max(1,Math.ceil(game.state.countdown)));
      introCaption.textContent=vehicleById(p.modelId)?.name||'首钢园 · 即刻出发';
    }
    app.dataset.introShot=String(shot.index+1);app.dataset.introDetail=shot.label;return;
  }
  delete app.dataset.introShot;delete app.dataset.introDetail;
  camera.lookAt(cameraTarget);
  camera.fov=THREE.MathUtils.lerp(camera.fov,fov,1-Math.exp(-dt*4));camera.updateProjectionMatrix();
}

function resize(){
  if(!renderer)return;
  adaptive.setEnabled(hud.settings.adaptiveQuality!==false);
  const mobile=matchMedia('(pointer: coarse)').matches||innerWidth<=760;
  const pixel=Number(hud.settings.pixelSize)||1,ratio=Math.min(mobile?1.25:1.5,devicePixelRatio||1)/pixel*adaptive.scale;
  const film=hud.settings.renderQuality!=='performance';
  const key=`${innerWidth}:${innerHeight}:${ratio}:${film}`;
  if(key===renderSizeKey)return;renderSizeKey=key;
  renderer.setPixelRatio(ratio);renderer.setSize(innerWidth,innerHeight,false);
  canvas.style.width='100%';canvas.style.height='100%';canvas.style.imageRendering=pixel>1?'pixelated':'auto';
  camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();
  cinematic?.setEnabled(film);cinematic?.resize(innerWidth,innerHeight,ratio);
  world?.setRenderQuality?.(film,mobile);world?.resize?.(innerWidth,innerHeight);
  app.dataset.renderQuality=film?'cinematic':'performance';
  app.dataset.renderScale=adaptive.scale.toFixed(2);
}
window.addEventListener('resize',resize);
window.addEventListener('keydown',e=>{
  if(garage?.visible)return;
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)&&!e.target.matches('input,select,textarea'))e.preventDefault();
  keys.add(e.code);if(e.repeat)return;
  if(e.code==='Escape'&&!e.target.matches('input,select,textarea')&&(!multiplayer.view.open||multiplayer.inRace)){
    if(multiplayer.inRace){multiplayer.view.paused?resumeRace():pauseRace();}else{game.togglePause();clearInputs();}
  }
  if(e.code==='KeyC'&&cameraControls.enabled()&&!e.target.matches('input,select,textarea')){cameraMode=(cameraMode+1)%3;cameraControls.reset(cameraMode);hud.toast(['广角跟随镜头','园区俯瞰镜头','PV 近景镜头'][cameraMode]);}
  if(e.code==='KeyH'&&!e.target.matches('input,select,textarea')){app.dataset.cleanView=app.dataset.cleanView==='true'?'false':'true';}
});
window.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('blur',()=>{clearInputs();if(!multiplayer.view.open)game.pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInputs();if(!multiplayer.view.open)game.pause();}});
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();pauseRace();ready=false;hud.setMultiplayer({ready:false});hud.setLoading(0,'显卡上下文已暂停，请重新载入游戏。',true);});

let fpsTimer=0,frames=0,hudTimer=0;
function frame(now){
  requestAnimationFrame(frame);
  if((!ready||garage?.visible||game.state.phase==='menu')&&now-last<1000/30)return;
  const realDt=(now-last)/1000,dt=Math.min(realDt,.15);last=now;if(document.hidden)return;time+=dt;
  // Loading owns scene replacement and shader compilation. Keep the displayed
  // scene still until its materials and model rigs have finished warming.
  if(!ready){renderer.info.reset();renderer.render(world.scene,camera);return;}
  if(garage?.visible){renderer.info.reset();garage.render(dt);return;}
  if(multiplayer.inRace){
    multiplayer.queueInput(ready&&!hud.settingsOpen&&!multiplayer.view.paused?readInput():{throttle:0,brake:0,steer:0,drift:false,useItem:false,reset:false});
    multiplayer.applyTo(game,now);
  }else if(ready&&!multiplayer.view.open)game.update(dt,readInput());
  processEvents();syncKarts();
  for(const v of game.state.vehicles){const kart=karts[v.id];kart.rotation.y=v.heading+(v.drift?v.steering*.10:0);animateKart(kart,{speed:v.speed,steer:v.steering,drift:v.drift,time,boost:boostAmount(v)>.05},dt);}
  crashes.update(game.state,karts);
  updatePickups(dt);updateEffects(dt);world.update(time,game.state.robot,game.state.kong,game.state.granny);updateCamera(dt);
  groundImpacts.update(game.state);
  world.updateOcclusion(camera,game.player);
  if(hudTimer+dt>.065)app.dataset.kong=JSON.stringify(world.kong.stats);
  if(hudTimer+dt>.065){app.dataset.granny=JSON.stringify(world.granny.stats);app.dataset.grannyBlocked=String(!!game.player.grannyBlock);}
  sound.update({speed:game.player.speed,throttle:input.throttle,drift:game.player.drift,boost:boostAmount(game.player),phase:game.player.crash||game.player.grannyBlock?'crashed':game.state.phase,musicPhase:game.state.phase},dt);
  renderer.info.reset();
  world.prepareRender?.(camera,game.player,time);
  cinematic.render(dt,{focus:Math.hypot(camera.position.x-game.player.x,camera.position.y-track.y-1,camera.position.z-game.player.z),closeup:cameraMode===2,phase:game.state.phase});
  reactions.update({...game.state,localPlayerId:game.player.id},camera,innerWidth,innerHeight);reactions.render(renderer,camera);
  if(hudTimer+dt>.065){app.dataset.groundImpacts=JSON.stringify(groundImpacts.stats);app.dataset.crashEffects=JSON.stringify(crashes.stats);app.dataset.crashed=String(!!game.player.crash);app.dataset.reactionCount=String(reactions.visible.length);app.dataset.reactions=JSON.stringify(reactions.visible);canvas.setAttribute('aria-description',reactions.visible.map(r=>`${r.name}：${r.face} ${r.text}`).join('；'));}
  hudTimer+=dt;if(hudTimer>.065){hudTimer=0;hud.update(game.state,game.player);hud.drawMap(game.state.vehicles,game.state.robot,game.player.id);app.dataset.phase=game.state.phase;app.dataset.lap=String(game.player.lap);app.dataset.speed=String(game.state.speedKmh);app.dataset.robotPhase=game.state.robot?.phase||'idle';app.dataset.robotAttack=String(game.state.robot?.attackId||0);app.dataset.missileRound=String(game.state.robot?.barrage?.round||0);app.dataset.missileCount=String(game.state.robot?.barrage?.missiles.length||0);}
  fpsTimer+=realDt;frames++;if(fpsTimer>1){const fps=Math.round(frames/fpsTimer);hud.setFPS(fps);app.dataset.fps=String(fps);app.dataset.drawCalls=String(renderer.info.render.calls);app.dataset.cameraYaw=cameraControls.yaw.toFixed(3);app.dataset.cameraPitch=cameraControls.pitch.toFixed(3);app.dataset.cameraDistance=cameraControls.radius.toFixed(2);app.dataset.trackLength=track.length.toFixed(2);frames=0;fpsTimer=0;}
  adaptive.sample(realDt*1000,ready&&game.state.phase==='racing'&&!hud.settingsOpen);
}
