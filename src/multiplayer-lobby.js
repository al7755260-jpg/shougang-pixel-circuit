import './multiplayer-lobby.css';
import {vehicleById} from './vehicles/catalog.js';
import {inviteAddresses,isLocalAddress} from './room-invite.js';

const NAME_KEY = 'shougang-player-name';
const RACE_STATUSES = new Set(['countdown', 'racing', 'finished']);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function safeColor(value) {
  if (typeof value === 'number') return `#${value.toString(16).padStart(6, '0').slice(-6)}`;
  return /^#[0-9a-f]{3,8}$/i.test(value || '') ? value : '#77d8de';
}

function cleanName(value) { return String(value || '').trim().slice(0, 16); }

export function createMultiplayerLobby(root, onAction) {
  const overlay = element('div', 'mp-backdrop');
  overlay.id = 'multiplayer-overlay'; overlay.hidden = true;
  // Only static labels use HTML. Player names, room names and server messages use textContent.
  overlay.innerHTML = `
    <section class="mp-panel pixel-paper" role="dialog" aria-modal="true" aria-labelledby="mp-title">
      <header class="mp-heading"><div><div class="modal-eyebrow">SHOUGANG / ONLINE CIRCUIT</div><h2 id="mp-title">一起，驰骋首钢园。</h2></div><button id="mp-close" class="close-button" aria-label="返回单人模式">×</button></header>
      <div class="mp-status-line"><span id="mp-connection" class="mp-connection" role="status">连接中</span><span class="mp-capacity">最多 6 位车手</span></div>
      <p id="mp-error" class="mp-error" role="alert" hidden></p>
      <div id="mp-loading" class="mp-loading" role="status" hidden>园区正在加载，加载完成后即可创建或加入房间。</div>
      <div id="mp-lobby">
        <div id="mp-invitation" class="mp-invitation" hidden><span id="mp-invitation-note" role="status"></span><div><button id="mp-invite-retry" class="text-button">重新加入</button><button id="mp-invite-dismiss" class="text-button">返回大厅</button></div></div>
        <button id="mp-vehicle" class="text-button">更换座驾</button>
        <div class="mp-fields"><label class="mp-field" for="mp-player-name"><span>你的车手昵称</span><input id="mp-player-name" name="nickname" maxlength="16" placeholder="给自己起个名字" autocomplete="nickname" spellcheck="false"></label>
        <label class="mp-field" for="mp-room-name"><span>新房间名称</span><input id="mp-room-name" maxlength="24" placeholder="首钢园好友局" autocomplete="off" spellcheck="false"></label>
        <button id="mp-create" class="pixel-button primary">＋ 创建房间</button></div>
        <div class="mp-list-heading"><h3>赛道房间 <span id="mp-room-count">0</span></h3><button id="mp-refresh" class="text-button">刷新房间</button></div>
        <div id="mp-room-list" class="mp-room-list" aria-label="可加入的房间"></div>
        <div id="mp-empty" class="mp-empty"><div class="mp-empty-track" aria-hidden="true">▰ ━ ━ ▰</div><strong>还没有房间，开第一场吧。</strong><span>创建房间，邀请朋友一起出发。</span></div>
      </div>
      <div id="mp-room" hidden>
        <div class="mp-room-heading"><div><span class="mp-small-label">YOUR CREW / 当前房间</span><h3 id="mp-current-name"></h3></div><span id="mp-current-count" class="mp-count-badge"></span></div>
        <div id="mp-player-list" class="mp-player-list" aria-label="房间内的车手"></div>
        <p id="mp-host-note" class="mp-host-note">房主随时可以开始，空位由 AI 车手补齐。</p>
        <button id="mp-start" class="pixel-button primary">发车！开始比赛 →</button>
        <button id="mp-leave" class="text-button mp-leave">退出房间</button>
      </div>
      <footer class="mp-footer"><div class="mp-share-heading"><span id="mp-share-title">邀请朋友一起玩</span><button id="mp-retry" class="text-button" hidden>重新连接</button></div><label id="mp-share-choices" class="mp-share-choices" for="mp-share-select" hidden><span>分享方式</span><select id="mp-share-select" aria-label="选择好友邀请地址"></select></label><div class="mp-share-row"><input id="mp-share-url" aria-label="好友邀请链接" readonly><button id="mp-copy" class="mp-copy">复制邀请链接</button></div><p id="mp-share-help" role="status"></p><button id="mp-back" class="text-button">← 返回单人模式</button></footer>
    </section>`;
  root.append(overlay);
  const race = element('aside', 'mp-race-panel'); race.id = 'mp-race-panel'; race.hidden = true;
  race.innerHTML = '<div class="mp-race-network"><i aria-hidden="true"></i><strong id="mp-race-name"></strong><span id="mp-latency"></span></div><ol id="mp-race-rankings" class="mp-rankings"></ol>';
  root.append(race);
  const $ = id => root.querySelector(`#${id}`);
  const setText = (id, text) => { const node = $(id), next = String(text ?? ''); if (node.textContent !== next) node.textContent = next; };
  let view = { open: false, ready: false, connection: 'idle', room: null, rooms: [], playerId: null, shareUrls: [], latency: null };
  let renderKey = '', rankKey = '', shareKey = '', shareListKey = '', selectedShareUrl = '', shareChoiceExplicit = false, lastLobbyVisible = false;
  let savedName = '';
  try { savedName = cleanName(localStorage.getItem(NAME_KEY)); } catch { /* Nicknames work without storage. */ }
  $('mp-player-name').value = savedName;
  const playerName = () => cleanName($('mp-player-name').value) || '像素车手';
  const emit = (action, payload) => onAction?.(action, payload);
  const saveName = () => {
    const name = playerName();
    try { localStorage.setItem(NAME_KEY, name); } catch { /* Nicknames work without storage. */ }
    emit('name', { name });
    return name;
  };
  $('mp-player-name').addEventListener('change', saveName);
  $('mp-vehicle').onclick=()=>emit('vehicle');
  for (const input of overlay.querySelectorAll('input,select')) {
    input.addEventListener('keydown', event => { if (!['Tab', 'Escape'].includes(event.key)) event.stopPropagation(); });
    input.addEventListener('keyup', event => event.stopPropagation());
  }
  $('mp-create').onclick = () => {
    if (!view.ready || view.connection !== 'connected' || view.room) return;
    emit('create', { name: $('mp-room-name').value.trim().slice(0, 24) || '首钢园好友局', playerName: saveName() });
  };
  $('mp-room-name').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('mp-create').click(); } });
  $('mp-start').onclick = () => { if (view.ready && view.room?.status === 'waiting' && view.room.hostId === view.playerId) emit('start'); };
  $('mp-leave').onclick = () => emit('leave');
  const close = () => emit(view.room ? 'leave' : 'close');
  $('mp-close').onclick = close; $('mp-back').onclick = close;
  $('mp-refresh').onclick = () => emit('connect'); $('mp-retry').onclick = () => emit('connect');
  $('mp-invite-retry').onclick=()=>emit('invite-retry');
  $('mp-invite-dismiss').onclick=()=>emit('invite-dismiss');
  function selectShareUrl(url) {
    selectedShareUrl = url; shareKey = url; $('mp-share-url').value = url; $('mp-share-select').value = url;
    setText('mp-share-help', shareHelp(url));
  }
  function shareHelp(url) {
    if(!url)return '连接大厅后生成邀请链接。';
    const access=isLocalAddress(url)?'此链接仅限同一 Wi-Fi／局域网。':'外网好友也可访问；请保持本机游戏服务运行。';
    return `${view.room?'好友打开链接，选好座驾即可直接加入本房间。':'创建房间后，链接会自动指向你的房间。'}${access}`;
  }
  $('mp-share-select').onchange = event => {shareChoiceExplicit=true;selectShareUrl(event.target.value);};
  $('mp-copy').onclick = async () => {
    const input = $('mp-share-url'); if (!input.value) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(input.value);
      setText('mp-share-help', `邀请链接已复制。${shareHelp(input.value)}`);
    } catch {
      input.focus(); input.select(); input.setSelectionRange(0, input.value.length);
      let copied = false;
      try { copied = document.execCommand('copy'); } catch { /* The selectable address remains available. */ }
      setText('mp-share-help', copied ? `邀请链接已复制。${shareHelp(input.value)}` : '链接已选中，请按 Ctrl+C，或长按地址选择复制。');
    }
  };
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key !== 'Tab') return;
    const controls = [...overlay.querySelectorAll('button,input,select')].filter(node => !node.disabled && node.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });

  function renderRooms() {
    const rooms = Array.isArray(view.rooms) ? view.rooms : [];
    setText('mp-room-count', rooms.length);
    $('mp-room-list').replaceChildren(...rooms.map(room => {
      const button = element('button', 'mp-room-card'); button.type = 'button';
      const count = room.players?.length ?? room.playerCount ?? 0, max = room.maxPlayers || 6;
      const waiting = room.status === 'waiting';
      button.disabled = !view.ready || view.connection !== 'connected' || !waiting || count >= max;
      const icon = element('span', 'mp-room-icon', '▰'); icon.setAttribute('aria-hidden', 'true');
      const names = element('span', 'mp-room-description');
      names.append(element('strong', '', room.name || '首钢园好友局'), element('small', '', waiting ? count >= max ? '已满员' : '等待发车' : '比赛进行中'));
      button.append(icon, names, element('span', 'mp-room-players', `${count} / ${max}`), element('span', 'mp-room-enter', waiting && count < max ? '加入 →' : '—'));
      button.onclick = () => emit('join', { roomId: room.id, playerName: saveName() });
      return button;
    }));
    $('mp-empty').hidden = rooms.length > 0;
    const connected = view.connection === 'connected';
    const emptyTitle = $('mp-empty').querySelector('strong'), emptyDescription = $('mp-empty').querySelector('span');
    emptyTitle.textContent = connected ? '还没有房间，开第一场吧。' : view.connection === 'connecting' ? '正在连接车手大厅…' : '暂时没有连接到大厅。';
    emptyDescription.textContent = connected ? '创建房间，邀请朋友一起出发。' : '连接成功后，会在这里显示可加入的房间。';
  }

  function renderPlayers() {
    const room = view.room; if (!room) return;
    const players = room.players || [], host = room.hostId === view.playerId;
    setText('mp-current-name', room.name); setText('mp-current-count', `${players.length} / ${room.maxPlayers || 6}`);
    const slots = players.map((player, i) => {
      const row = element('div', 'mp-player-slot'); row.dataset.local = String(player.id === view.playerId);
      const kart = element('span', 'mp-player-kart'); kart.style.setProperty('--kart-color', safeColor(player.color)); kart.setAttribute('aria-hidden', 'true');
      const detail = element('div', 'mp-player-detail');
      const model=vehicleById(player.modelId);
      detail.append(element('strong', '', player.name || `车手 ${i + 1}`), element('small', '', model?`${player.id===view.playerId?'你 · ':''}${model.name}`:player.id === view.playerId ? '你 · 已入座' : '车手已入座'));
      row.append(kart, detail);
      if (room.hostId === player.id) row.append(element('span', 'mp-host-badge', '房主'));
      return row;
    });
    while (slots.length < (room.maxPlayers || 6)) {
      const row = element('div', 'mp-player-slot mp-ai-slot');
      const kart = element('span', 'mp-player-kart'); kart.setAttribute('aria-hidden', 'true');
      const detail = element('div', 'mp-player-detail'); detail.append(element('strong', '', '等待车手加入'), element('small', '', '空位由 AI 车手补齐'));
      row.append(kart, detail, element('span', 'mp-ai-badge', 'AI')); slots.push(row);
    }
    $('mp-player-list').replaceChildren(...slots);
    $('mp-start').disabled = !host || !view.ready || view.connection !== 'connected' || room.status !== 'waiting';
    setText('mp-start', host ? '发车！开始比赛 →' : '等待房主开始比赛');
    setText('mp-host-note', host ? '无需等待确认，随时发车。空位由 AI 车手补齐。' : '房主可以随时发车，比赛开始时你会自动进入赛道。');
  }

  function renderRankings(entries = [], target = $('mp-race-rankings')) {
    const rows = [...entries].sort((a, b) => (a.rank || 99) - (b.rank || 99)).map((entry, index) => {
      const participant = view.room?.players?.find(p => p.vehicleId === (entry.vehicleId ?? entry.id));
      const local = participant?.id === view.playerId || entry.playerId === view.playerId || (view.localPlayerId !== undefined && (entry.vehicleId ?? entry.id) === view.localPlayerId);
      const row = element('li', 'mp-rank-row'); row.dataset.local = String(local);
      const rank = element('b', '', String(entry.rank || index + 1).padStart(2, '0'));
      const color = element('i', 'mp-rank-color'); color.style.backgroundColor = safeColor(entry.color || participant?.color);
      const name = participant?.name || entry.name || `AI 车手 ${index + 1}`;
      const ai = entry.isAI ?? !participant;
      const label = element('span', 'mp-rank-name', `${name}${local ? ' · 你' : ''}`);
      const tag = element('small', '', entry.dnf ? 'DNF' : entry.finished ? '完赛' : ai ? 'AI' : '');
      if (entry.dnf) { tag.title = '未完赛'; tag.setAttribute('aria-label', '未完赛'); row.dataset.dnf = 'true'; }
      row.append(rank, color, label, tag); return row;
    });
    target.replaceChildren(...rows);
  }

  function update(next = {}, state = {}) {
    view = { ...view, ...next };
    if (view.name && document.activeElement !== $('mp-player-name')) $('mp-player-name').value = cleanName(view.name);
    const room = view.room, inRace = Boolean(room && RACE_STATUSES.has(room.status));
    const visible = Boolean(view.open && !inRace);
    overlay.hidden = !visible;
    root.dataset.multiplayer = room ? 'room' : view.open ? 'lobby' : 'off';
    root.dataset.multiplayerLobby = String(visible);
    $('mp-lobby').hidden = Boolean(room); $('mp-room').hidden = !room;
    const sharePanel=overlay.querySelector('.mp-footer');
    if(room&&sharePanel.parentElement!==$('mp-room'))$('mp-room').querySelector('.mp-room-heading').after(sharePanel);
    else if(!room&&sharePanel.parentElement===$('mp-room'))overlay.querySelector('.mp-panel').append(sharePanel);
    $('mp-close').setAttribute('aria-label', room ? '退出房间' : '返回单人模式');
    $('mp-loading').hidden = Boolean(view.ready);
    $('mp-create').disabled = !view.ready || view.connection !== 'connected';
    $('mp-retry').hidden = !['idle', 'disconnected'].includes(view.connection);
    $('mp-refresh').disabled = view.connection === 'connecting';
    setText('mp-connection', { idle: '尚未连接', connecting: '连接大厅中…', connected: '大厅已连接', disconnected: '连接已断开' }[view.connection] || '连接中…');
    $('mp-connection').dataset.connected = String(view.connection === 'connected');
    setText('mp-error', view.error || ''); $('mp-error').hidden = !view.error;
    $('mp-invitation').hidden=!view.invitedRoomId||!!room;
    setText('mp-invitation-note',`好友邀请 · 房间 ${view.invitedRoomId||''}${view.inviteStatus==='joining'?' · 正在加入…':''}`);
    $('mp-invite-retry').hidden=view.inviteStatus!=='error';
    $('mp-invite-retry').disabled=!view.ready||view.connection==='connecting';
    $('mp-invite-dismiss').disabled=view.inviteStatus==='joining';
    const key = JSON.stringify([view.connection, view.rooms, room, view.ready, view.playerId]);
    if (key !== renderKey) { renderKey = key; renderRooms(); renderPlayers(); }
    const urls = inviteAddresses(Array.isArray(view.shareUrls)?view.shareUrls:[],location.href,room?.id);
    const urlsKey = JSON.stringify(urls);
    if (urlsKey !== shareListKey) {
      shareListKey = urlsKey;
      $('mp-share-select').replaceChildren(...urls.map((url, index) => {
        const option = element('option'); option.value = url;
        let host = url; try { host = new URL(url).host; } catch { /* Keep the supplied address readable. */ }
        option.textContent = `${isLocalAddress(url)?'同一 Wi-Fi':'外网邀请'} · ${host}`;
        return option;
      }));
    }
    const shared = shareChoiceExplicit&&urls.includes(selectedShareUrl) ? selectedShareUrl : urls[0] || '';
    if (shared !== shareKey) selectShareUrl(shared);
    $('mp-share-select').value = shared; $('mp-share-choices').hidden = urls.length < 2;
    $('mp-share-url').placeholder = '正在生成邀请链接…'; $('mp-copy').disabled = !shared;
    setText('mp-share-title',room?`邀请好友 · 房间 ${room.id}`:'邀请朋友一起玩');
    $('mp-back').hidden = Boolean(room);
    race.hidden = !inRace || state.phase === 'menu' || view.paused || state.phase === 'finished';
    const participant = room?.players?.find(p => p.id === view.playerId);
    setText('mp-race-name', participant?.name || '多人竞速');
    const latency = Number(view.latency);
    setText('mp-latency', view.connection !== 'connected' ? '连接中断' : Number.isFinite(latency) && view.latency !== null ? `${Math.max(0, Math.round(latency))} ms` : '联机中');
    race.dataset.disconnected = String(view.connection !== 'connected');
    const rankings = view.rankings || state.vehicles || [];
    const nextRankKey = JSON.stringify(rankings.map(v => [v.id, v.vehicleId, v.name, v.rank, v.finished, v.dnf, v.color, v.isAI]));
    const fullRankKey = `${nextRankKey}:${view.playerId}:${room?.raceId}`;
    if (rankKey !== fullRankKey) { rankKey = fullRankKey; renderRankings(rankings); }
    if (visible && !lastLobbyVisible) {
      queueMicrotask(() => { if (!overlay.hidden) (room ? $('mp-leave') : $('mp-player-name')).focus({ preventScroll: true }); });
    }
    lastLobbyVisible = visible;
    return { visible, inRace, room, rankings, view };
  }

  return { update, renderRankings, get playerName() { return playerName(); }, get visible() { return !overlay.hidden; } };
}
