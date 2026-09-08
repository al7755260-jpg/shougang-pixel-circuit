const DRIFT = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m18 4 8 7-8 7M25 11H13c-8 0-8 12 0 12h7M5 27h6M15 27h6" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="miter"/></svg>';
import {RACE_LAPS} from './race-config.js';
import {joystickInput} from './joystick-input.js';

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const seconds = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Dedicated two-thumb portrait controls. Shares the existing game's input object. */
export function createPortraitHUD(root, {input, onPause, onItem, onCamera, onReset, onResume}) {
  const view = document.createElement('section'); view.id = 'portrait-hud'; view.dataset.active = 'false'; view.setAttribute('aria-label', '竖屏赛车界面');
  view.innerHTML = `
    <header class="portrait-top">
      <button id="portrait-rank" class="portrait-glass" aria-label="展开排名" aria-expanded="false" aria-controls="portrait-rankings"><span><b id="portrait-position">1</b><small id="portrait-total">/ 6</small></span><svg viewBox="0 0 16 8" aria-hidden="true"><path d="m3 1 5 5 5-5" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>
      <div class="portrait-stats"><span class="portrait-lap"><b id="portrait-lap">1</b><small id="portrait-laps">/ ${RACE_LAPS} 圈</small></span><time id="portrait-time">00:00</time><span class="portrait-coins"><i class="coin-pixel" aria-hidden="true"></i><b id="portrait-coins">00</b></span></div>
      <button id="portrait-pause" class="portrait-glass" aria-label="暂停比赛"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor"/></svg></button>
    </header>
    <ol id="portrait-rankings" class="portrait-glass" aria-label="实时排名" hidden></ol>
    <div id="portrait-status" role="status" hidden><i aria-hidden="true"></i><span></span></div>
    <div class="portrait-controls" aria-label="双拇指驾驶操作">
      <div class="portrait-joystick-wrap">
        <div class="portrait-speed"><b id="portrait-speed">000</b><small>KM/H</small></div>
        <div id="portrait-joystick" role="group" tabindex="0" aria-roledescription="二维虚拟摇杆" aria-label="方向摇杆，上推前进，下拉刹车倒车，左右转向，支持斜推">
          <span class="joystick-guide" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          <span id="portrait-joystick-thumb" aria-hidden="true"><i></i></span>
        </div>
      </div>
      <div class="portrait-actions">
        <button id="portrait-brake" class="portrait-glass" aria-label="按住刹车" aria-pressed="false"><span aria-hidden="true">Ⅱ</span><b>刹车</b></button>
        <button id="portrait-drift" class="portrait-glass" aria-label="配合转向按住漂移，松手释放冲刺" aria-pressed="false">${DRIFT}<b>漂移</b><span class="portrait-charge" aria-hidden="true"><i></i></span></button>
        <button id="portrait-item" class="portrait-glass" aria-label="收集道具后点击使用" disabled><b>?</b><small>道具</small></button>
      </div>
    </div>`;
  root.append(view);
  const $ = id => view.querySelector(`#${id}`), set = (id, text) => {const node = $(id), value = String(text); if (node.textContent !== value) node.textContent = value;};
  const media = matchMedia('(max-width: 760px) and (orientation: portrait)');
  let state = {phase: 'menu'}, player = {}, enabled = false;
  let rankingUntil = 0, rankKey = '', note = '', noteUntil = 0, lastPhase = 'menu';
  const pad=$('portrait-joystick'),thumb=$('portrait-joystick-thumb'),brake=$('portrait-brake'),driftButton=$('portrait-drift');
  const actionPointers=new Map(),heldKeys=new Map();
  let padRect=null,padPointer=null,travel=40,stick=joystickInput(0,0,40);
  function closeRankings() {rankingUntil = 0; $('portrait-rankings').hidden = true; $('portrait-rank').setAttribute('aria-expanded', 'false');}
  function clearPointer(node, id) {if (id !== null && node.hasPointerCapture(id)) node.releasePointerCapture(id);}
  function release() {
    const padId=padPointer,actionIds=[...actionPointers];padPointer=null;stick=joystickInput(0,0,travel);actionPointers.clear();heldKeys.clear();
    clearPointer(pad,padId);for(const [id,node] of actionIds)clearPointer(node,id);
    Object.assign(input, {throttle: 0, brake: 0, steer: 0, drift: false, useItem: false, reset: false});
    syncControls();
  }
  function resize() {
    release(); closeRankings(); root.dataset.portrait = String(media.matches);
    view.hidden = !media.matches; if (!media.matches) enabled = false;
  }
  media.addEventListener('change', resize); window.addEventListener('resize', resize);
  window.addEventListener('blur', release); document.addEventListener('visibilitychange', () => {if (document.hidden) release();});
  function begin(event, node) {
    if (!enabled || event.button > 0) return false;
    event.preventDefault(); node.setPointerCapture(event.pointerId); node.classList.add('pressed'); closeRankings(); return true;
  }
  function syncControls(){
    const held=new Set(heldKeys.values());
    pad.classList.toggle('pressed',padPointer!==null||['up','down','left','right'].some(key=>held.has(key)));
    const actions=[...actionPointers.values()],braking=actions.includes(brake)||held.has('brake');
    const pedal=clamp(-stick.y+Number(held.has('up'))-Number(held.has('down')),-1,1);
    input.throttle=braking?0:Math.max(0,pedal);
    input.brake=braking?1:Math.max(0,-pedal);input.steer=clamp(stick.x+Number(held.has('right'))-Number(held.has('left')),-1,1);
    input.drift=actions.includes(driftButton)||held.has('drift');
    pad.style.setProperty('--stick-x',`${stick.dx.toFixed(2)}px`);pad.style.setProperty('--stick-y',`${stick.dy.toFixed(2)}px`);
    for(const node of [brake,driftButton]){
      const pressed=node===brake?braking:input.drift;
      node.classList.toggle('pressed',pressed);node.setAttribute('aria-pressed',String(pressed));
    }
  }
  function moveStick(event){
    stick=joystickInput(event.clientX-padRect.left-padRect.width/2,event.clientY-padRect.top-padRect.height/2,travel);
    syncControls();
  }
  pad.addEventListener('pointerdown',e=>{if(padPointer===null&&begin(e,pad)){padRect=pad.getBoundingClientRect();travel=Math.max(1,(padRect.width-thumb.offsetWidth)/2-5);padPointer=e.pointerId;moveStick(e);}});
  pad.addEventListener('pointermove',e=>{if(enabled&&padPointer===e.pointerId){e.preventDefault();moveStick(e);}});
  for(const node of [brake,driftButton])node.addEventListener('pointerdown',e=>{if(begin(e,node)){actionPointers.set(e.pointerId,node);syncControls();}});
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    pad.addEventListener(type,e=>{if(padPointer===e.pointerId){padPointer=null;stick=joystickInput(0,0,travel);clearPointer(pad,e.pointerId);syncControls();}});
    for(const node of [brake,driftButton])node.addEventListener(type,e=>{if(actionPointers.delete(e.pointerId))syncControls();});
  }
  for(const node of [pad,brake,driftButton])node.addEventListener('contextmenu',e=>e.preventDefault());
  for(const node of [pad,brake,driftButton]){
    node.addEventListener('keydown',e=>{const value=({ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'})[e.key]||([' ','Enter'].includes(e.key)&&node!==pad?(node===brake?'brake':'drift'):null);if(!value||!enabled)return;e.preventDefault();e.stopPropagation();heldKeys.set(e.code,value);syncControls();});
    node.addEventListener('keyup',e=>{if(heldKeys.delete(e.code)){e.preventDefault();e.stopPropagation();syncControls();}});
    node.addEventListener('blur',()=>{if(heldKeys.size){heldKeys.clear();syncControls();}});
  }
  function tap(node,action){
    // A second finger may not generate a compatibility click while the first
    // holds the stick. Activate on pointer-down, with keyboard clicks retained.
    node.addEventListener('pointerdown',e=>{if(e.button>0||node.disabled)return;e.preventDefault();action();});
    node.onclick=e=>{if(e.detail===0&&!node.disabled)action();};
  }
  tap($('portrait-item'),()=>{if(enabled&&player.item&&!player.grannyBlock)onItem?.();});
  tap($('portrait-pause'),()=>{release();closeRankings();onPause?.();});
  tap($('portrait-rank'),()=>{if(!$('portrait-rankings').hidden)closeRankings();else{rankingUntil=performance.now()+4000;$('portrait-rankings').hidden=false;$('portrait-rank').setAttribute('aria-expanded','true');}});
  document.addEventListener('pointerdown', e => {if (!e.target.closest('#portrait-rank, #portrait-rankings')) closeRankings();}, true);
  const utilities = document.createElement('div'); utilities.className = 'portrait-utilities';
  utilities.innerHTML = '<button id="portrait-camera" class="pixel-button secondary">切换镜头</button><button id="portrait-reset" class="pixel-button secondary">回到赛道</button>';
  root.querySelector('#pause-settings').before(utilities);
  utilities.querySelector('#portrait-camera').onclick = () => {onResume?.(); onCamera?.();};
  utilities.querySelector('#portrait-reset').onclick = () => {onResume?.(); onReset?.();};
  const guide = document.createElement('p'); guide.className = 'portrait-menu-guide'; guide.textContent = '左手摇杆驾驶 · 右手刹车 / 漂移'; root.querySelector('.menu-controls').after(guide);
  const help = document.createElement('p'); help.className = 'portrait-help'; help.textContent = '摇杆：上推前进、下拉刹车倒车、左右转向，斜推可同时加速转弯。轻推微调、推远加大力度，松手自动回中。右侧独立刹车、漂移；配合转向按住漂移蓄能，松手释放冲刺。点道具使用，点排名展开赛况，空白画面可拖动环视。'; root.querySelector('.controls-guide').before(help);
  resize();
  return {
    get active() {return media.matches;}, release,
    notify(message) {note = String(message).replace(/\s*·\s*按 E 使用/g, '').slice(0, 24); noteUntil = performance.now() + 1700;},
    update(next, vehicle, modal = false) {
      state = next; player = vehicle; const now = performance.now();
      const visible = media.matches && ['racing', 'countdown'].includes(state.phase) && !modal;
      view.dataset.active = String(visible);
      const driving = visible && !player.crash && !player.finished && !player.dnf;
      if (enabled && !driving) release(); enabled = driving;
      if (!visible || now > rankingUntil) closeRankings();
      if (state.phase !== lastPhase && ['menu', 'countdown'].includes(state.phase)) {note = ''; noteUntil = 0; closeRankings();}
      lastPhase = state.phase;
      if (!media.matches) return;
      set('portrait-position', state.mode === 'practice' ? '∞' : player.rank || 1); set('portrait-total', state.mode === 'practice' ? '' : `/ ${state.vehicles?.length || 6}`);
      set('portrait-lap', player.lap || 1); set('portrait-laps', `/ ${state.mode === 'practice' ? '∞' : state.totalLaps || RACE_LAPS} 圈`);
      set('portrait-time', seconds(state.elapsed || 0)); set('portrait-coins', String(player.coins || 0).padStart(2, '0'));
      set('portrait-speed', String(Math.round(Math.abs(player.speed || 0) * 3.6)).padStart(3, '0'));
      const symbols = {boost: '»', shield: '◇', pulse: 'ϟ', banana: '⌁'}, names = {boost: '冲刺', shield: '护盾', pulse: '脉冲', banana: '香蕉'};
      const item = $('portrait-item'); item.querySelector('b').textContent = symbols[player.item] || '?'; item.querySelector('small').textContent = names[player.item] || '道具';
      item.disabled = !enabled || !player.item || !!player.grannyBlock; item.dataset.item = player.item || 'empty'; item.setAttribute('aria-label', player.item ? `使用${names[player.item]}` : '收集道具后点击使用');
      // Keep a held pedal through this one-second event; simulation freezes the kart.
      for(const node of [brake,driftButton])node.disabled=!driving;
      root.querySelector('#portrait-reset').disabled = !!player.crash || !!player.grannyBlock;pad.setAttribute('aria-disabled',String(!driving));
      const charge = clamp((player.driftCharge || 0) / 3, 0, 1); view.querySelector('.portrait-charge i').style.width = `${charge * 100}%`;
      view.querySelector('.portrait-charge').dataset.charged = String(charge > .216);
      const key = JSON.stringify(state.vehicles?.map(v => [v.id, v.rank, v.name, v.finished, v.dnf]));
      if (key !== rankKey) {
        rankKey = key; const rows = [...(state.vehicles || [])].sort((a, b) => a.rank - b.rank).map(v => {
          const row = document.createElement('li'); row.dataset.local = String(v.id === player.id);
          const rank = document.createElement('b'), dot = document.createElement('i'), name = document.createElement('span'); rank.textContent = String(v.rank);
          dot.style.backgroundColor = v.color; name.textContent = `${v.name}${v.id === player.id && v.name !== '你' ? ' · 你' : ''}`; row.append(rank, dot, name); return row;
        }); $('portrait-rankings').replaceChildren(...rows);
      }
      let status = '', kind = 'info';
      if (player.crash) {const age=(state.renderTime??state.elapsed)-player.crash.at,label=player.crash.mode==='burn'?(player.crash.sourceKind==='missile'?'导弹焚毁':'弹坑焚毁'):player.crash.sourceKind==='kong'?'被抛出':'翻车';status = player.crash.sourceKind==='kong'&&age<player.crash.grabDuration ? '被金刚抓住了！' : `${label} · ${Math.max(0, player.crash.duration-age).toFixed(1)} 秒后复位`; kind = 'danger';}
      else if(player.grannyBlock){status=`等奶奶起身 · ${Math.max(0,player.grannyBlock.until-(state.renderTime??state.elapsed)).toFixed(1)} 秒`;kind='info';}
      else if (player.wrongWay) {status = '方向反啦，调头继续！'; kind = 'danger';}
      else if (now < noteUntil) status = note;
      else if (player.catchupBoost > .05) {status = player.catchupActive ? '末位涡轮' : '涡轮余劲'; kind = 'boost';}
      else if (player.boost > 0) {status = '涡轮冲刺'; kind = 'boost';}
      const notice = $('portrait-status'); notice.hidden = !status || state.phase !== 'racing'; notice.dataset.kind = kind; notice.querySelector('span').textContent = status;
    },
  };
}
