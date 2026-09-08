const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4 7 12l8 8" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="miter"/></svg>';
const GAS = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m5 17 11-11 11 11M5 28l11-11 11 11" fill="none" stroke="currentColor" stroke-width="4"/></svg>';
import {RACE_LAPS} from './race-config.js';

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
      <div class="portrait-steering-wrap"><div class="portrait-charge" aria-hidden="true"><i></i></div><div id="portrait-steering" class="portrait-glass" role="slider" tabindex="0" aria-label="横向滑动转向" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="0" aria-valuetext="回正"><span class="steer-arrow">${ARROW}</span><i class="steer-knob"></i><span class="steer-arrow steer-right">${ARROW}</span><small>滑动转向</small></div></div>
      <div class="portrait-speed"><b id="portrait-speed">000</b><small>KM/H</small></div>
      <button id="portrait-brake" class="portrait-glass" aria-label="按住刹车或倒车">刹车</button>
      <div class="portrait-gas-wrap"><span class="portrait-drift-hint">上滑漂移</span><button id="portrait-gas" class="portrait-glass" aria-label="按住加速，向上滑动漂移">${GAS}<b>加速</b></button></div>
      <button id="portrait-item" class="portrait-glass" aria-label="收集道具后点击使用" disabled><b>?</b><small>道具</small></button>
    </div>`;
  root.append(view);
  const $ = id => view.querySelector(`#${id}`), set = (id, text) => {const node = $(id), value = String(text); if (node.textContent !== value) node.textContent = value;};
  const media = matchMedia('(max-width: 760px) and (orientation: portrait)');
  let state = {phase: 'menu'}, player = {}, enabled = false, steeringId = null, gasId = null, gasY = 0, brakeId = null, drift = false;
  let rankingUntil = 0, rankKey = '', note = '', noteUntil = 0, lastPhase = 'menu';
  const steer = $('portrait-steering'), gas = $('portrait-gas'), brake = $('portrait-brake');
  let steeringRect=null;
  function closeRankings() {rankingUntil = 0; $('portrait-rankings').hidden = true; $('portrait-rank').setAttribute('aria-expanded', 'false');}
  function clearPointer(node, id) {if (id !== null && node.hasPointerCapture(id)) node.releasePointerCapture(id);}
  function release() {
    const ids = [steeringId, gasId, brakeId]; steeringId = gasId = brakeId = null; drift = false;
    clearPointer(steer, ids[0]); clearPointer(gas, ids[1]); clearPointer(brake, ids[2]);
    Object.assign(input, {throttle: 0, brake: 0, steer: 0, drift: false, useItem: false, reset: false});
    steer.style.setProperty('--steer', '0'); steer.setAttribute('aria-valuenow', '0'); steer.setAttribute('aria-valuetext', '回正');
    for (const button of [steer, gas, brake]) button.classList.remove('pressed');
    gas.dataset.drift = 'false'; gas.querySelector('b').textContent = '加速';
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
  function steering(event) {
    const rect = steeringRect||steer.getBoundingClientRect(), raw = (event.clientX - rect.left - rect.width / 2) / (rect.width * .34);
    const value = Math.abs(raw) < .07 ? 0 : Math.sign(raw) * Math.pow(clamp((Math.abs(raw) - .07) / .93, 0, 1),1.2);
    input.steer = value; steer.style.setProperty('--steer', String(value));
    steer.setAttribute('aria-valuenow', String(Math.round(value * 100))); steer.setAttribute('aria-valuetext', value < 0 ? '左转' : value > 0 ? '右转' : '回正');
  }
  steer.addEventListener('pointerdown', e => {if (steeringId === null && begin(e, steer)) {steeringRect=steer.getBoundingClientRect();steeringId = e.pointerId; steering(e);}});
  steer.addEventListener('pointermove', e => {if (steeringId === e.pointerId && enabled) {e.preventDefault(); steering(e);}});
  gas.addEventListener('pointerdown', e => {if (gasId === null && begin(e, gas)) {gasId = e.pointerId; gasY = e.clientY; input.throttle = 1;}});
  gas.addEventListener('pointermove', e => {
    if (gasId !== e.pointerId || !enabled) return; e.preventDefault();
    const rise = gasY - e.clientY;
    if (rise > 28) drift = true; else if (rise < 14) drift = false;
    input.drift = drift; gas.dataset.drift = String(drift); gas.querySelector('b').textContent = drift ? '漂移' : '加速';
  });
  brake.addEventListener('pointerdown', e => {if (brakeId === null && begin(e, brake)) {brakeId = e.pointerId; input.brake = 1;}});
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    steer.addEventListener(type, e => {if (e.pointerId !== steeringId) return; steeringId = null; input.steer = 0; steer.style.setProperty('--steer', '0'); steer.classList.remove('pressed'); steer.setAttribute('aria-valuenow', '0'); steer.setAttribute('aria-valuetext', '回正');});
    gas.addEventListener(type, e => {if (e.pointerId !== gasId) return; gasId = null; input.throttle = 0; input.drift = false; drift = false; gas.classList.remove('pressed'); gas.dataset.drift = 'false'; gas.querySelector('b').textContent = '加速';});
    brake.addEventListener(type, e => {if (e.pointerId !== brakeId) return; brakeId = null; input.brake = 0; brake.classList.remove('pressed');});
  }
  for (const node of [steer, gas, brake]) node.addEventListener('contextmenu', e => e.preventDefault());
  steer.addEventListener('keydown', e => {if (!enabled || !['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); input.steer = e.key === 'Home' ? 0 : e.key === 'ArrowLeft' ? -1 : 1; steer.style.setProperty('--steer', String(input.steer));});
  steer.addEventListener('keyup', e => {if (['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) {e.stopPropagation(); input.steer = 0; steer.style.setProperty('--steer', '0');}});
  $('portrait-item').onclick = () => {if (enabled && player.item) onItem?.();};
  $('portrait-pause').onclick = () => {release(); closeRankings(); onPause?.();};
  $('portrait-rank').onclick = () => {if (!$('portrait-rankings').hidden) closeRankings(); else {rankingUntil = performance.now() + 4000; $('portrait-rankings').hidden = false; $('portrait-rank').setAttribute('aria-expanded', 'true');}};
  document.addEventListener('pointerdown', e => {if (!e.target.closest('#portrait-rank, #portrait-rankings')) closeRankings();}, true);
  const utilities = document.createElement('div'); utilities.className = 'portrait-utilities';
  utilities.innerHTML = '<button id="portrait-camera" class="pixel-button secondary">切换镜头</button><button id="portrait-reset" class="pixel-button secondary">回到赛道</button>';
  root.querySelector('#pause-settings').before(utilities);
  utilities.querySelector('#portrait-camera').onclick = () => {onResume?.(); onCamera?.();};
  utilities.querySelector('#portrait-reset').onclick = () => {onResume?.(); onReset?.();};
  const guide = document.createElement('p'); guide.className = 'portrait-menu-guide'; guide.textContent = '左手滑动转向 · 右手按住加速，上滑漂移'; root.querySelector('.menu-controls').after(guide);
  const help = document.createElement('p'); help.className = 'portrait-help'; help.textContent = '左侧滑动转向，松手回正。右侧按住加速，向上滑动漂移，滑回或松手释放冲刺。刹车可与加速同时按住；点击道具使用。点排名展开赛况，空白画面可拖动环视。'; root.querySelector('.controls-guide').before(help);
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
      item.disabled = !enabled || !player.item; item.dataset.item = player.item || 'empty'; item.setAttribute('aria-label', player.item ? `使用${names[player.item]}` : '收集道具后点击使用');
      gas.disabled = brake.disabled = !driving; root.querySelector('#portrait-reset').disabled = !!player.crash;
      steer.setAttribute('aria-disabled', String(!driving));
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
      if (player.crash) {status = `翻车 · ${Math.max(0, player.crash.at + player.crash.duration - (state.renderTime ?? state.elapsed)).toFixed(1)} 秒后复位`; kind = 'danger';}
      else if (player.wrongWay) {status = '方向反啦，调头继续！'; kind = 'danger';}
      else if (state.robot?.kind === 'pulse' && ['warning', 'strike'].includes(state.robot.phase) && Math.hypot(player.x - state.robot.aim.x, player.z - state.robot.aim.z) < 65) {status = state.robot.phase === 'warning' ? '能量预警 · 避开准心' : '能量冲击！'; kind = 'danger';}
      else if (now < noteUntil) status = note;
      else if (player.catchupBoost > .05) {status = player.catchupActive ? '末位涡轮' : '涡轮余劲'; kind = 'boost';}
      else if (player.boost > 0) {status = '涡轮冲刺'; kind = 'boost';}
      const notice = $('portrait-status'); notice.hidden = !status || state.phase !== 'racing'; notice.dataset.kind = kind; notice.querySelector('span').textContent = status;
    },
  };
}
