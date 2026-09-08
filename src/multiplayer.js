import {crashPose} from './kart-crash.js';
import {readVehicleChoice,validVehicleId} from './vehicles/catalog.js';
import {validRoomId} from './room-invite.js';
import {SnapshotClock} from './snapshot-clock.js';
import {multiplayerEndpoint} from './asset-url.js';
const NEUTRAL = {throttle:0,brake:0,steer:0,drift:false,useItem:false,reset:false};
const NAME_KEY = 'shougang-player-name';
const mix = (a,b,t) => a+(b-a)*t;
const turn = (a,b,t) => a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;

/** The server owns race rules. Clients send controls and interpolate snapshots. */
export class MultiplayerClient {
  constructor({onChange=()=>{},onRace=()=>{}}={}) {
    this.onChange=onChange;this.onRace=onRace;
    this.modelId=readVehicleChoice();
    let name='车手';try{name=localStorage.getItem(NAME_KEY)||name;}catch{}
    this.view={open:false,connection:'idle',playerId:null,rooms:[],room:null,error:'',shareUrls:[],latency:null,name,paused:false};
    this.view.invitedRoomId=validRoomId(new URLSearchParams(location.search).get('room'));
    this.view.inviteStatus=this.view.invitedRoomId?'pending':null;
    this.snapshots=[];this.events=[];this.input={...NEUTRAL};this.seq=0;this.raceId=null;this.result=null;
    this.clock=new SnapshotClock();this.pickupLayout=[];this.lastSentInput={...NEUTRAL};this.lastInputAt=0;
    this._sendTimer=setInterval(()=>this.sendInput(),50);
    this._pingTimer=setInterval(()=>{if(this.view.connection==='connected')this.send({type:'ping',sentAt:Date.now()});},2000);
    window.addEventListener('pagehide',()=>this.socket?.close());
  }
  get inRace(){return !!this.view.room&&!!this.snapshots.length&&this.view.room.status!=='waiting';}
  get vehicleId(){return this.view.room?.players.find(p=>p.id===this.view.playerId)?.vehicleId??0;}
  changed(){this.onChange({...this.view,localPlayerId:this.vehicleId});}
  open(){this.view.open=true;this.changed();this.connect();}
  close(){this.leave();this.view.open=false;this.view.error='';this.changed();this.socket?.close();}
  async connect(){
    if(this.socket?.readyState===WebSocket.OPEN){this.send({type:'list'});this.joinInvitation();return;}
    if(this.socket&&[WebSocket.CONNECTING,WebSocket.OPEN].includes(this.socket.readyState))return;
    if(this.connecting)return;this.connecting=true;
    this.view.connection='connecting';this.view.error='';this.changed();
    let endpoint;
    try{endpoint=await multiplayerEndpoint();}catch{this.view.connection='disconnected';this.view.error='联机服务暂未开放，可先体验单人比赛，稍后重试。';this.changed();this.connecting=false;return;}
    this.connecting=false;if(!this.view.open)return;
    const url=new URL('/multiplayer',endpoint);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const socket=this.socket=new WebSocket(url);
    const deadline=setTimeout(()=>{if(socket.readyState===WebSocket.CONNECTING)socket.close();},8000);
    socket.addEventListener('open',()=>{clearTimeout(deadline);this.send({type:'hello',name:this.view.name,modelId:this.modelId});});
    socket.addEventListener('message',event=>{
      if(socket!==this.socket)return;
      let message;try{message=JSON.parse(event.data);}catch{return;}
      if(message.type==='welcome'){
        Object.assign(this.view,{connection:'connected',playerId:message.playerId,rooms:message.rooms||[],shareUrls:message.shareUrls||[],error:''});this.changed();this.joinInvitation();
      }else if(message.type==='share'){
        this.view.shareUrls=message.shareUrls||[];this.changed();
      }else if(message.type==='rooms'){
        this.view.rooms=message.rooms||[];this.changed();
      }else if(message.type==='room'){
        this.view.room=message.room;this.view.error='';
        if(message.room){this.view.invitedRoomId=null;this.view.inviteStatus=null;this.setRoomUrl(message.room.id);}
        if(!message.room||message.room.status==='waiting')this.clearRace();
        this.changed();
      }else if(message.type==='snapshot'){
        if(!this.view.room||!message.state?.vehicles)return;
        if(message.raceId!==this.raceId){this.clearRace();this.raceId=message.raceId;}
        if(message.pickups)this.pickupLayout=message.pickups;
        if(message.protocol===2){const inactive=new Map(message.pickupStates||[]);message.pickups=this.pickupLayout.map(p=>({...p,active:!inactive.has(p.id),respawn:inactive.get(p.id)||0}));}
        message.receivedAt=performance.now();
        this.clock.push(message.serverTime,message.receivedAt);
        this.snapshots.push(message);if(this.snapshots.length>12)this.snapshots.shift();
        this.events.push(...(message.events||[]));if(this.events.length>256)this.events.splice(0,this.events.length-256);
        this.onRace(message);
      }else if(message.type==='pong'&&Number.isFinite(message.sentAt)){
        const rtt=Math.max(0,Date.now()-message.sentAt);
        this.view.latency=Math.round(this.view.latency===null?rtt:mix(this.view.latency,rtt,.3));this.changed();
      }else if(message.type==='error'){
        if(this.view.inviteStatus==='joining')this.view.inviteStatus='error';
        this.view.error=message.message||'操作未完成，请重试。';this.changed();
      }
    });
    socket.addEventListener('close',()=>{
      clearTimeout(deadline);if(socket!==this.socket)return;
      const wasRacing=this.inRace;this.view.connection='disconnected';this.view.room=null;this.view.rooms=[];
      if(this.view.inviteStatus==='joining')this.view.inviteStatus='pending';
      if(this.view.open)this.view.error=wasRacing?'连接已断开，你的赛车已交给 AI。重新连接后可加入下一场。':'联机服务器暂时离线，可先体验单人比赛，稍后重试。';
      this.clearRace();this.changed();
    });
    socket.addEventListener('error',()=>{if(socket===this.socket){this.view.error='无法连接联机服务，请重试。';this.changed();}});
  }
  setName(value){
    this.view.name=String(value||'车手').trim().slice(0,16)||'车手';
    try{localStorage.setItem(NAME_KEY,this.view.name);}catch{}
    this.send({type:'hello',name:this.view.name,modelId:this.modelId});this.changed();
  }
  setModel(id){if(this.inRace)return false;this.modelId=validVehicleId(id);this.send({type:'hello',name:this.view.name,modelId:this.modelId});return true;}
  setRoomUrl(roomId){try{const url=new URL(location.href);if(roomId){url.searchParams.set('multiplayer','1');url.searchParams.set('room',roomId);}else url.searchParams.delete('room');history.replaceState(null,'',url);}catch{}}
  joinInvitation(){
    if(!this.view.invitedRoomId||this.view.inviteStatus!=='pending'||this.view.room||this.view.connection!=='connected')return;
    this.view.inviteStatus='joining';this.view.error='';this.changed();
    this.send({type:'join',roomId:this.view.invitedRoomId});
  }
  dismissInvitation(){this.view.invitedRoomId=null;this.view.inviteStatus=null;this.view.error='';this.setRoomUrl(null);}
  send(message){if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify(message));}
  action(type,payload={}){
    if(type==='open')return this.open();if(type==='close')return this.close();if(type==='connect')return this.connect();
    if(type==='name')return this.setName(payload.name);
    if(type==='invite-retry'){this.view.inviteStatus='pending';return this.connect();}
    if(type==='invite-dismiss'){this.dismissInvitation();this.changed();return;}
    if(type==='leave')return this.leave();
    if(payload.playerName)this.setName(payload.playerName);
    if(type==='create'||type==='join')this.dismissInvitation();
    this.view.error='';this.changed();
    this.send({type,...(type==='create'?{name:payload.name}:type==='join'?{roomId:payload.roomId}:{})});
  }
  leave(){this.send({type:'leave'});this.view.room=null;this.dismissInvitation();this.clearRace();this.changed();}
  clearRace(){this.snapshots=[];this.events=[];this.raceId=null;this.result=null;this.view.paused=false;this.input={...NEUTRAL};this.pendingItem=this.pendingReset=false;this.clock.reset();this.pickupLayout=[];}
  pause(value){this.view.paused=!!value;this.input={...NEUTRAL};this.pendingItem=this.pendingReset=false;this.sendInput();this.changed();}
  queueInput(input){
    if(this.view.paused||document.hidden){this.input={...NEUTRAL};return;}
    this.input={throttle:Number(input.throttle)||0,brake:Number(input.brake)||0,steer:Number(input.steer)||0,drift:!!input.drift,useItem:!!input.useItem,reset:!!input.reset};
    this.pendingItem ||= !!input.useItem;this.pendingReset ||= !!input.reset;
    const changed=['throttle','brake','drift'].some(key=>this.lastSentInput[key]!==this.input[key])||Math.abs(this.lastSentInput.steer-this.input.steer)>.12||this.pendingItem||this.pendingReset;
    if(changed&&performance.now()-this.lastInputAt>=16)this.sendInput();
  }
  releaseInput(){this.input={...NEUTRAL};this.pendingItem=this.pendingReset=false;this.sendInput();}
  sendInput(){
    if(!this.inRace)return;
    if(this.socket?.bufferedAmount>4096)return;
    const input=this.view.paused||document.hidden?{...NEUTRAL}:{...this.input,useItem:this.input.useItem||!!this.pendingItem,reset:this.input.reset||!!this.pendingReset};
    this.send({type:'input',seq:++this.seq,input});this.lastSentInput={...input};this.lastInputAt=performance.now();this.pendingItem=this.pendingReset=false;
  }
  applyTo(game,now=performance.now()){
    if(!this.inRace)return false;
    const newest=this.snapshots.at(-1);
    const target=this.clock.sample(now)??newest.serverTime;
    let a=this.snapshots[0],b=a;
    for(const snapshot of this.snapshots){if(snapshot.serverTime<=target)a=snapshot;if(snapshot.serverTime>=target){b=snapshot;break;}b=snapshot;}
    const t=a===b?1:Math.max(0,Math.min(1,(target-a.serverTime)/(b.serverTime-a.serverTime)));
    const renderTime=mix(a.state.elapsed,b.state.elapsed,t);
    const vehicles=newest.state.vehicles.map(v=>{
      const va=a.state.vehicles.find(k=>k.id===v.id)||v,vb=b.state.vehicles.find(k=>k.id===v.id)||v;
      const phase=t<1?va:vb,crash=phase.crash||null,transition=(va.crash?.id??null)!==(vb.crash?.id??null);
      // Flight and recovery switch at the same interpolated instant. Never lerp
      // a returning kart across the roadside or start its crash one snapshot early.
      const pose=crash?crashPose(crash,renderTime):transition?phase:null;
      const ahead=target>newest.serverTime&&!pose&&!v.finished&&!v.dnf&&!v.respawnProtection&&!v._wallContact?Math.min(.08,(target-newest.serverTime)/1000):0;
      let x=pose?.x??(mix(va.x,vb.x,t)+(v._vx||0)*ahead),z=pose?.z??(mix(va.z,vb.z,t)+(v._vz||0)*ahead);
      if(ahead){const near=game.track.closest(x,z),limit=game.width/2-1.55;if(Math.abs(near.signedDistance)>limit){const center=game.track.getPoint(near.t),normal=game.track.getNormal(near.t),side=Math.sign(near.signedDistance)*limit;x=center.x+normal.x*side;z=center.z+normal.z*side;}}
      // Short dead reckoning covers late packets; impacts/guardrail contact stay authoritative.
      return {...v,crash,respawnProtection:phase.respawnProtection||0,
        x,z,heading:crash?crash.heading:pose?.heading??turn(va.heading,vb.heading,t),
        speed:crash?0:v.speed,steering:mix(va.steering||0,vb.steering||0,t)};
    });
    game.playerId=this.vehicleId;
    const player=vehicles.find(v=>v.id===game.playerId)||vehicles[0];
    game.state={...newest.state,renderTime,vehicles,multiplayer:true,
      countdown:newest.state.phase==='countdown'?mix(a.state.countdown,b.state.countdown,t):newest.state.countdown,
      speedKmh:Math.round(Math.abs(player.speed)*3.6),wrongWay:player.wrongWay,bestLap:player.bestLap,lapTimes:player.lapTimes};
    if(newest.state.robot?.barrage){
      const barrage=newest.state.robot.barrage;
      const renderTime=mix(a.state.robot?.barrage?.time??barrage.time,b.state.robot?.barrage?.time??barrage.time,t);
      game.state.robot={...newest.state.robot,barrage:{...barrage,renderTime}};
    }
    if(player.finished||newest.state.phase==='finished'){
      if(!this.result)this.result={rank:player.rank,total:vehicles.length,time:player.dnf?null:player.finishTime??newest.state.elapsed,dnf:!!player.dnf,bestLap:player.bestLap,lapTimes:player.lapTimes||[],coins:player.coins};
      this.result.standings=[...vehicles].sort((a,b)=>a.rank-b.rank);
      game.state.result=this.result;game.state.phase='finished';
    }else if(this.view.paused)game.state.phase='paused';
    game.pickups=newest.pickups;game.hazards=newest.hazards;
    game._events.push(...this.events.splice(0));
    return true;
  }
}
