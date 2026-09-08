import { randomBytes, randomUUID } from 'node:crypto';
import os from 'node:os';
import { WebSocket, WebSocketServer } from 'ws';
import { createTrack } from '../src/track.js';
import { RaceGame } from '../src/gameplay.js';
import { validVehicleId, vehicleById } from '../src/vehicles/catalog.js';
import { encodeSnapshot } from './snapshot-codec.js';

export const MAX_PLAYERS = 6;
const MAX_ROOMS = 16, MAX_CONNECTIONS = 128, INPUT_TIMEOUT = 400;
const NEUTRAL = Object.freeze({ throttle: 0, brake: 0, steer: 0, drift: false, useItem: false, reset: false });
const COLORS = ['#ff665c', '#55dfb5', '#ffc257', '#74b9ff', '#be93fd', '#ff9bd2'];
const activeRace = room => room && (room.status === 'countdown' || room.status === 'racing');
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const cleanName = (name, fallback, length) => typeof name === 'string'
  ? name.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, length) || fallback : fallback;

export function shareUrls(port) {
  const addresses = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) for (const entry of entries || []) {
    if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.'))
      addresses.push({ address: entry.address, virtual: /virtual|vpn|wsl|docker|tailscale|zerotier|vethernet|vmware|hyper-v/i.test(name) });
  }
  return [...new Set(addresses.sort((a, b) => Number(a.virtual) - Number(b.virtual)).map(entry => `http://${entry.address}:${port}/?multiplayer=1`))];
}

function bucket(rate, capacity, now) { return { rate, capacity, tokens: capacity, updated: now }; }
function consume(bucket, now) {
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + Math.max(0, now - bucket.updated) * bucket.rate / 1000);
  bucket.updated = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens--;
  return true;
}

/** One process owns every simulation. Clients can only submit steering/pedals. */
export class MultiplayerServer {
  constructor(server, { autoTick = true, now = Date.now,publicPage='' } = {}) {
    this.server = server;
    this.now = now;
    this.rooms = new Map();
    this.peers = new Map();
    this.publicOrigin = '';
    this.publicPage=publicPage?new URL(publicPage).href:'';
    this.allowedOrigin=publicPage?new URL(publicPage).origin:'';
    this.track = createTrack();
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
    this.upgrade = (request, socket, head) => {
      let url;
      try { url = new URL(request.url, 'http://localhost'); } catch { socket.destroy(); return; }
      if (url.pathname !== '/multiplayer') { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
      if (request.method !== 'GET' || this.peers.size >= MAX_CONNECTIONS) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
      if (request.headers.origin) {
        let origin;
        try { origin = new URL(request.headers.origin); } catch { socket.destroy(); return; }
        if (!['http:', 'https:'].includes(origin.protocol) || (origin.host.toLowerCase() !== String(request.headers.host).toLowerCase()&&origin.origin!==this.allowedOrigin)) {
          socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
        }
      }
      this.wss.handleUpgrade(request, socket, head, ws => this.connect(ws));
    };
    server.on('upgrade', this.upgrade);
    this.heartbeat = setInterval(() => {
      for (const peer of this.peers.values()) {
        if (!peer.alive) { peer.ws.terminate(); continue; }
        peer.alive = false;
        peer.ws.ping();
      }
    }, 15000);
    this.heartbeat.unref();
    if (autoTick) {
      let previous = performance.now(), accumulator = 0;
      this.timer = setInterval(() => {
        const current = performance.now();
        accumulator += Math.min(.25, Math.max(0, (current - previous) / 1000)); previous = current;
        while (accumulator >= 1 / 60) { this.step(1 / 60); accumulator -= 1 / 60; }
      }, 8);
      this.timer.unref();
    }
  }

  getShareUrls() { return [...(this.publicOrigin&&this.publicPage?[`${this.publicPage}?multiplayer=1&server=${encodeURIComponent(this.publicOrigin)}`]:this.publicOrigin?[`${this.publicOrigin}/?multiplayer=1`]:[]),...shareUrls(this.server.address()?.port || 4192)]; }

  setPublicOrigin(value) {
    let origin='';
    if(value){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)throw new Error('External invitations require an HTTPS origin');origin=url.origin;}
    this.publicOrigin=origin;
    for(const peer of this.peers.values())this.send(peer,{type:'share',shareUrls:this.getShareUrls()});
  }

