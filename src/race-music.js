const clamp=value=>Math.max(0,Math.min(1,Number(value)||0));

/** One streamed music element, mixed separately from the engine and effects. */
export class RaceMusic {
  constructor({src,volume=.35,onState=()=>{}}={}) {
    this.src=src;this.volume=clamp(volume);this.muted=false;this.phase='menu';this.onState=onState;
    this.element=null;this.context=null;this.gain=null;this.source=null;this.unlocked=false;
    this.pending=null;this.blocked=false;this.failed=false;this.disposed=false;this.level=0;
    this.visibility=()=>this.sync();
    globalThis.document?.addEventListener('visibilitychange',this.visibility);
  }
  connect(context,destination) {
    if(this.element||!this.src||this.disposed)return;
    this.context=context;this.element=new Audio();this.element.preload='none';this.element.loop=true;
    this.element.src=this.src;this.element.setAttribute('playsinline','');
    this.gain=context.createGain();this.gain.gain.value=0;
    this.source=context.createMediaElementSource(this.element);this.source.connect(this.gain);this.gain.connect(destination);
    this.element.addEventListener('error',()=>{this.failed=true;this.notify('error');});
  }
  // Invoke in the same user gesture that unlocks the existing audio context.
  unlock() {
    if(!this.element||this.disposed)return;
    this.unlocked=true;this.blocked=false;
    if(this.wanted())this.sync();
    if(!this.failed)this.play();
  }
  setVolume(value){this.volume=clamp(value);this.sync();}
  setMuted(value){this.muted=!!value;this.sync();}
  update(phase){if(phase!==this.phase){
    if(phase==='countdown'&&this.phase!=='paused'&&this.element)this.element.currentTime=0;
    this.phase=phase;this.blocked=false;this.sync();
  }}
  wanted(){return this.unlocked&&!this.muted&&this.volume>0&&!globalThis.document?.hidden&&['countdown','racing'].includes(this.phase);}
  notify(status){if(this.status!==status){this.status=status;this.onState(status);}}
  play() {
    if(this.pending||this.blocked||this.failed||!this.element.paused)return;
    const operation=this.element.play();
    this.pending=Promise.resolve(operation).then(()=>{
      if(this.disposed||!this.wanted())this.element.pause();
      else this.notify('playing');
    }).catch(error=>{
      if(error.name==='AbortError')return;
      this.blocked=true;this.notify(error.name==='NotAllowedError'?'blocked':'error');
    }).finally(()=>{this.pending=null;});
  }
  sync() {
    if(!this.element||this.disposed)return;
    const wanted=this.wanted(),level=wanted?this.volume*(this.phase==='countdown'?.16:.34):0;
    if(level!==this.level){this.level=level;this.gain.gain.setTargetAtTime(level,this.context.currentTime,.12);}
    if(wanted){this.play();if(!this.element.paused)this.notify('playing');}
    else {
      this.element.pause();
      if(['menu','finished'].includes(this.phase))this.element.currentTime=0;
      this.notify(this.failed?'error':this.unlocked?'paused':'ready');
    }
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;
    globalThis.document?.removeEventListener('visibilitychange',this.visibility);
    this.element?.pause();this.element?.removeAttribute('src');this.element?.load();this.source?.disconnect();this.gain?.disconnect();
  }
}
