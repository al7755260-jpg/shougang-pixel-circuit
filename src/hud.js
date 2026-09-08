import {ROBOT_SITE} from './robot-config.js';
import {RACE_LAPS} from './race-config.js';
import {PUBLIC_BUILD} from './asset-url.js';
import {createMultiplayerLobby} from './multiplayer-lobby.js';
import {createPortraitHUD} from './portrait-hud.js';

const MOBILE_DEVICE = matchMedia('(pointer: coarse)').matches || innerWidth<=760;
const DEFAULT_SETTINGS = { environmentStyle: 'voxel', voxelQuality: MOBILE_DEVICE?'pixel':'original', quality: 'pixel', pixelSize: 1, renderQuality:MOBILE_DEVICE?'performance':'cinematic', adaptiveQuality:true, visualVersion:2, volume: .4, musicVolume:.35, muted:false, assist: true };
const STORAGE_KEY = 'shougang-settings-v1';
const ITEM_NAMES = { boost: '涡轮冲刺', shield: '像素护盾', pulse: '电磁脉冲', banana: '香蕉路障' };
const ITEM_SYMBOLS = { boost: '»', shield: '◇', pulse: 'ϟ', banana: '⌁' };
const ICONS = {
  sound: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 12h6l8-7v22l-8-7H3z" fill="currentColor"/><path d="M22 10q6 6 0 12M26 5q11 11 0 22" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
  mute: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 12h6l8-7v22l-8-7H3z" fill="currentColor"/><path d="m22 12 8 8m0-8-8 8" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
  gear: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m12 2 1 4h6l1-4 4 2-1 4 3 3 4-1 2 4-4 2v4l4 2-2 4-4-1-3 3 1 4-4 2-1-4h-6l-1 4-4-2 1-4-3-3-4 1-2-4 4-2v-4l-4-2 2-4 4 1 3-3-1-4z" transform="translate(1 -2) scale(.94)" fill="currentColor"/><circle cx="16" cy="16" r="6" fill="var(--cream)"/></svg>',
  wheel: '<svg viewBox="0 0 68 68" aria-hidden="true"><path d="M22 3h24v6h10v10h7v29h-7v10H46v7H22v-7H12V48H5V19h7V9h10z" fill="currentColor"/><path d="M24 12h20v5h9v12H15V17h9zM14 37h13v8h4v11h-9v-6h-8zM41 37h13v13h-8v6h-9V45h4z" fill="#162347"/><path d="M25 34h18v8H25z" fill="#162347"/></svg>',
  pause: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 5h6v22H7zM19 5h6v22h-6z" fill="currentColor"/></svg>',
};

function readSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      environmentStyle: !PUBLIC_BUILD&&s.environmentStyle === 'gaussian' ? 'gaussian' : 'voxel',
      voxelQuality: ['pixel','original'].includes(s.voxelQuality)?s.voxelQuality:DEFAULT_SETTINGS.voxelQuality,
      quality: s.quality === 'original' ? 'original' : 'pixel',
      pixelSize: s.visualVersion===2&&[1, 1.5, 2].includes(Number(s.pixelSize)) ? Number(s.pixelSize) : 1,
      renderQuality:['performance','cinematic'].includes(s.renderQuality)?s.renderQuality:DEFAULT_SETTINGS.renderQuality,visualVersion:2,
      adaptiveQuality:s.adaptiveQuality!==false,
      volume: Number.isFinite(s.volume) ? Math.min(1, Math.max(0, s.volume)) : .4,
      musicVolume:Number.isFinite(s.musicVolume)?Math.min(1,Math.max(0,s.musicVolume)):.35,
      muted:typeof s.muted==='boolean'?s.muted:s.volume===0,
      assist: typeof s.assist === 'boolean' ? s.assist : true,
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

