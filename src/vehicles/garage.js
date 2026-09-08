import * as THREE from 'three';
import {VEHICLES,vehicleById,readVehicleChoice,saveVehicleChoice} from './catalog.js';
import {animateKart} from '../voxel-assets.js';
import './garage.css';

export function createGarage({app,library,renderer,getEnvironment=()=>null,onVisibility=()=>{}}) {
  const root=document.createElement('section');root.id='vehicle-garage';root.hidden=true;
  root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-labelledby','garage-title');
  root.innerHTML=`<header class="garage-header"><div><h1 id="garage-title">选择你的座驾</h1><p>十款个性，整装出发。</p></div><button id="garage-back" class="garage-outline">← 返回</button></header>
    <div class="garage-copy"><span id="garage-category"></span><h2 id="garage-name"></h2><p id="garage-description"></p><span id="garage-index"></span></div>
    <div id="garage-stage" aria-label="拖动车辆查看细节"><img id="garage-reference" alt="" hidden><p id="garage-status" role="status"></p></div>
    <div class="garage-bottom"><div class="garage-rail" role="group" aria-label="十款赛车">${VEHICLES.map(v=>`<button class="garage-tile" data-vehicle="${v.id}" aria-label="${v.name}，${v.category}" aria-pressed="false"><img src="${v.thumbnail||v.reference}" alt="" loading="lazy"><span>${v.name}</span></button>`).join('')}</div>
    <footer class="garage-footer"><span>拖动查看 · 方向键切换</span><button id="garage-confirm">就选这辆 <b>→</b></button></footer></div>`;
  app.append(root);
  const $=id=>root.querySelector('#'+id),scene=new THREE.Scene();scene.background=new THREE.Color(0x071e28);scene.environment=getEnvironment();
  scene.fog=new THREE.FogExp2(0x071e28,.03);
  const camera=new THREE.PerspectiveCamera(42,1,.05,100);
  scene.add(new THREE.HemisphereLight(0xc1e6eb,0x344047,3.0));
  const key=new THREE.DirectionalLight(0xffe1bd,5.0);key.position.set(3,6,3);key.castShadow=true;
  key.shadow.mapSize.set(512,512);Object.assign(key.shadow.camera,{left:-3,right:3,top:3,bottom:-3,near:.1,far:15});key.shadow.bias=-.001;key.shadow.normalBias=.015;scene.add(key);
  const fill=new THREE.DirectionalLight(0x7ccfdc,1.7);fill.position.set(-4,3,-2);scene.add(fill);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(80,80),new THREE.MeshBasicMaterial({color:0x071e28}));floor.rotation.x=-Math.PI/2;floor.position.y=-.015;scene.add(floor);
  const shadow=new THREE.Mesh(new THREE.PlaneGeometry(10,10),new THREE.ShadowMaterial({opacity:.32}));shadow.rotation.x=-Math.PI/2;shadow.position.y=-.012;shadow.receiveShadow=true;scene.add(shadow);
  const grid=new THREE.GridHelper(16,32,0x254a55,0x17333e);grid.position.y=-.01;grid.material.transparent=true;grid.material.opacity=.42;scene.add(grid);
  let selected=readVehicleChoice()||VEHICLES[0].id,kart=null,sequence=0,busy=false,confirmAction=null,returnFocus=null;
  let yaw=-.57,pitch=.35,drag=null,lastDrag=0,clock=0;
  const reference=$('garage-reference'),status=$('garage-status'),confirm=$('garage-confirm');
  function clearPreview(){if(kart){scene.remove(kart);kart=null;}}
  async function select(id,{focus=false}={}) {
    const spec=vehicleById(id);if(!spec)return;
    selected=id;const request=++sequence;busy=false;clearPreview();yaw=-.57;pitch=.35;
    root.dataset.selected=id;root.dataset.preview='loading';
    $('garage-category').textContent=spec.category;$('garage-name').textContent=spec.name;
    $('garage-description').replaceChildren(document.createTextNode(spec.line1),document.createElement('br'),document.createTextNode(spec.line2));
    $('garage-index').textContent=`${String(spec.index+1).padStart(2,'0')} / 10`;
    for(const tile of root.querySelectorAll('[data-vehicle]')){const active=tile.dataset.vehicle===id;tile.setAttribute('aria-pressed',String(active));tile.tabIndex=active?0:-1;if(active){tile.scrollIntoView({block:'nearest',inline:'nearest'});if(focus)tile.focus();}}
    confirm.disabled=true;reference.hidden=true;status.textContent='正在准备座驾…';
    if(!spec.available){reference.src=spec.reference;reference.alt=`${spec.name}的车身设计参考图`;reference.hidden=false;status.textContent='车身设计参考 · 3D 车型制作中';root.dataset.preview='concept';return;}
    try{
      await library.load(id);if(request!==sequence)return;
      kart=library.create(id);scene.add(kart);scene.environment=getEnvironment();
      const size=new THREE.Box3().setFromObject(kart).getSize(new THREE.Vector3());kart.userData.showroomDistance=Math.max(4.6,Math.max(size.x,size.z)*1.85);
      await renderer.compileAsync(scene,camera);if(request!==sequence)return;
      status.textContent='';confirm.disabled=false;root.dataset.preview='model';
    }catch{if(request===sequence){clearPreview();status.textContent='赛车未能加载，点击车型重试。';root.dataset.preview='error';}}
  }
  function close(){++sequence;root.hidden=true;drag=null;busy=false;app.dataset.garage='false';onVisibility(false);clearPreview();returnFocus?.focus?.();}
  function cancel(){if(busy)return;confirmAction=null;close();}
  root.querySelector('.garage-rail').addEventListener('click',event=>{const tile=event.target.closest('[data-vehicle]');if(tile&&!busy)select(tile.dataset.vehicle);});
  $('garage-back').addEventListener('click',cancel);
  confirm.addEventListener('click',async()=>{
    if(confirm.disabled||busy)return;busy=true;confirm.disabled=true;status.textContent='正在驶入赛道…';
    try {if(confirmAction)await confirmAction(selected);saveVehicleChoice(selected);close();}
    catch {busy=false;confirm.disabled=false;status.textContent='准备失败，请重试。';}
  });
  root.addEventListener('keydown',event=>{
    if(event.code==='Escape'){event.preventDefault();event.stopPropagation();cancel();return;}
    if(['ArrowLeft','ArrowRight','Home','End'].includes(event.code)&&!busy){
      event.preventDefault();event.stopPropagation();let index=vehicleById(selected).index;
      index=event.code==='Home'?0:event.code==='End'?9:(index+(event.code==='ArrowRight'?1:9))%10;select(VEHICLES[index].id,{focus:true});
    }
    if(event.code==='Tab'){
      const controls=[...root.querySelectorAll('button:not(:disabled)')].filter(node=>node.tabIndex>=0),first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  const stage=$('garage-stage');stage.addEventListener('pointerdown',event=>{if(!kart||drag)return;drag={id:event.pointerId,x:event.clientX,y:event.clientY};stage.setPointerCapture(event.pointerId);});
  stage.addEventListener('pointermove',event=>{if(drag?.id!==event.pointerId)return;yaw+=(event.clientX-drag.x)*.008;pitch=THREE.MathUtils.clamp(pitch+(event.clientY-drag.y)*.004,.08,.9);drag.x=event.clientX;drag.y=event.clientY;lastDrag=clock;});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(type,event=>{if(drag?.id===event.pointerId)drag=null;});
  return {
    root,scene,get visible(){return !root.hidden;},get selected(){return selected;},
    open({onConfirm=null,initialId=null}={}){returnFocus=document.activeElement;confirmAction=onConfirm;root.hidden=false;app.dataset.garage='true';onVisibility(true);select(initialId||readVehicleChoice()||selected);$('garage-back').focus();},
    close:cancel,
    render(dt){
      if(root.hidden)return;clock+=dt;const w=innerWidth,h=innerHeight,portrait=w<700;
      const stageRect=stage.getBoundingClientRect();
      camera.aspect=w/h;camera.clearViewOffset();
      // Shift the composition toward the open showroom area without another WebGL context.
      camera.setViewOffset(w,h,(w/2-(stageRect.left+stageRect.width/2)),(h/2-(stageRect.top+stageRect.height/2))+stageRect.height*.08,w,h);
      if(kart){if(!drag&&clock-lastDrag>2)yaw+=dt*.14;
        const distance=kart.userData.showroomDistance*(portrait?1.42:1);
        camera.position.set(Math.sin(yaw)*distance,1.0+Math.sin(pitch)*distance,Math.cos(yaw)*distance);camera.lookAt(0,.58,0);
        animateKart(kart,{time:clock,speed:0,steer:Math.sin(clock*.6)*.30},dt);
      }else{camera.position.set(4,3,5);camera.lookAt(0,.75,0);}
      camera.updateProjectionMatrix();renderer.setRenderTarget(null);
      const exposure=renderer.toneMappingExposure;renderer.toneMappingExposure=1.2;renderer.render(scene,camera);renderer.toneMappingExposure=exposure;
    }
  };
}
