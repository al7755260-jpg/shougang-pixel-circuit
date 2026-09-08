import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {ROBOT_SITE,ROBOT_HEIGHT} from './robot-config.js';
import {createRobotMissiles} from './robot-missile-visual.js';

const C={steel:0xaac1cb,blue:0x385f73,cream:0xdde7e6,dark:0x1f3644,joint:0x314d5d,chrome:0xa9c8d0,cyan:0x87e6ee,magenta:0xefa75b,yellow:0xf4c174};
const UP=new THREE.Vector3(0,1,0),TAU=Math.PI*2;
const clamp=THREE.MathUtils.clamp;
const ease=p=>{p=clamp(p,0,1);return p*p*(3-2*p);};

// Each moving part is a single vertex-coloured mesh, regardless of block count.
function batch(){
  const geometries=[];
  return {
    box(x,y,z,w,h,d,color,rotation=0){
      const g=new THREE.BoxGeometry(w,h,d);if(rotation)g.rotateZ(rotation);g.translate(x,y,z);
      const c=new THREE.Color(color),a=new Float32Array(g.attributes.position.count*3);
      for(let i=0;i<a.length;i+=3){a[i]=c.r;a[i+1]=c.g;a[i+2]=c.b;}
      g.setAttribute('color',new THREE.BufferAttribute(a,3));geometries.push(g);
    },
    mesh(material,name){
      const g=mergeGeometries(geometries,false);for(const source of geometries)source.dispose();
      const mesh=new THREE.Mesh(g,material);mesh.name=name;mesh.castShadow=false;mesh.receiveShadow=true;return mesh;
    },
  };
}
function glyphs(b,text,x,y,z,size,color){
  const glyph={S:['111','100','111','001','111'],G:['111','100','101','101','111'],'-':['000','000','111','000','000'],'0':['111','101','101','101','111'],'1':['010','110','010','010','111']};
  [...text].forEach((ch,i)=>(glyph[ch]||[]).forEach((row,j)=>[...row].forEach((v,k)=>{if(v==='1')b.box(x+(i*4+k)*size,y-j*size,z,size*.82,size*.82,.075,color);})));
}
function add(parent,b,material,name){const mesh=b.mesh(material,name);parent.add(mesh);return mesh;}

