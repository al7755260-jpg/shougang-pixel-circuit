import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {assetUrl} from './asset-url.js';
import {GRANNY,GRANNY_CROSSINGS} from './granny-encounter.js';

let modelPromise;
function loadModel(){return modelPromise??=new GLTFLoader().loadAsync(assetUrl('/assets/granny/granny.glb')).catch(error=>{modelPromise=null;throw error;});}

function signTexture(bubble=false){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=bubble?224:512;const c=canvas.getContext('2d');
  c.fillStyle=bubble?'#fffef7':'#f8edca';c.strokeStyle='#294454';c.lineWidth=14;
  c.beginPath();c.roundRect(10,10,492,bubble?182:492,18);c.fill();c.stroke();
  if(bubble){c.beginPath();c.moveTo(218,190);c.lineTo(248,218);c.lineTo(276,190);c.fill();c.stroke();c.fillStyle='#294454';c.font='bold 49px "Microsoft YaHei",sans-serif';c.textAlign='center';c.fillText('小伙子!扶我一把',256,115);}
  else{
    c.fillStyle='#e2a64c';c.beginPath();c.moveTo(256,46);c.lineTo(439,351);c.lineTo(73,351);c.closePath();c.fill();
    c.fillStyle='#294454';c.fillRect(232,117,49,49);c.fillRect(228,177,47,91);
    for(const [x,y,w,h] of [[194,191,42,22],[174,211,25,51],[271,212,52,23],[215,258,28,39],[194,292,29,36],[269,258,27,51],[292,303,29,30]])c.fillRect(x,y,w,h);
    c.font='bold 56px "Microsoft YaHei",sans-serif';c.textAlign='center';c.fillText('礼让行人',256,440);
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
export function createGrannyVisual(track,spec=GRANNY_CROSSINGS[0]){
  const group=new THREE.Group();group.name=spec.name+' · 奶奶过街';
  const p=track.getPoint(spec.progress),t=track.getTangent(spec.progress),yaw=Math.atan2(t.x,t.z);
  const crossing=new THREE.Group();crossing.position.set(p.x,track.y+.025,p.z);crossing.rotation.y=yaw;group.add(crossing);
  const stripes=[];
  for(let x=-track.width/2+.6;x<track.width/2-.2;x+=1.12){const g=new THREE.BoxGeometry(.62,.025,3.4);g.translate(x,0,0);stripes.push(g);}
  const markings=new THREE.Mesh(mergeGeometries(stripes),new THREE.MeshStandardMaterial({color:0xeee8d0,roughness:.95,metalness:0}));markings.receiveShadow=true;crossing.add(markings);stripes.forEach(g=>g.dispose());
  const poles=[],lamps=[],signs=[];const tex=signTexture();
  for(const side of [-1,1]){
    const pole=new THREE.BoxGeometry(.14,2.8,.14);pole.translate(side*(track.width/2+1),1.4,-2.1);poles.push(pole);
    const light=new THREE.Mesh(new THREE.BoxGeometry(.26,.18,.26),new THREE.MeshBasicMaterial({color:0xffc65a,toneMapped:false}));light.position.set(side*(track.width/2+1),2.89,-2.1);crossing.add(light);lamps.push(light);
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(.95,.95),new THREE.MeshStandardMaterial({map:tex,roughness:1,side:THREE.DoubleSide}));sign.position.set(side*(track.width/2+1),2.38,-2.01);crossing.add(sign);signs.push(sign);
  }
  const posts=new THREE.Mesh(mergeGeometries(poles),new THREE.MeshStandardMaterial({color:0x608a84,roughness:.83}));posts.castShadow=true;crossing.add(posts);poles.forEach(g=>g.dispose());
  crossing.traverse(o=>{o.updateMatrix();o.matrixAutoUpdate=false;});
  const body=new THREE.Group();body.visible=false;group.add(body);
  const bubble=new THREE.Sprite(new THREE.SpriteMaterial({map:signTexture(true),transparent:true,depthWrite:false,toneMapped:false}));bubble.scale.set(2.05,.9,1);bubble.visible=false;group.add(bubble);
  const dust=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0xd4c5a5,roughness:1,transparent:true,depthWrite:false}),8);
  dust.instanceMatrix.setUsage(THREE.DynamicDrawUsage);dust.frustumCulled=false;dust.visible=false;group.add(dust);
  const dustDummy=new THREE.Object3D();
  let loading,mixer,actions={};const stats={crossingId:spec.id,progress:spec.progress,loaded:false,phase:'waiting',hits:0,model:'Rodin'};
  function load(){return loading??=loadModel().then(gltf=>{
    // Share geometry/textures, but give every pedestrian her own bones and mixer.
    const model=clone(gltf.scene);body.add(model);model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;}});
    mixer=new THREE.AnimationMixer(model);for(const clip of gltf.animations){const a=mixer.clipAction(clip);a.play();a.paused=true;actions[clip.name]=a;}
    for(const name of ['Idle','Walk','Sit'])if(!actions[name])throw new Error('奶奶动作缺失：'+name);
    stats.loaded=true;return stats;
  }).catch(e=>{loading=null;throw e;});}
  function update(s){
    body.visible=!!s&&!!mixer;bubble.visible=false;dust.visible=false;stats.dialogue='';stats.dust=0;if(!s||!mixer)return;
    Object.assign(stats,{phase:s.phase,hits:s.hits,targetId:s.targetId,x:s.x,z:s.z});
    body.position.set(s.x,track.y+.015,s.z);body.rotation.y=s.heading;
    const age=Math.max(0,s.time-s.at),walking=s.phase==='crossing'||s.phase==='returning',sitting=s.phase==='sitting';
    // A short recoil, quick drop and small rebound make the existing rig read
    // as a comic plop, without moving her feet below the road or extending the stop.
    const standAt=GRANNY.blockSeconds-GRANNY.standSeconds;
    const sitAmount=sitting?(age<standAt?THREE.MathUtils.smoothstep(age,.07,.23):1-THREE.MathUtils.smoothstep(age,standAt,GRANNY.blockSeconds)):0;
    const recoil=sitting&&age<.13?Math.sin(age/.13*Math.PI):0;
    const rebound=sitting&&age>=.23&&age<.38?Math.sin((age-.23)/.15*Math.PI):0;
    body.position.y+=.07*recoil+.065*rebound;body.rotation.x=-.055*recoil;
    stats.sitAmount=sitAmount;
    for(const [name,a] of Object.entries(actions)){
      a.setEffectiveWeight(name==='Sit'?Number(sitting):name==='Walk'?Number(walking):Number(!sitting&&!walking));
      const duration=a.getClip().duration-1/30;a.time=1/30+(name==='Sit'?sitAmount*duration:name==='Walk'?(s.stride/.85*duration)%duration:s.time%duration);
    }
    mixer.update(0);body.updateMatrixWorld(true);
    if((sitting&&age>=.19)||(s.phase==='returning'&&s.targetId!==null&&age<.3)){
      bubble.visible=true;stats.dialogue='小伙子!扶我一把';
      bubble.position.set(s.x,track.y+3.2-.64*sitAmount,s.z);
      const pop=.82+.18*(sitting?THREE.MathUtils.smoothstep(age,.19,.29):1);
      bubble.scale.set(2.05*pop,.9*pop,1);
      bubble.material.opacity=s.phase==='returning'?1-THREE.MathUtils.smoothstep(age,.1,.3):1;
    }
    if(sitting&&age>=.23&&age<.58){
      const u=(age-.23)/.35;dust.visible=true;stats.dust=8;dust.material.opacity=(1-u)*.7;
      for(let i=0;i<8;i++){
        const a=i*Math.PI/4,r=.3+u*.65;
        dustDummy.position.set(s.x+Math.cos(a)*r,track.y+.09+Math.sin(u*Math.PI)*.18,s.z+Math.sin(a)*r);
        dustDummy.rotation.set(i*.4+u,0,i*.7);dustDummy.scale.setScalar((.12+(i%3)*.035)*(1-u*.7));dustDummy.updateMatrix();dust.setMatrixAt(i,dustDummy.matrix);
      }
      dust.instanceMatrix.needsUpdate=true;
    }
    for(const lamp of lamps)lamp.material.color.setHex(s.phase==='waiting'?0x85b4a2:Math.sin(s.time*10)>0?0xffbb45:0x976c3a);
  }
  return {group,markings,load,update,stats};
}
