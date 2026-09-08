const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const wrap=n=>Math.atan2(Math.sin(n),Math.cos(n));

// Mouse orbit stays relative to the kart, so its setting also works around bends.
export class ChaseCameraControls {
  constructor(canvas,{enabled=()=>true,onReset=()=>{}}={}) {
    this.canvas=canvas;this.enabled=enabled;this.onReset=onReset;
    this.pointer=null;this.mode=0;this.dragged=false;
    this.reset(0,true);
    canvas.addEventListener('pointerdown',e=>{
      if(!this.enabled()||this.pointer!==null||![0,2].includes(e.button))return;
      this.pointer=e.pointerId;this.lastX=e.clientX;this.lastY=e.clientY;this.dragged=false;
      canvas.setPointerCapture(e.pointerId);canvas.classList.add('camera-dragging');canvas.focus();e.preventDefault();
    });
    canvas.addEventListener('pointermove',e=>{
      if(this.pointer!==e.pointerId)return;
      if(!this.enabled()){this.cancel();return;}
      const dx=e.clientX-this.lastX,dy=e.clientY-this.lastY;
      this.lastX=e.clientX;this.lastY=e.clientY;
      this.targetYaw=wrap(this.targetYaw-dx*.0045);
      this.targetPitch=clamp(this.targetPitch+dy*.003,.22,1.12);
      this.dragged ||= Math.abs(dx)+Math.abs(dy)>2;
    });
    for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,e=>{if(e.pointerId===this.pointer)this.cancel();});
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('wheel',e=>{
      if(!this.enabled())return;
      e.preventDefault();
      const pixels=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?500:1);
      this.targetRadius=clamp(this.targetRadius*Math.exp(clamp(pixels,-240,240)*.0013),6.5,90);
    },{passive:false});
    canvas.addEventListener('dblclick',e=>{if(this.enabled()){e.preventDefault();this.reset(this.mode);this.onReset();}});
  }
  cancel(){
    const id=this.pointer;this.pointer=null;
    this.canvas.classList.remove('camera-dragging');
    if(id!==null&&this.canvas.hasPointerCapture(id))this.canvas.releasePointerCapture(id);
  }
  reset(mode=0,immediate=false){
    this.cancel();
    this.mode=mode;this.targetYaw=0;
    const distance=mode===2?8.5:mode===1?42:21,height=mode===2?3.1:mode===1?36:14;
    this.targetPitch=Math.atan2(height,distance);this.targetRadius=Math.hypot(distance,height);
    if(immediate){this.yaw=this.targetYaw;this.pitch=this.targetPitch;this.radius=this.targetRadius;}
  }
  update(dt){
    const blend=1-Math.exp(-Math.max(0,dt)*12);
    this.yaw=wrap(this.yaw+wrap(this.targetYaw-this.yaw)*blend);
    this.pitch+=(this.targetPitch-this.pitch)*blend;
    this.radius+=(this.targetRadius-this.radius)*blend;
    return this;
  }
}