  send(peer, message) {
    if (peer.ws.readyState !== WebSocket.OPEN) return;
    if (peer.ws.bufferedAmount > 1024 * 1024) { peer.ws.close(1013, '连接过慢，请重新加入'); return; }
    peer.ws.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  error(peer, code, message) { this.send(peer, { type: 'error', code, message }); }

  roomView(room) {
    return {
      id: room.id, name: room.name, hostId: room.hostId, status: room.status,
      players: [...room.players.values()].map(peer => ({ id: peer.id, name: peer.name, vehicleId: peer.vehicleId, modelId:peer.modelId||null, color: peer.modelId?'#'+vehicleById(peer.modelId).color.toString(16).padStart(6,'0'):COLORS[peer.vehicleId] })),
      maxPlayers: MAX_PLAYERS, raceId: room.raceId,
    };
  }

  roomList() { return [...this.rooms.values()].map(room => this.roomView(room)); }

  broadcastRooms() {
    const message = JSON.stringify({ type: 'rooms', rooms: this.roomList() });
    for (const peer of this.peers.values()) this.send(peer, message);
  }

  broadcastRoom(room) {
    const message = JSON.stringify({ type: 'room', room: this.roomView(room) });
    for (const peer of room.players.values()) this.send(peer, message);
    this.broadcastRooms();
  }

  connect(ws) {
    const now = this.now();
    const peer = { id: randomUUID(), name: '赛车手', ws, roomId: null, vehicleId: null, alive: true,
      lastSeq: -1, inputAt: 0, input: NEUTRAL, rate: bucket(90, 120, now), controls: bucket(5, 12, now), violations: 0 };
    this.peers.set(peer.id, peer);
    ws.on('pong', () => { peer.alive = true; });
    ws.on('error', () => {});
    ws.on('close', () => { this.leave(peer); this.peers.delete(peer.id); });
    ws.on('message', (data, binary) => {
      const now = this.now();
      if (!consume(peer.rate, now)) {
        if (++peer.violations > 10) ws.close(1008, '发送太频繁');
        return;
      }
      if (binary) { this.error(peer, 'INVALID_MESSAGE', '只接受 JSON 消息。'); return; }
      let message;
      try { message = JSON.parse(data.toString()); } catch { this.error(peer, 'INVALID_MESSAGE', '消息格式无效。'); return; }
      if (!plainObject(message) || typeof message.type !== 'string') { this.error(peer, 'INVALID_MESSAGE', '消息格式无效。'); return; }
      if (message.type !== 'input' && !consume(peer.controls, now)) { this.error(peer, 'RATE_LIMIT', '操作太频繁，请稍后再试。'); return; }
      this.handle(peer, message, now);
    });
    this.send(peer, { type: 'welcome', playerId: peer.id, rooms: this.roomList(), shareUrls: this.getShareUrls() });
  }

  handle(peer, message, now) {
    const room = this.rooms.get(peer.roomId);
    switch (message.type) {
      case 'list': this.send(peer, { type: 'rooms', rooms: this.roomList() }); this.send(peer,{type:'share',shareUrls:this.getShareUrls()}); return;
      case 'ping': {
        if (typeof message.sentAt === 'number' && Number.isFinite(message.sentAt)) this.send(peer, { type: 'pong', sentAt: message.sentAt });
        return;
      }
      case 'hello': {
        if (activeRace(room)) return this.error(peer, 'RACE_ACTIVE', '比赛期间不能修改姓名。');
        peer.name = cleanName(message.name, '赛车手', 20);
        if(Object.hasOwn(message,'modelId')){
          if(message.modelId!==null&&!validVehicleId(message.modelId))return this.error(peer,'INVALID_MODEL','这款车型尚不可用，请重新选车。');
          peer.modelId=validVehicleId(message.modelId);
        }
        if (room) this.broadcastRoom(room);
        return;
      }
      case 'create': {
        if (room) return this.error(peer, 'ALREADY_IN_ROOM', '请先离开当前房间。');
        if (this.rooms.size >= MAX_ROOMS) return this.error(peer, 'ROOM_LIMIT', '房间已满，请加入已有房间。');
        let id;
        do { id = randomBytes(3).toString('hex').toUpperCase(); } while (this.rooms.has(id));
        const created = { id, name: cleanName(message.name, `${peer.name}的房间`, 28), hostId: peer.id,
          status: 'waiting', players: new Map(), raceId: null, game: null, snapshotTicks: 0 };
        this.rooms.set(id, created);
        this.join(peer, created);
        return;
      }
      case 'join': {
        if (room) return this.error(peer, 'ALREADY_IN_ROOM', '请先离开当前房间。');
        const target = typeof message.roomId === 'string' ? this.rooms.get(message.roomId.toUpperCase()) : null;
        if (!target) return this.error(peer, 'ROOM_NOT_FOUND', '房间已关闭，请选择其他房间。');
        if (target.status !== 'waiting') return this.error(peer, 'RACE_ACTIVE', '这个房间已经开赛，请等待下一场。');
        if (target.players.size >= MAX_PLAYERS) return this.error(peer, 'ROOM_FULL', '房间已有 6 位玩家。');
        this.join(peer, target);
        return;
      }
      case 'leave': this.leave(peer); return;
      case 'start': {
        if (!room) return this.error(peer, 'NOT_IN_ROOM', '请先加入房间。');
        if (room.hostId !== peer.id) return this.error(peer, 'HOST_ONLY', '只有房主可以开始比赛。');
        if (room.status !== 'waiting') return this.error(peer, 'RACE_ACTIVE', '比赛已经开始。');
        const game = new RaceGame({ track: this.track, aiCount: 5, seed: randomBytes(4).readUInt32LE(), multiplayer: true, playerId: peer.vehicleId });
        game.start('race');
        room.game = game; room.raceId = randomUUID(); room.status = 'countdown'; room.snapshotTicks = 0; room.snapshotSequence = 0;
        for (const player of room.players.values()) {
          player.input = NEUTRAL; player.inputAt = 0; player.lastSeq = -1;
          const vehicle = game.state.vehicles[player.vehicleId];
          vehicle.name = player.name; vehicle.human = true; vehicle.playerId = player.id;
          if(player.modelId){vehicle.modelId=player.modelId;vehicle.color='#'+vehicleById(player.modelId).color.toString(16).padStart(6,'0');}
        }
        game.setHumanPlayers([...room.players.values()].map(player => player.vehicleId));
        for (const vehicle of game.state.vehicles) if (!vehicle.human) { vehicle.human = false; vehicle.name = `${vehicle.name === '你' ? '赤焰' : vehicle.name} · AI`; }
        this.broadcastRoom(room); this.snapshot(room);
        return;
      }
      case 'lobby': {
        if (!room) return this.error(peer, 'NOT_IN_ROOM', '请先加入房间。');
        if (room.hostId !== peer.id) return this.error(peer, 'HOST_ONLY', '只有房主可以返回等待室。');
        if (room.status !== 'finished') return this.error(peer, 'RACE_NOT_FINISHED', '请等待所有玩家完成比赛。');
        room.status = 'waiting'; room.game = null; room.raceId = null;
        for (const player of room.players.values()) { player.input = NEUTRAL; player.inputAt = 0; }
        this.broadcastRoom(room);
        return;
      }
      case 'input': {
        if (!activeRace(room)) return;
        if (!Number.isSafeInteger(message.seq) || message.seq < 0 || message.seq <= peer.lastSeq) return;
        const input = message.input;
        if (!plainObject(input)) return this.error(peer, 'INVALID_INPUT', '操作数据无效。');
        const allowed = new Set(['throttle', 'brake', 'steer', 'drift', 'useItem', 'reset']);
        if (Object.keys(input).some(key => !allowed.has(key))) return this.error(peer, 'INVALID_INPUT', '仅支持驾驶操作数据。');
        for (const key of ['throttle', 'brake', 'steer']) {
          if (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || input[key] < (key === 'steer' ? -1 : 0) || input[key] > 1)
            return this.error(peer, 'INVALID_INPUT', '方向和油门数据超出范围。');
        }
        for (const key of ['drift', 'useItem', 'reset']) if (input[key] !== undefined && typeof input[key] !== 'boolean') return this.error(peer, 'INVALID_INPUT', '操作开关格式无效。');
        peer.lastSeq = message.seq; peer.inputAt = now;
        peer.input = { throttle: input.throttle, brake: input.brake, steer: input.steer,
          drift: !!input.drift, useItem: !!input.useItem, reset: !!input.reset };
        return;
      }
      default: this.error(peer, 'UNKNOWN_MESSAGE', '不支持这个操作。');
    }
  }

  join(peer, room) {
    const used = new Set([...room.players.values()].map(player => player.vehicleId));
    peer.vehicleId = COLORS.findIndex((_, id) => !used.has(id));
    peer.roomId = room.id; room.players.set(peer.id, peer);
    this.broadcastRoom(room);
  }

  leave(peer) {
    const room = this.rooms.get(peer.roomId);
    if (room) {
      room.players.delete(peer.id);
      if (room.game) {
        const vehicle = room.game.state.vehicles[peer.vehicleId];
        vehicle.human = false; vehicle.name = `${peer.name} · AI`;
        room.game.setHumanPlayers([...room.players.values()].map(player => player.vehicleId));
      }
      if (!room.players.size) this.rooms.delete(room.id);
      else {
        if (room.hostId === peer.id) room.hostId = room.players.keys().next().value;
        if (room.game) room.game.playerId = room.players.get(room.hostId).vehicleId;
      }
    }
    peer.roomId = null; peer.vehicleId = null; peer.input = NEUTRAL; peer.inputAt = 0;
    this.send(peer, { type: 'room', room: null });
    if (room && room.players.size) this.broadcastRoom(room); else if (room) this.broadcastRooms();
  }

  step(dt = 1 / 60) {
    const now = this.now();
    for (const room of this.rooms.values()) {
      if (!activeRace(room)) continue;
      const inputs = new Map([...room.players.values()].map(peer => [peer.vehicleId, now - peer.inputAt <= INPUT_TIMEOUT ? peer.input : NEUTRAL]));
      room.game.updateMultiplayer(dt, inputs);
      if (room.game.state.phase !== room.status) {
        room.status = room.game.state.phase;
        this.broadcastRoom(room);
      }
      if (++room.snapshotTicks % 3 === 0 || room.status === 'finished') this.snapshot(room);
    }
  }

  snapshot(room) {
    const game = room.game;
    if (!game) return;
    const state = { ...game.state, vehicles: game.state.vehicles.map(vehicle => Object.fromEntries(
      Object.entries(vehicle).filter(([key]) => !key.startsWith('_') || ['_vx', '_vz', '_lane', '_pathT', '_wallContact'].includes(key))
    )) };
    const message = encodeSnapshot(room,state,game.drainEvents(),this.now());
    for (const peer of room.players.values()) this.send(peer, message);
  }

  close() {
    clearInterval(this.timer); clearInterval(this.heartbeat);
    this.server.off('upgrade', this.upgrade);
    for (const peer of this.peers.values()) peer.ws.terminate();
    this.wss.close();
    this.rooms.clear();
  }
}