/** SG-01: original block-built guardian; receives authoritative attack phase time. */
export function createParkRobot(){
  const group=new THREE.Group();group.name='SG-01 · 首钢园守园机甲';group.position.set(ROBOT_SITE.x,ROBOT_SITE.y,ROBOT_SITE.z);
  const missiles=createRobotMissiles();group.add(missiles.group);
  const machine=new THREE.Group();machine.name='34m articulated guardian';const scale=ROBOT_HEIGHT/33.03;machine.scale.setScalar(scale);machine.rotation.y=Math.PI;machine.position.y=-.925*scale;group.add(machine);
  const solid=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.48,metalness:.25});
  const emissive=new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false});
  const base=batch(),baseLight=batch();
  const foundationHeight=Math.max(.9,(ROBOT_SITE.y+.3)/scale);
  base.box(0,.925-foundationHeight/2,0,11.8/scale,foundationHeight,9.8/scale,C.dark);
  base.box(0,.58,0,11.5,.30,9.6,C.blue);base.box(0,.81,0,11.3,.17,8.8,C.steel);
  for(const s of [-1,1]){
    base.box(s*5.5,.47,0,.42,.82,9.4,C.joint);baseLight.box(s*5.52,.91,0,.19,.085,9.1,C.cyan);
    for(let i=0;i<5;i++)base.box(s*5.5,.95,-4+i*2,.48,.13,.65,i%2?C.dark:C.yellow);
  }
  for(let i=0;i<9;i++)baseLight.box(-5.2+i*1.3,.90,4.43,.68,.05,.19,i%3?C.cyan:C.yellow);
  add(machine,base,solid,'Grounded maintenance plinth');add(machine,baseLight,emissive,'Plinth status lights');

  const legs=batch(),legLight=batch();
  for(const s of [-1,1]){
    const x=s*3.15;
    legs.box(x,1.85,1.15,4.6,1.85,6.8,C.dark);legs.box(x,2.30,1.65,4.35,1.55,6.0,C.steel);
    legs.box(x,2.62,3.56,4.15,.82,1.25,C.cream);legs.box(x,1.78,4.38,4.15,.48,.24,C.joint);
    for(let i=0;i<4;i++)legs.box(x-1.52+i*1.02,2.85,4.2,.48,.36,.22,C.dark);
    legs.box(x,5.55,-.25,2.5,5.2,2.7,C.joint);legs.box(x,5.7,1.05,3.2,5.5,1.25,C.steel);
    legs.box(x,6.3,1.75,2.28,3.30,.22,C.cream);legLight.box(x,6.2,1.91,.27,2.45,.12,C.cyan);
    legs.box(x,9.25,.12,3.32,2.0,3.2,C.dark);legs.box(x,9.3,1.91,2.85,1.55,.65,C.cream);
    legs.box(x,12.0,0,2.65,4.3,3.0,C.blue);legs.box(x+s*1.35,11.55,.1,.55,3.0,2.05,C.steel);
    legs.box(x,12.35,1.53,2.9,2.9,.55,C.steel);
    for(let i=0;i<4;i++)legs.box(x+s*1.45,4.55+i*.83,-.4,.3,.23,2.6,C.chrome);
    for(const t of [-1,1])legs.box(x+t*1.54,8.5,1.83,.24,.27,.24,C.yellow);
  }
  legs.box(0,14.3,0,8.9,2.0,4.6,C.dark);legs.box(0,14.85,2.36,7.9,1.38,.55,C.steel);
  for(const s of [-1,1])legs.box(s*3.25,13.4,2.03,2.1,2.5,.85,C.blue,s*-.12);
  add(machine,legs,solid,'Boots, pistons and articulated leg armour');add(machine,legLight,emissive,'Shin power conduits');

  const torso=batch(),torsoLight=batch();
  torso.box(0,19.3,-.3,8.05,8.1,4.5,C.dark);torso.box(0,21.15,0,10.15,5.8,5.3,C.steel);
  torso.box(0,24.30,-.1,9.3,.72,4.7,C.cream);torso.box(0,22.84,2.86,8.9,1.45,.65,C.cream);
  torso.box(0,18.98,2.83,6.75,4.7,.7,C.blue);torso.box(0,16.8,2.65,6.8,.73,.82,C.steel);
  for(const s of [-1,1]){
    torso.box(s*4.3,19.45,1.52,1.28,4.2,2.7,C.blue,s*-.09);
    torso.box(s*5.75,23.40,0,3.55,3.88,5.3,C.dark);torso.box(s*6.15,24.54,.35,4.7,2.0,5.55,C.steel);
    torso.box(s*6.1,25.6,.5,3.9,.45,4.7,C.cream);torso.box(s*7.8,24.0,.4,.57,2.95,5.6,C.blue);
    torsoLight.box(s*6.3,24.4,3.18,3.4,.22,.18,C.cyan);
    for(let i=0;i<5;i++)torso.box(s*3.81,17.4+i*.58,2.3,.9,.21,.64,C.chrome);
    torso.box(s*3.3,21.6,-3.25,2.14,6.2,1.48,C.dark);torso.box(s*3.3,24.6,-3.25,1.70,.48,1.10,C.chrome);
    for(let i=0;i<5;i++)torso.box(s*3.3,19.4+i*.91,-4.03,1.5,.29,.22,C.steel);
  }
  torso.box(0,20.05,3.42,3.4,3.4,.5,C.dark);torso.box(0,20.05,3.72,2.65,2.65,.22,C.chrome,Math.PI/4);
  torso.box(0,20.05,3.95,2.23,2.23,.2,C.dark,Math.PI/4);
  torso.box(0,23.0,3.30,4.85,1.51,.16,C.dark);glyphs(torso,'SG-01',-2.16,23.47,3.43,.228,C.cream);
  for(const s of [-1,1])for(let i=0;i<3;i++)torso.box(s*(3.2+i*.52),23.5,3.23,.30,.59,.16,i%2?C.dark:C.yellow);
  add(machine,torso,solid,'Layered chest, SG-01 nameplate and shoulder caps');
  add(machine,torsoLight,emissive,'Shoulder running lights');
  const reactor=batch();reactor.box(0,0,0,1.74,1.74,.25,C.cyan,Math.PI/4);reactor.box(0,0,.18,.55,.55,.12,C.cream,Math.PI/4);
  const core=add(machine,reactor,emissive,'Diamond fusion reactor');core.position.set(0,20.05,4.1);

  const head=new THREE.Group();head.name='Expressive guardian head';head.position.set(0,27.95,.20);machine.add(head);
  const face=batch(),faceLight=batch();
  face.box(0,-2.14,-.1,3.3,1.4,3.3,C.joint);face.box(0,.18,0,6.50,4.68,4.9,C.steel);
  face.box(0,2.74,-.08,5.60,.6,4.35,C.cream);face.box(0,1.0,2.51,5.58,2.02,.34,C.dark);
  face.box(0,-.93,2.52,5.4,1.64,.42,C.cream);face.box(0,-.44,2.82,3.3,.3,.15,C.dark);
  face.box(-1.75,-.18,2.82,.31,.39,.16,C.dark);face.box(1.75,-.18,2.82,.31,.39,.16,C.dark);
  face.box(0,1.62,2.77,.36,.75,.24,C.steel);
  for(const s of [-1,1]){
    face.box(s*3.45,.42,-.15,.73,3.0,2.82,C.dark);face.box(s*3.86,.4,-.15,.38,1.79,1.67,C.cream);
    face.box(s*2.6,-1.55,2.04,.72,1.29,1.27,C.steel);
    faceLight.box(s*1.51,1.11,2.79,1.65,.54,.15,C.cyan);faceLight.box(s*1.02,1.48,2.8,.37,.21,.16,C.cream);
    face.box(s*2.43,3.5,-1.0,.31,1.85,.37,C.dark);face.box(s*2.43,4.9,-1.0,.21,1.01,.25,C.chrome);
    faceLight.box(s*2.43,5.79,-1.0,.42,.43,.40,s>0?C.magenta:C.cyan);
    for(let i=0;i<3;i++)face.box(s*3.06,-.95+i*.45,-2.05,.3,.2,1.14,C.chrome);
  }
  add(head,face,solid,'Helmet, antennae, ears and smiling face');add(head,faceLight,emissive,'Pixel eyes and antenna beacons');

  const arms=[];
  for(const side of [-1,1]){
    const shoulder=new THREE.Vector3(side*7.1,23.2,.35);
    const joints=batch();for(const offset of [-.78,0,.78])joints.box(offset,0,0,.42,2.5,2.25,offset?C.chrome:C.dark);
    const elbow=add(machine,joints,solid,`${side} elbow joint`);
    const makeBone=(name,lower)=>{
      const b=batch();b.box(0,0,0,lower?1.57:1.7,1,lower?1.7:1.95,C.dark);
      b.box(-.68,0,.93,.19,.94,.20,C.chrome);b.box(.68,0,.93,.19,.94,.20,C.chrome);
      for(const t of [-1,1]){b.box(0,t*.345,.1,lower?2.26:2.7,.30,2.55,lower?C.steel:C.blue);b.box(0,t*.345,1.42,lower?1.90:2.3,.25,.25,C.cream);}
      b.box(0,0,1.06,.32,.78,.14,C.cyan);return add(machine,b,solid,name);
    };
    const upper=makeBone(`${side} telescoping upper arm`,false),lower=makeBone(`${side} telescoping forearm`,true);
    const fist=new THREE.Group();fist.name=`${side} articulated fist`;machine.add(fist);
    const hand=batch(),palm=batch();
    hand.box(0,.9,0,2.5,1.3,2.45,C.dark);hand.box(0,-.3,0,3.30,2.60,3.15,C.steel);
    hand.box(0,-.43,1.66,3.03,2.24,.50,C.cream);
    for(let i=0;i<4;i++){
      hand.box(-1.19+i*.80,-.40,2.01,.65,1.79,.5,i%2?C.cream:C.steel);
      hand.box(-1.19+i*.80,-1.04,2.27,.44,.44,.18,C.dark);
    }
    hand.box(side*1.85,-.23,.34,.98,1.96,1.46,C.blue,-side*.15);
    hand.box(0,.8,1.44,2.45,.40,.39,C.dark);palm.box(0,.80,1.68,1.7,.19,.19,C.cyan);
    hand.box(0,-1.65,-.25,1.64,.30,1.72,C.dark);palm.box(0,-1.83,-.25,1.10,.12,1.1,C.cyan);
    add(fist,hand,solid,`${side} plated fist with individual knuckles`);add(fist,palm,emissive,`${side} palm emitter`);
    arms.push({side,shoulder,elbow,upper,lower,fist,idle:new THREE.Vector3(side*8.4,15.1,2.2)});
  }

  // Ground cues are independent of the machine's visual scale, in world metres.
  const warning=new THREE.Group();warning.name='Locked attack danger zone';group.add(warning);
  const warningMaterial=new THREE.MeshBasicMaterial({color:C.yellow,transparent:true,opacity:.85,depthWrite:false,toneMapped:false});
  const warningCore=new THREE.MeshBasicMaterial({color:C.magenta,transparent:true,opacity:.10,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
  const ringBatch=batch(),radials=batch();
  for(let i=0;i<40;i++){
    const a=i/40*TAU;ringBatch.box(Math.cos(a),0,Math.sin(a),.067,.033,.067,0xffffff);
    if(i%5===0){radials.box(Math.cos(a)*.83,0,Math.sin(a)*.83,.045,.034,.045,0xffffff);radials.box(Math.cos(a)*.71,0,Math.sin(a)*.71,.027,.034,.027,0xffffff);}
  }
  const ring=add(warning,ringBatch,warningMaterial,'Pixel warning perimeter'),ticks=add(warning,radials,warningMaterial,'Locked radial marks');
  const floor=new THREE.Mesh(new THREE.CircleGeometry(1,40),warningCore);floor.rotation.x=-Math.PI/2;floor.position.y=-.012;warning.add(floor);
  const crossBatch=batch();crossBatch.box(0,0,0,.42,.035,.055,0xffffff);crossBatch.box(0,0,0,.055,.035,.42,0xffffff);
  add(warning,crossBatch,warningMaterial,'Impact crosshair');
  const shockMaterial=new THREE.MeshBasicMaterial({color:C.cyan,transparent:true,opacity:.8,depthWrite:false,toneMapped:false});
  const shock=ring.clone();shock.material=shockMaterial;shock.name='Expanding square-pixel impact ring';group.add(shock);
  const projectile=new THREE.Group();projectile.name='Palm energy projectile';group.add(projectile);
  const orb=new THREE.Mesh(new THREE.BoxGeometry(1.1,1.1,1.1),new THREE.MeshBasicMaterial({color:C.cream,toneMapped:false}));projectile.add(orb);
  const orbFrame=new THREE.Mesh(new THREE.BoxGeometry(1.65,1.65,1.65),new THREE.MeshBasicMaterial({color:C.cyan,wireframe:true,toneMapped:false}));projectile.add(orbFrame);
  const aim=new THREE.Vector3(),localAim=new THREE.Vector3(),unit=new THREE.Vector3(),pole=new THREE.Vector3(),elbowPoint=new THREE.Vector3(),end=new THREE.Vector3();
  let disposed=false;
  function bone(mesh,a,b){mesh.position.addVectors(a,b).multiplyScalar(.5);unit.subVectors(b,a);mesh.scale.y=unit.length();mesh.quaternion.setFromUnitVectors(UP,unit.normalize());}
  function poseArm(arm,point){
    const delta=new THREE.Vector3().subVectors(point,arm.shoulder),distance=Math.max(.01,delta.length());delta.divideScalar(distance);
    const reach=Math.max(13.5,distance*1.095),l1=reach*.48,l2=reach*.52;
    const along=(l1*l1-l2*l2+distance*distance)/(2*distance),bend=Math.sqrt(Math.max(0,l1*l1-along*along));
    pole.set(arm.side,.18,.75).addScaledVector(delta,-pole.dot(delta)).normalize();
    elbowPoint.copy(arm.shoulder).addScaledVector(delta,along).addScaledVector(pole,bend);
    bone(arm.upper,arm.shoulder,elbowPoint);bone(arm.lower,elbowPoint,point);arm.elbow.position.copy(elbowPoint);
    arm.elbow.rotation.y=Math.atan2(delta.x,delta.z);arm.fist.position.copy(point);
  }
  function update(robotState={},time=0){
    if(disposed)return;
    const phase=robotState.phase||'idle',active=phase!=='idle',kind=robotState.kind||'slam';
    const p=clamp((robotState.phaseTime||0)/Math.max(.001,robotState.phaseDuration||1),0,1);
    const impactFraction=clamp(robotState.impactFraction??(kind==='slam'?.35:.55),.05,.95);
    const idleClock=active?0:time;
    const position=robotState.position||ROBOT_SITE;group.position.set(position.x,position.y??ROBOT_SITE.y,position.z);
    missiles.update(robotState.barrage,position);
    const target=robotState.aim||{x:position.x-.25,y:1.48,z:position.z-25.9};
    aim.set(target.x-position.x,(target.y??position.y??ROBOT_SITE.y)-(position.y??ROBOT_SITE.y),target.z-position.z);
    localAim.copy(aim).sub(machine.position).applyAxisAngle(UP,-Math.PI).divideScalar(scale);
    const aimedSide=localAim.x>=0?1:-1,radius=Math.max(1,robotState.radius||5.5);
    for(const arm of arms){
      end.copy(arm.idle);end.y+=Math.sin(idleClock*1.05+arm.side)*.11*(active?0:1);
      if(active&&arm.side===aimedSide){
        const hit=localAim.clone();hit.y+=1.87;
        const raised=hit.clone();raised.y+=15;
        const firing=arm.shoulder.clone().lerp(hit,.33);firing.y=Math.max(firing.y,14);
        if(phase==='warning')end.lerp(kind==='slam'?raised:firing,ease(p));
        else if(phase==='strike')end.copy(kind==='slam'?raised.lerp(hit,ease(p/impactFraction)):firing);
        else if(phase==='recover')end.copy(kind==='slam'?hit:firing).lerp(arm.idle,ease(p));
      }else if(active){end.y+=2.0;end.z+=1.2;}
      poseArm(arm,end);arm.fist.rotation.set(0,active&&arm.side===aimedSide?clamp(Math.atan2(localAim.x,localAim.z),-1.2,1.2)*.20:arm.side*.08,arm.side*-.045);
    }
    head.rotation.y=active?clamp(Math.atan2(localAim.x,localAim.z),-.62,.62):Math.sin(idleClock*.22)*.16;
    head.rotation.x=active?.08:Math.sin(idleClock*.59)*.018;
    const energy=active?(phase==='warning'?1+p*.13:phase==='strike'?1.18:1+.18*(1-p)):1+Math.sin(idleClock*1.8)*.035;
    core.scale.set(energy,energy,1);
    warning.visible=active;warning.position.set(aim.x,aim.y+.065,aim.z);warning.scale.set(radius,1,radius);
    // Warm red remains legible against the sunlit grey road for both attacks.
    warningMaterial.color.setHex(C.magenta);
    warningMaterial.opacity=phase==='warning'?.62+.30*Math.sin(p*Math.PI*8)**2:phase==='strike'?.98:.55*(1-p);
    warningCore.opacity=phase==='warning'?.045+.105*p:phase==='strike'?.21:.12*(1-p);
    ticks.scale.setScalar(phase==='warning'?1-.1*p:1);floor.scale.setScalar(phase==='warning'?.35+.65*p:1);
    const impactStarted=phase==='strike'&&p>=impactFraction||phase==='recover';
    const impactProgress=phase==='strike'?clamp((p-impactFraction)/(1-impactFraction),0,1)*.25:phase==='recover'?.25+.75*p:0;
    shock.visible=impactStarted;shock.position.copy(warning.position);shock.position.y+=.02;
    shock.scale.setScalar(radius*(.18+impactProgress*1.03));shock.scale.y=1;shockMaterial.opacity=.85*(1-impactProgress);
    projectile.visible=phase==='strike'&&kind==='pulse'&&p<impactFraction;
    if(projectile.visible){
      const arm=arms.find(a=>a.side===aimedSide);projectile.position.set(0,-1.90,-.25).applyEuler(arm.fist.rotation).add(arm.fist.position).multiplyScalar(scale).applyAxisAngle(UP,Math.PI).add(machine.position).lerp(aim,clamp(p/impactFraction,0,1));
      projectile.rotation.set(p*8,p*11,p*6);projectile.scale.setScalar(1+Math.sin(p*Math.PI/impactFraction)*.35);
    }
    group.userData.phase=phase;group.userData.attackKind=kind;group.userData.attackId=robotState.attackId??0;
    group.userData.aim={x:target.x,y:target.y??position.y,z:target.z};
  }
  update({},0);
  group.userData.height=ROBOT_HEIGHT;group.userData.robotId='SG-01';
  return {group,update,dispose(){
    if(disposed)return;disposed=true;const geometries=new Set(),materials=new Set();
    group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of(Array.isArray(o.material)?o.material:[o.material]))materials.add(m);});
    for(const g of geometries)g.dispose();for(const m of materials)m.dispose();group.removeFromParent();group.clear();
  }};
}