function formatTime(seconds, precision = 2) {
  if (!Number.isFinite(seconds)) return '--:--.--';
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(precision).padStart(precision + 3, '0')}`;
}

export function createHUD({ track, onStart, onPause, onResume, onRestart, onMenu,
  onSettingsChange, onMute, onReset, onItem, onRetry, onMultiplayer, onCamera, onGarage, musicTitle='', musicReady=false } = {}) {
  const root = document.createElement('div'); root.id = 'game-hud'; root.dataset.phase = 'menu'; root.dataset.ready = 'false';
  root.innerHTML = `
    <header class="topbar">
      <div class="brand" aria-label="Shougang Pixel Circuit"><span class="brand-wheel">${ICONS.wheel}</span><span>SHOUGANG<br>PIXEL CIRCUIT</span></div>
      <div class="track-title pixel-paper"><span class="title-pin">+</span>首钢园 · 天际环线<span class="title-pin">+</span></div>
      <nav class="top-actions" aria-label="游戏设置">
        <button id="hud-pause" class="icon-button pixel-paper race-only" aria-label="暂停比赛" title="暂停比赛（Esc）">${ICONS.pause}</button>
        <button id="hud-sound" class="icon-button pixel-paper" aria-label="关闭全部声音" title="音乐与音效">${ICONS.sound}</button>
        <button id="hud-settings" class="icon-button pixel-paper" aria-label="打开设置" title="设置">${ICONS.gear}</button>
      </nav>
    </header>
    <section id="main-menu" class="menu-panel pixel-paper" aria-label="首钢园像素大奖赛主菜单">
      <h1><span class="title-shougang">首钢园</span><span class="title-race">像素大奖赛</span></h1>
      <div class="pixel-rule"></div>
      <p class="menu-tagline">首钢新景，像素冒险。</p>
      <p class="menu-track-info">${((track?.length || 1205.421) / 1000).toFixed(1)} 公里 · ${track?.label || '展馆环线'}</p>
      <p class="race-spec"><strong>${RACE_LAPS}</strong> 圈 <i>/</i> <strong>6</strong> 位车手 <i>/</i> 无限乐趣</p>
      <div class="menu-buttons">
        <button id="start-race" class="pixel-button primary" disabled><span class="checker-flag" aria-hidden="true"></span><span>开始比赛</span></button>
        <button id="start-practice" class="pixel-button secondary" disabled>自由练习</button>
        <button id="start-multiplayer" class="pixel-button secondary"><span class="mp-menu-icon" aria-hidden="true">▰▰</span>多人联机</button>
        <button id="start-garage" class="text-button">选择座驾 · 10 款车型</button>
      </div>
      <div class="menu-controls"><span><kbd>WASD</kbd> 驾驶</span><span><kbd>SPACE</kbd> 漂移</span><span><kbd>E</kbd> 道具</span></div>
      <div id="load-status" class="load-status" role="status" aria-live="polite"><div class="load-status-line"><span id="load-message">正在唤醒像素赛道…</span><span id="load-percent">0%</span></div><div class="load-track"><span id="load-fill"></span></div><button id="load-retry" class="text-button" hidden>重新加载</button></div>
    </section>
    <div class="menu-footer"><span id="menu-environment-source" class="source-name">首钢园实景重构</span> <span>·</span> 像素赛车</div>
    <section id="race-stats" class="race-stats race-only" aria-label="比赛信息">
      <div class="position-card pixel-paper"><span class="small-label" id="rank-label">POSITION</span><div><b id="race-rank">1</b><span id="race-total">/ 6</span></div></div>
      <div class="timing-card pixel-paper"><div class="lap-line"><span id="lap-label">圈数</span><strong id="race-lap">1 <em>/ ${RACE_LAPS}</em></strong></div><div class="time-line"><span>用时</span><strong id="race-time">00:00.00</strong></div><div class="coin-line"><i class="coin-pixel" aria-hidden="true"></i><strong id="race-coins">00</strong><span id="best-lap"></span></div></div>
    </section>
    <button id="race-item" class="item-card pixel-paper race-only" aria-label="使用道具" disabled><span id="item-symbol">?</span><span id="item-name">收集道具箱</span><kbd>E</kbd></button>
    <div id="countdown" class="countdown" aria-live="assertive" hidden>3</div>
    <div id="race-warning" class="race-warning" role="status" hidden></div>
    <aside id="guardian-alert" class="guardian-alert" hidden aria-label="巨像攻击预警"><strong id="guardian-title">巨像锁定</strong><span id="guardian-hint">避开路面的警示区</span><div class="guardian-meter"><i id="guardian-fill"></i></div></aside>
    <div id="boost-message" class="boost-message" hidden><b id="boost-title">OVERDRIVE</b><span id="boost-hint">超频冲刺</span></div>
    <section class="driving-hud race-only" aria-label="驾驶状态">
      <div class="drift-wrap"><div class="drift-label"><span id="drift-label">SPACE · 漂移蓄能</span><span id="drift-level">READY</span></div><div class="drift-meter"><div id="drift-fill"></div><i></i><i></i></div></div>
      <div class="speed-display"><strong id="race-speed">000</strong><span>KM/H</span></div>
    </section>
    <div class="race-shortcuts race-only"><span><kbd>ESC</kbd> 暂停</span><button id="race-reset" title="回到赛道（R）"><kbd>R</kbd> 回到赛道</button></div>
    <div class="camera-help race-only">C 广角 / 俯瞰 · 拖动环视 · 滚轮调距 · 双击复位</div>
    <aside id="minimap" class="minimap pixel-paper" aria-label="赛道小地图"><canvas id="map-canvas" width="252" height="182"></canvas><div class="map-caption"><span>PARK LOOP</span><span>01</span></div></aside>
    <div id="hud-toast" class="hud-toast pixel-paper" role="status" hidden></div>
    <div id="scene-load-status" class="scene-load-status pixel-paper" role="status" hidden><span id="scene-load-message">正在载入园区实景…</span><button id="scene-load-retry" class="text-button" hidden>重新加载</button></div>
    <div id="pause-overlay" class="modal-backdrop" hidden><section class="pause-panel pixel-paper" role="dialog" aria-modal="true" aria-labelledby="pause-title"><div class="modal-eyebrow">PIT STOP</div><h2 id="pause-title">歇一脚，再出发。</h2><p id="pause-description">稍歇片刻，比赛已暂停。</p><button id="resume-race" class="pixel-button primary">继续比赛 <span class="button-arrow">→</span></button><button id="restart-race" class="pixel-button secondary">重新开始</button><button id="pause-settings" class="text-button">游戏设置</button><button id="pause-menu" class="text-button">返回主菜单</button><div class="modal-hint"><kbd>ESC</kbd> 继续比赛</div></section></div>
    <div id="finish-overlay" class="modal-backdrop" hidden><section class="finish-panel pixel-paper" role="dialog" aria-modal="true" aria-labelledby="finish-title"><div class="modal-eyebrow">CHEQUERED FLAG / FINISH</div><h2 id="finish-title">畅游园区，完赛！</h2><div class="finish-rank"><span>第</span><strong id="finish-rank">1</strong><span>名 <small id="finish-total">/ 6</small></span></div><div class="finish-times"><div><span>总用时</span><strong id="finish-time">00:00.00</strong></div><div><span>最快单圈</span><strong id="finish-best">00:00.00</strong></div></div><div id="finish-laps" class="finish-laps"></div><button id="finish-restart" class="pixel-button primary">再跑一场 <span class="button-arrow">→</span></button><button id="finish-menu" class="pixel-button secondary">返回主菜单</button></section></div>
    <div id="settings-overlay" class="modal-backdrop settings-backdrop" hidden><section class="settings-panel pixel-paper" role="dialog" aria-modal="true" aria-labelledby="settings-title"><header class="settings-heading"><div><div class="modal-eyebrow">YOUR GARAGE / OPTIONS</div><h2 id="settings-title">调好状态，即刻出发。</h2></div><button id="settings-close" class="close-button" aria-label="关闭设置">×</button></header>
      <label class="setting-row" for="setting-environment"><span><strong>园区风格</strong><small>实景重构，切换两种视觉风格</small></span><select id="setting-environment"><option value="voxel">像素体素</option><option value="gaussian">实景高斯</option></select></label>
      <label class="setting-row" for="setting-quality"><span><strong>渲染质量</strong><small id="setting-quality-description">按设备性能选择园区精细度</small></span><select id="setting-quality"><option value="pixel">流畅</option><option value="original">高清 · 高阶颜色</option></select></label>
      <label class="setting-row" for="setting-render"><span><strong>光影效果</strong><small>真实投影、环境遮蔽与柔和辉光</small></span><select id="setting-render"><option value="cinematic">PV 光影</option><option value="performance">性能优先</option></select></label>
      <label class="setting-row" for="setting-pixel"><span><strong>画面精细度</strong><small>方块造型保留，可调整屏幕像素颗粒</small></span><select id="setting-pixel"><option value="1">细腻 · 1×</option><option value="1.5">经典 · 1.5×</option><option value="2">复古 · 2×</option></select></label>
      <label class="setting-row" for="setting-adaptive"><span><strong>流畅度调节</strong><small>繁忙时自动调节清晰度，保留园区细节与光影</small></span><select id="setting-adaptive"><option value="auto">自动流畅</option><option value="native">固定清晰度</option></select></label>
      <label class="setting-row volume-row" for="setting-volume"><span><strong>音效音量</strong><small>引擎、漂移与赛道反馈</small></span><div class="volume-control"><input id="setting-volume" type="range" min="0" max="100" step="1"><output id="volume-output" for="setting-volume">40%</output></div></label>
      <label class="setting-row volume-row" for="setting-music-volume"><span><strong>BGM 音量</strong><small id="setting-music-title"></small></span><div class="volume-control"><input id="setting-music-volume" type="range" min="0" max="100" step="1"><output id="music-volume-output" for="setting-music-volume">35%</output></div></label>
      <label class="setting-row" for="setting-assist"><span><strong>转向辅助</strong><small>靠近边缘时轻微修正方向，油门和刹车由你控制</small></span><input id="setting-assist" class="toggle-input" type="checkbox" role="switch"></label>
      <div class="controls-guide"><h3>把这座园区，开成你的游乐场。</h3><div><span><kbd>W</kbd><kbd>↑</kbd> 加速</span><span><kbd>S</kbd><kbd>↓</kbd> 刹车 / 倒车</span><span><kbd>A</kbd><kbd>D</kbd> 转向</span><span><kbd>SPACE</kbd> 转弯时漂移</span><span><kbd>E</kbd> 使用道具</span><span><kbd>R</kbd> 回到赛道</span><span><kbd>ESC</kbd> 暂停 / 继续</span><span><kbd>C</kbd> 广角 / 俯瞰 / PV 近景</span><span><kbd>H</kbd> 隐藏 / 显示界面</span><span><kbd>鼠标左/右键</kbd> 拖动环视</span><span><kbd>滚轮</kbd> 调整跟车距离</span><span><kbd>双击</kbd> 恢复视角</span></div><p>按住漂移蓄能，松开获得冲刺。收集金币提升极速。</p></div>
      <div class="settings-footer"><span id="settings-fps">画面准备中</span><button id="settings-done" class="pixel-button primary">保存并返回</button></div>
    </section></div>
    <div id="touch-controls" class="touch-controls race-only" aria-label="触屏驾驶控制"><div class="touch-steering"><button data-touch="left" aria-label="左转">◀</button><button data-touch="brake" class="touch-brake" aria-label="刹车">刹车</button><button data-touch="right" aria-label="右转">▶</button></div><div class="touch-actions"><button data-touch="item" class="touch-item" aria-label="使用道具">道具</button><button data-touch="drift" class="touch-drift" aria-label="漂移">漂移</button><button data-touch="throttle" class="touch-throttle" aria-label="加速">加速<br>▲</button></div></div>
  `;
  (document.getElementById('app') || document.body).append(root);
  const $ = id => root.querySelector(`#${id}`);
  const text = (id, value) => { const el = $(id); const next = String(value); if (el.textContent !== next) el.textContent = next; };
  const settings = readSettings();
  let ready = false, state = { phase: 'menu' }, player = {}, modalOpen = false, resumeAfterSettings = false;
  let toastTimer, lastResult, lastMapTime = 0;
  let multiplayer = { open: false, room: null }, lastMultiplayerResult = '';
  const multiplayerLobby = createMultiplayerLobby(root, (action, payload) => {
    releaseTouches(); onMultiplayer?.(action, payload);
  });
  const multiplayerResults = document.createElement('ol');
  multiplayerResults.id = 'mp-finish-rankings'; multiplayerResults.className = 'mp-rankings'; multiplayerResults.hidden = true;
  $('finish-laps').after(multiplayerResults);
  const touchInput = { throttle: 0, brake: 0, steer: 0, drift: false, useItem: false, reset: false };
  const touches = new Map();
  const portrait = createPortraitHUD(root, {input: touchInput, onPause, onItem, onCamera, onReset, onResume});
  function persistSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* Private browser storage may be unavailable. */ }
  }
  function saveSettings() {
    persistSettings();
    onSettingsChange?.({ ...settings });
  }
  function syncSettings() {
    if(PUBLIC_BUILD){$('setting-environment').value='voxel';$('setting-environment').closest('.setting-row').hidden=true;}
    $('setting-environment').value = settings.environmentStyle;
    const voxel = settings.environmentStyle === 'voxel', qualitySelect = $('setting-quality');
    qualitySelect.options[0].textContent = voxel ? '经典体素' : '流畅';
    qualitySelect.options[1].textContent = voxel ? '精细还原' : '高清高阶颜色';
    qualitySelect.value = voxel ? settings.voxelQuality : settings.quality;
    qualitySelect.disabled = false;
    $('setting-pixel').value = String(settings.pixelSize);
    $('setting-render').value = settings.renderQuality;
    $('setting-adaptive').value = settings.adaptiveQuality ? 'auto' : 'native';
    text('setting-quality-description', voxel ? '经典像素或精细实景还原' : '按设备性能选择园区精细度');
    $('setting-volume').value = String(Math.round(settings.volume * 100)); $('volume-output').value = `${Math.round(settings.volume * 100)}%`;
    $('setting-music-volume').value=String(Math.round(settings.musicVolume*100));$('music-volume-output').value=`${Math.round(settings.musicVolume*100)}%`;
    text('setting-music-title',musicReady?musicTitle:`${musicTitle||'背景音乐'} · 等待音频接入`);
    $('setting-assist').checked = settings.assist;
    const muted = settings.muted;
    $('hud-sound').innerHTML = muted ? ICONS.mute : ICONS.sound;
    $('hud-sound').setAttribute('aria-label', muted ? '开启全部声音' : '关闭全部声音');
    $('hud-sound').setAttribute('aria-pressed', String(muted));
  }
  function releaseTouches() {
    portrait.release();
    touches.clear(); Object.assign(touchInput, { throttle: 0, brake: 0, steer: 0, drift: false, useItem: false, reset: false });
    root.querySelectorAll('[data-touch]').forEach(el => el.classList.remove('pressed'));
  }
  function syncMultiplayer() {
    const context = multiplayerLobby.update({ ...multiplayer, ready: ready && multiplayer.ready !== false }, state);
    const active = Boolean(context.room), host = context.room?.hostId === multiplayer.playerId;
    $('main-menu').hidden = state.phase !== 'menu' || context.visible;
    if (context.visible) {
      $('pause-overlay').hidden = true; $('finish-overlay').hidden = true;
      $('countdown').hidden = true; $('hud-toast').hidden = true;
    }
    if (active && context.inRace) {
      $('pause-overlay').hidden = !multiplayer.paused || modalOpen;
      const done = state.phase === 'finished' || Boolean(player.finished) || context.room.status === 'finished';
      $('finish-overlay').hidden = !done || modalOpen || Boolean(multiplayer.paused);
      if (done) {
        const rank = player.rank || state.result?.rank || 1;
        const didNotFinish = Boolean(player.dnf || (!player.finished && context.room.status === 'finished'));
        text('finish-title', didNotFinish ? '比赛结束，下场再战' : rank === 1 ? '今天的冠军，属于你！' : '冲过终点，精彩一战！');
        text('finish-rank', rank); text('finish-total', `/ ${state.vehicles?.length || context.room.maxPlayers || 6}`);
        text('finish-time', didNotFinish ? '未完赛' : formatTime(player.finishTime ?? state.result?.time ?? state.elapsed));
        text('finish-best', formatTime(player.bestLap ?? state.result?.bestLap));
        const resultKey = JSON.stringify([context.room.raceId, context.rankings.map(entry => [entry.id, entry.vehicleId, entry.rank, entry.finished, entry.dnf, entry.name]), multiplayer.playerId]);
        if (lastMultiplayerResult !== resultKey) { lastMultiplayerResult = resultKey; multiplayerLobby.renderRankings(context.rankings, multiplayerResults); }
      }
      $('countdown').hidden ||= Boolean(multiplayer.paused);
    }
    text('pause-description', active ? '这里只暂停你的操作，线上比赛仍在继续。' : '稍歇片刻，比赛已暂停。');
    $('restart-race').hidden = active;
    text('pause-menu', active ? '退出房间' : '返回主菜单');
    text('finish-menu', active ? '退出房间' : '返回主菜单');
    multiplayerResults.hidden = !active;
    const canReturn = active && host && context.room.status === 'finished';
    const finishDeadlines = [state.finishCountdown, state.raceTimeRemaining].filter(Number.isFinite);
    const finishWait = finishDeadlines.length ? Math.max(0, Math.ceil(Math.min(...finishDeadlines))) : null;
    const waitingLabel = `等待其他车手完赛${finishWait === null ? '' : ` · ${finishWait}s`}`;
    $('finish-restart').disabled = active && !canReturn;
    text('finish-restart', active ? canReturn ? '返回房间 · 再来一场' : context.room.status === 'finished' ? '等待房主返回房间' : waitingLabel : '再跑一场 →');
    if (!$('finish-overlay').hidden) { clearTimeout(toastTimer); $('hud-toast').hidden = true; }
    return context;
  }
  function syncTouch() {
    const values = [...touches.values()];
    touchInput.throttle = values.includes('throttle') ? 1 : 0; touchInput.brake = values.includes('brake') ? 1 : 0;
    touchInput.steer = (values.includes('right') ? 1 : 0) - (values.includes('left') ? 1 : 0);
    touchInput.drift = values.includes('drift'); touchInput.useItem = values.includes('item');
    root.querySelectorAll('[data-touch]').forEach(el => el.classList.toggle('pressed', values.includes(el.dataset.touch)));
  }
  root.querySelectorAll('[data-touch]').forEach(button => {
    button.addEventListener('pointerdown', event => {
      if (modalOpen || !['racing', 'countdown'].includes(state.phase)) return;
      event.preventDefault(); button.setPointerCapture(event.pointerId); touches.set(event.pointerId, button.dataset.touch); syncTouch();
    });
    const release = event => { touches.delete(event.pointerId); syncTouch(); };
    button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', event => event.preventDefault());
  });
  window.addEventListener('blur', releaseTouches);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseTouches(); });

  function showSettings() {
    if (modalOpen) return;
    clearTimeout(toastTimer); $('hud-toast').hidden = true;
    modalOpen = true; resumeAfterSettings = state.phase === 'racing' || state.phase === 'countdown';
    if (resumeAfterSettings) onPause?.();
    releaseTouches(); syncSettings(); $('settings-overlay').hidden = false; $('pause-overlay').hidden = true;
    $('settings-close').focus();
  }
  function closeSettings() {
    if (!modalOpen) return;
    modalOpen = false; $('settings-overlay').hidden = true;
    if (resumeAfterSettings) onResume?.();
    else $('pause-overlay').hidden = multiplayer.room ? !multiplayer.paused : state.phase !== 'paused';
    resumeAfterSettings = false;
  }
  $('hud-settings').onclick = showSettings; $('pause-settings').onclick = showSettings;
  $('settings-close').onclick = closeSettings; $('settings-done').onclick = closeSettings;
  $('settings-overlay').addEventListener('click', event => { if (event.target === $('settings-overlay')) closeSettings(); });
  // The game owns Escape for pause. This capture handler consumes Escape only inside settings.
  window.addEventListener('keydown', event => {
    if (event.code === 'Escape' && modalOpen) { event.preventDefault(); event.stopImmediatePropagation(); closeSettings(); }
    if (event.code === 'Tab' && modalOpen) {
      const focusable = [...$('settings-overlay').querySelectorAll('button,select,input')].filter(el => !el.disabled);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }, true);
  $('setting-environment').onchange = event => { settings.environmentStyle = event.target.value === 'gaussian' ? 'gaussian' : 'voxel'; syncSettings(); saveSettings(); };
  $('setting-quality').onchange = event => {
    const value = event.target.value === 'original' ? 'original' : 'pixel';
    if (settings.environmentStyle === 'voxel') settings.voxelQuality = value;
    else settings.quality = value;
    saveSettings();
  };
  $('setting-pixel').onchange = event => { settings.pixelSize = Number(event.target.value); saveSettings(); };
  $('setting-render').onchange = event => { settings.renderQuality = event.target.value==='performance'?'performance':'cinematic'; saveSettings(); };
  $('setting-adaptive').onchange = event => { settings.adaptiveQuality = event.target.value!=='native'; saveSettings(); };
  $('setting-assist').onchange = event => { settings.assist = event.target.checked; saveSettings(); };
  $('setting-volume').oninput = event => {
    settings.volume = Number(event.target.value) / 100;
    if(settings.volume>0)settings.muted=false;
    syncSettings(); saveSettings();
  };
  $('setting-music-volume').oninput=event=>{
    settings.musicVolume=Number(event.target.value)/100;
    if(settings.musicVolume>0)settings.muted=false;
    syncSettings();saveSettings();
  };
  $('hud-sound').onclick = () => {
    settings.muted=!settings.muted;
    if(!settings.muted&&settings.volume===0&&settings.musicVolume===0){settings.volume=.4;settings.musicVolume=.35;}
    syncSettings(); saveSettings(); onMute?.(settings.muted);
  };
  $('hud-pause').onclick = () => onPause?.();
  $('start-race').onclick = () => { if (ready) { releaseTouches(); onStart?.('race'); } };
  $('start-garage').onclick = () => { releaseTouches(); onGarage?.(); };
  $('start-practice').onclick = () => { if (ready) { releaseTouches(); onStart?.('practice'); } };
  $('start-multiplayer').onclick = () => { releaseTouches(); onMultiplayer?.('open', { playerName: multiplayerLobby.playerName }); };
  $('resume-race').onclick = () => onResume?.();
  for (const id of ['restart-race', 'finish-restart']) $(id).onclick = () => {
    releaseTouches();
    if (multiplayer.room) { if (multiplayer.room.hostId === multiplayer.playerId && multiplayer.room.status === 'finished') onMultiplayer?.('lobby'); }
    else onRestart?.();
  };
  for (const id of ['pause-menu', 'finish-menu']) $(id).onclick = () => { releaseTouches(); multiplayer.room ? onMultiplayer?.('leave') : onMenu?.(); };
  $('race-reset').onclick = () => { if (onReset) onReset(); else { touchInput.reset = true; setTimeout(() => { touchInput.reset = false; }, 150); } };
  $('race-item').onclick = () => { if (onItem) onItem(); else { touchInput.useItem = true; setTimeout(() => { touchInput.useItem = false; }, 150); } };
  $('load-retry').onclick = () => onRetry?.();
  $('scene-load-retry').onclick = () => onRetry?.();
  // Complete older saved settings without invoking load callbacks during HUD construction.
  persistSettings();
  syncSettings();

  const mapCanvas = $('map-canvas'), context = mapCanvas.getContext('2d');
  let mapPoints = [], mapScale = 1, minX = 0, minZ = 0, mapOffsetX = 0, mapOffsetY = 0;
  if (track) {
    mapPoints = Array.from({ length: 256 }, (_, i) => track.getPoint(i / 256));
    const xs = mapPoints.map(p => p.x), zs = mapPoints.map(p => p.z);
    minX = Math.min(...xs); minZ = Math.min(...zs);
    const spanX = Math.max(...xs) - minX || 1, spanZ = Math.max(...zs) - minZ || 1;
    mapScale = Math.min(204 / spanX, 140 / spanZ);
    mapOffsetX = (252 - spanX * mapScale) / 2; mapOffsetY = (174 - spanZ * mapScale) / 2;
  }
  const project = v => ({ x: Math.round((v.x - minX) * mapScale + mapOffsetX), y: Math.round((v.z - minZ) * mapScale + mapOffsetY) });
  function drawMap(vehicles = [], robot, localPlayerId = 0) {
    const now = performance.now(); if (now - lastMapTime < 65) return; lastMapTime = now;
    if (!context || !mapPoints.length) return;
    context.clearRect(0, 0, 252, 182); context.imageSmoothingEnabled = false;
    context.beginPath(); mapPoints.forEach((p, i) => { const s = project(p); i ? context.lineTo(s.x, s.y) : context.moveTo(s.x, s.y); }); context.closePath();
    context.lineJoin = 'miter'; context.strokeStyle = '#172029'; context.lineWidth = 8; context.stroke();
    context.strokeStyle = '#f4e6c6'; context.lineWidth = 4; context.stroke();
    const guardian = project(ROBOT_SITE), attacking = robot?.phase === 'warning' || robot?.phase === 'strike';
    context.fillStyle = '#172029'; context.fillRect(guardian.x - 7, guardian.y - 6, 14, 12); context.fillRect(guardian.x - 9, guardian.y - 2, 18, 5);
    context.fillStyle = attacking ? '#ef6b48' : '#24bec9'; context.fillRect(guardian.x - 5, guardian.y - 4, 10, 8);
    context.fillStyle = '#fff3d7'; context.fillRect(guardian.x - 3, guardian.y - 1, 2, 2); context.fillRect(guardian.x + 1, guardian.y - 1, 2, 2);
    if (attacking && robot.aim) { const aim = project(robot.aim); context.strokeStyle = '#ef573e'; context.lineWidth = 2; context.strokeRect(aim.x - 4, aim.y - 4, 8, 8); }
    for (const missile of robot?.barrage?.missiles || []) {
      if ((robot.barrage.renderTime ?? robot.barrage.time) >= missile.impactAt) continue;
      const p = project(missile.aim); context.strokeStyle = '#da452e'; context.lineWidth = 2;
      context.strokeRect(p.x - 3, p.y - 3, 6, 6); context.beginPath();
      context.moveTo(p.x - 5, p.y); context.lineTo(p.x + 5, p.y); context.moveTo(p.x, p.y - 5); context.lineTo(p.x, p.y + 5); context.stroke();
    }
    const finish = project(mapPoints[0]);
    context.fillStyle = '#172029'; context.fillRect(finish.x + 2, finish.y - 23, 2, 24);
    for (let x = 0; x < 4; x++) for (let y = 0; y < 3; y++) { context.fillStyle = (x + y) % 2 ? '#f4e6c6' : '#172029'; context.fillRect(finish.x + 4 + x * 4, finish.y - 23 + y * 4, 4, 4); }
    const dots = [...vehicles].sort((a, b) => Number(a.id === localPlayerId) - Number(b.id === localPlayerId));
    for (const v of dots) {
      const p = project(v), size = v.id === localPlayerId ? 10 : 6;
      context.fillStyle = '#172029'; context.fillRect(p.x - size / 2 - 1, p.y - size / 2 - 1, size + 2, size + 2);
      context.fillStyle = v.color || (v.id === localPlayerId ? '#db4939' : '#668688'); context.fillRect(p.x - size / 2, p.y - size / 2, size, size);
      if (v.id === localPlayerId) { context.fillStyle = '#fff7e8'; context.fillRect(p.x - 2, p.y - 3, 3, 3); }
    }
  }
  drawMap([]);

  function update(nextState = {}, nextPlayer) {
    const oldPhase = state.phase; state = nextState; player = nextPlayer || nextState.vehicles?.[0] || {};
    const phase = state.phase || 'menu'; root.dataset.phase = phase;
    if (oldPhase !== phase && !['racing', 'countdown'].includes(phase)) releaseTouches();
    $('main-menu').hidden = phase !== 'menu'; $('pause-overlay').hidden = phase !== 'paused' || modalOpen;
    $('finish-overlay').hidden = phase !== 'finished' || !state.result || modalOpen;
    $('countdown').hidden = phase !== 'countdown' || modalOpen;
    if (phase === 'countdown') text('countdown', Math.max(1, Math.ceil(state.countdown || 0)));
    text('race-rank', state.mode === 'practice' ? '∞' : player.rank || 1);
    text('rank-label', state.mode === 'practice' ? 'FREE RUN' : 'POSITION');
    text('race-total', state.mode === 'practice' ? '' : `/ ${state.vehicles?.length || 6}`);
    const lapHTML = `${player.lap || 1} <em>/ ${state.mode === 'practice' ? '∞' : state.totalLaps || RACE_LAPS}</em>`;
    if ($('race-lap').innerHTML !== lapHTML) $('race-lap').innerHTML = lapHTML;
    text('race-time', formatTime(state.elapsed || 0)); text('race-speed', String(state.speedKmh || Math.round(Math.abs(player.speed || 0) * 3.6)).padStart(3, '0'));
    text('race-coins', String(player.coins || 0).padStart(2, '0'));
    text('best-lap', Number.isFinite(player.bestLap) ? `BEST ${formatTime(player.bestLap)}` : '');
    text('item-name', ITEM_NAMES[player.item] || '收集道具箱'); text('item-symbol', ITEM_SYMBOLS[player.item] || '?');
    $('race-item').disabled = !player.item || !!player.crash || !!player.grannyBlock || phase !== 'racing'; $('race-item').dataset.item = player.item || 'empty';
    const charge = Math.min(1, (player.driftCharge || 0) / 3), level = charge >= .70 ? 3 : charge >= .43 ? 2 : charge >= .216 ? 1 : 0;
    $('drift-fill').style.width = `${charge * 100}%`; $('drift-fill').dataset.level = String(level);
    text('drift-label', player.drift ? '松开漂移 · 释放冲刺' : 'SPACE · 漂移蓄能');
    text('drift-level', player.drift ? ['CHARGING', 'BOOST I', 'BOOST II', 'BOOST III'][level] : 'READY');
    const catchup = player.catchupBoost > .05;
    $('boost-message').hidden = !((player.boost > 0 || catchup) && player.stun <= 0 && phase === 'racing');
    text('boost-title', catchup ? 'CATCH UP' : 'OVERDRIVE');
    text('boost-hint', catchup ? player.catchupActive ? '末位涡轮 · 自动加速' : '涡轮余劲' : '超频冲刺');
    const recovery = player.crash ? Math.max(0, player.crash.at + player.crash.duration - (state.renderTime ?? state.elapsed)) : 0;
    const held = player.crash?.sourceKind==='kong' && (state.renderTime??state.elapsed)-player.crash.at<player.crash.grabDuration;
    const crashLabel=player.crash?.mode==='burn'?(player.crash.sourceKind==='missile'?'导弹击中，车辆焚毁！':'坠入弹坑，车辆焚毁！'):player.crash?.sourceKind==='kong'?'被抛出赛道！':'被撞飞！';
    const warning = player.crash ? held ? '被金刚抓住了！' : `${crashLabel}${recovery.toFixed(1)} 秒后复位` : state.wrongWay || player.wrongWay ? '方向反啦！调头追上车队。' : player.offRoad ? '驶回赛道，继续冲刺！' : '';
    const grannyWarning=player.grannyBlock?`等奶奶起身 · ${Math.max(0,player.grannyBlock.until-(state.renderTime??state.elapsed)).toFixed(1)} 秒`:'';
    $('race-warning').hidden = !(grannyWarning||warning) || phase !== 'racing'; text('race-warning', grannyWarning||warning);
    if(player.crash||player.grannyBlock){clearTimeout(toastTimer);$('hud-toast').hidden=true;}
    const robot = state.robot, robotAttacking = robot?.kind === 'pulse' && ['warning', 'strike'].includes(robot.phase);
    const robotNearby = robotAttacking && Math.hypot(player.x - robot.aim.x, player.z - robot.aim.z) < 65;
    $('guardian-alert').hidden = !robotNearby || phase !== 'racing' || modalOpen;
    if (robotNearby) {
      const remaining = Math.max(0, robot.phaseDuration - robot.phaseTime), isWarning = robot.phase === 'warning';
      text('guardian-title', `能量冲击${isWarning ? ` · ${remaining.toFixed(1)}s` : '！'}`);
      text('guardian-hint', isWarning ? '避开路面的警示区 · 护盾可抵挡' : '冲击已落下 · 抓住空隙通过');
      $('guardian-fill').style.width = `${isWarning ? Math.max(0, Math.min(100, remaining / robot.phaseDuration * 100)) : 0}%`;
      $('guardian-alert').dataset.targeted = String(robot.targetId === player.id);
    }
    if (state.result && state.result !== lastResult) {
      lastResult = state.result; const r = state.result;
      text('finish-title', r.rank === 1 ? '今天的冠军，属于你！' : '畅游园区，完赛！');
      text('finish-rank', r.rank); text('finish-total', `/ ${r.total || 6}`); text('finish-time', formatTime(r.time)); text('finish-best', formatTime(r.bestLap));
      $('finish-laps').replaceChildren(...(r.lapTimes || []).map((time, i) => {
        const row = document.createElement('div'), label = document.createElement('span'), value = document.createElement('strong');
        label.textContent = `LAP ${String(i + 1).padStart(2, '0')}`; value.textContent = formatTime(time); row.append(label, value); return row;
      }));
    }
    syncMultiplayer();
    portrait.update(state, player, modalOpen || !!multiplayer.paused || multiplayerLobby.visible || !ready);
  }
  return {
    update, showSettings, drawMap, touchInput, releaseTouches,
    get portrait() { return portrait.active; },
    setMultiplayer(view = {}) { multiplayer = { ...multiplayer, ...view }; const context = syncMultiplayer(); if (context.visible || multiplayer.paused) releaseTouches(); },
    get multiplayerOpen() { return multiplayerLobby.visible; },
    get settings() { return { ...settings }; },
    get settingsOpen() { return modalOpen; },
    setLoading(progress, message, error = false) {
      ready = false; root.dataset.ready = 'false'; $('start-race').disabled = true; $('start-practice').disabled = true; $('start-garage').disabled = true;
      const amount = Math.min(100, Math.max(0, Number(progress) > 1 ? Number(progress) : Number(progress) * 100)) || 0;
      $('load-status').hidden = false; $('load-status').classList.toggle('load-error', Boolean(error));
      text('load-message', message || (error ? '加载未完成，请重试。' : '正在唤醒像素赛道…'));
      text('load-percent', error ? '!' : `${Math.round(amount)}%`); $('load-fill').style.width = `${amount}%`; $('load-retry').hidden = !error;
      $('scene-load-status').hidden = false; $('scene-load-retry').hidden = !error;
      text('scene-load-message', `${message || '正在载入园区实景…'}${error ? '' : ` ${Math.round(amount)}%`}`);
      syncMultiplayer();
    },
    setReady(info = {}) {
      ready = true; root.dataset.ready = 'true'; $('start-race').disabled = false; $('start-practice').disabled = false; $('start-garage').disabled = false;
      $('load-status').hidden = true; $('load-status').classList.remove('load-error');
      $('scene-load-status').hidden = true;
      const details = info && typeof info === 'object' ? info : {};
      const environmentStyle = ['voxel', 'gaussian'].includes(details.environmentStyle) ? details.environmentStyle : settings.environmentStyle;
      root.dataset.environment = typeof info === 'string' ? info : (details.name || '首钢园');
      root.dataset.environmentStyle = environmentStyle;
      text('menu-environment-source', environmentStyle === 'gaussian' ? '首钢园实景高斯' : '首钢园实景重构');
      for (const key of ['numVoxels', 'numSplats']) {
        if (Number.isFinite(details[key])) root.dataset[key] = String(details[key]);
        else delete root.dataset[key];
      }
      syncMultiplayer();
    },
    toast(message) {
      if(modalOpen || !$('finish-overlay').hidden)return;
      portrait.notify(message);
      clearTimeout(toastTimer); text('hud-toast', message); $('hud-toast').hidden = false;
      toastTimer = setTimeout(() => { $('hud-toast').hidden = true; }, 2500);
    },
    setFPS(fps) { text('settings-fps', Number.isFinite(fps) ? `${Math.round(fps)} FPS · 实时帧率` : '画面准备中'); },
  };
}

