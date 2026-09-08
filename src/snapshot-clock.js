/** A monotonic playback clock absorbs packet jitter without rewinding cars. */
export class SnapshotClock {
  reset(){this.latest=null;this.cursor=null;this.lastNow=null;this.jitter=0;this.delay=65;}
  constructor(){this.reset();}
  push(serverTime,arrival){
    if(this.latest){const variation=Math.abs((arrival-this.latest.arrival)-(serverTime-this.latest.serverTime));this.jitter+=.12*(Math.min(200,variation)-this.jitter);}
    this.latest={serverTime,arrival};this.delay=Math.min(150,65+this.jitter*1.5);
  }
  sample(now){
    if(!this.latest)return null;
    const desired=this.latest.serverTime+Math.max(0,now-this.latest.arrival)-this.delay;
    if(this.cursor===null)this.cursor=desired;
    else {const dt=Math.max(0,Math.min(250,now-this.lastNow));const forward=this.cursor+dt;const correction=Math.max(-dt*.35,Math.min(dt*.35,(desired-forward)*.12));this.cursor=Math.max(this.cursor,Math.min(this.latest.serverTime+80,forward+correction));}
    this.lastNow=now;return this.cursor;
  }
}
