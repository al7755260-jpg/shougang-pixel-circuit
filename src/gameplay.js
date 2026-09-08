import {RobotEncounter} from './robot-encounter.js';
import {KongEncounter,KONG} from './kong-encounter.js';
import {GrannyEncounter,GRANNY} from './granny-encounter.js';
import {kongHandPose} from './kong-motion.js';
import {RACE_LAPS} from './race-config.js';
import {CRASH, isRearImpact, crashPose} from './kart-crash.js';
import {availableVehicles, validVehicleId, vehicleById} from './vehicles/catalog.js';

/**
 * Rendering-independent arcade kart simulation.
 * Track t is a closed, arc-length-normalized parameter; lane is in world units,
 * positive on the right of the track tangent. Heading 0 faces world +z.
 */
const TAU = Math.PI * 2;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const wrap = n => ((n % 1) + 1) % 1;
// Heading is allowed to accumulate over many laps; JS remainder alone is not
// a positive modulo and would choose the wrong turn after several rotations.
const angleDelta = (to, from) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const expLerp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// Covers the solid kart, including steered wheels and chassis lean, at every
// heading. Exhaust particles are visual effects and do not define collision.
export const KART_ROAD_RADIUS = 1.55;
const ROAD_CLEARANCE = 0.02;

export const ITEM_LABELS = Object.freeze({
  boost: '涡轮冲刺', shield: '像素护盾', pulse: '电磁脉冲', banana: '香蕉路障',
});

const KARTS = [
  { name: '你', color: '#ff665c' },
  { name: '薄荷', color: '#55dfb5' },
  { name: '阿橙', color: '#ffc257' },
  { name: '蓝调', color: '#74b9ff' },
  { name: '葡萄', color: '#be93fd' },
  { name: '桃子', color: '#ff9bd2' },
  { name: '柠檬', color: '#d8ef75' },
  { name: '雪球', color: '#dbeef2' },
];

export class RaceGame {
  constructor({ track, aiCount = 5, seed = 1337, laps = RACE_LAPS, playerId = 0, multiplayer = false } = {}) {
    if (!track || !(track.length > 0) || !['getPoint', 'getTangent', 'closest'].every(k => typeof track[k] === 'function')) {
      throw new TypeError('RaceGame needs a closed track with length, getPoint(t), getTangent(t), and closest(x,z).');
    }
    this.track = track;
    this.width = track.width || 10;
    this.aiCount = clamp(Math.floor(aiCount), 0, 7);
    this.laps = Math.max(1, Math.floor(laps));
    this.playerId = playerId;
    this.multiplayer = multiplayer;
    this.humanVehicleIds = new Set([playerId]);
    this._networkInputs = null;
    this._networkHeld = new Map();
    this.seed = seed >>> 0;
    this._rng = this.seed;
    this._events = [];
    this._useHeld = false;
    this._resetHeld = false;
    this._pausedPhase = 'racing';
    this._checkpointCount = 12;
    this._reset('race');
    this.state.phase = 'menu';
  }

  get player() { return this.state.vehicles.find(v => v.id === this.playerId) || this.state.vehicles[0]; }

  /** Only the authoritative server chooses which vehicles accept human inputs. */
  setHumanPlayers(ids) {
    const previous = this.humanVehicleIds;
    this.humanVehicleIds = new Set(ids);
    for (const v of this.state.vehicles) {
      if (previous.has(v.id) && !this.humanVehicleIds.has(v.id)) {
        v._pathT = v.progress;
        v._lane = this.track.closest(v.x, v.z).signedDistance;
        this._networkHeld.delete(v.id);
      }
    }
  }

  updateMultiplayer(dt, inputs = new Map()) {
    this.multiplayer = true;
    this._networkInputs = inputs;
    if (this.state.phase === 'racing') {
      for (const id of this.humanVehicleIds) {
        const v = this.state.vehicles.find(vehicle => vehicle.id === id);
        if (!v || v.finished) continue;
        const input = inputs.get(id) || {}, held = this._networkHeld.get(id) || {};
        if (input.reset && !held.reset) this._resetKart(v);
        if (input.useItem && !held.useItem) this._useItem(v);
        this._networkHeld.set(id, { reset: !!input.reset, useItem: !!input.useItem });
      }
    }
    return this.update(dt);
  }

  start(mode = 'race') {
    this._reset(mode === 'practice' ? 'practice' : 'race');
    this.state.phase = 'countdown';
    this._emit('countdown', { value: 3 });
    return this.state;
  }

  restart() { return this.start(this.state.mode); }

  pause() {
    if (this.state.phase === 'racing' || this.state.phase === 'countdown') {
      this._pausedPhase = this.state.phase;
      this.state.phase = 'paused';
      this._emit('pause');
    }
  }

  resume() {
    if (this.state.phase === 'paused') {
      this.state.phase = this._pausedPhase;
      this._emit('resume');
    }
  }

  togglePause() { this.state.phase === 'paused' ? this.resume() : this.pause(); }

  drainEvents() {
    const events = this._events;
    this._events = [];
    return events;
  }

  /** dt is seconds. Long frames are capped at 250 ms and integrated at <= 1/60 s. */
  update(dt, input = {}) {
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.25);
    if (this.state.phase === 'paused' || this.state.phase === 'menu' || this.state.phase === 'finished') return this.state;

    if (this.state.phase === 'racing' && !this.multiplayer) {
      if (input.reset && !this._resetHeld) this._resetKart(this.player);
      if (input.useItem && !this._useHeld) this._useItem(this.player);
    }
    this._useHeld = !!input.useItem;
    this._resetHeld = !!input.reset;

    while (dt > 0.000001) {
      const step = Math.min(dt, 1 / 60);
      this._step(step, input);
      dt -= step;
      if (this.state.phase === 'finished') break;
    }
    return this.state;
  }

  _reset(mode) {
    this._rng = this.seed;
    this._events = [];
    this._useHeld = false;
    this._resetHeld = false;
    this._networkHeld.clear();
    this._networkInputs = null;
    this._finishOrder = [];
    this._firstHumanFinishedAt = null;
    this._hazardId = 0;
    this._crashId = 0;
    const count = mode === 'practice' ? 1 : this.aiCount + 1;
    const models = availableVehicles();
    const vehicles = Array.from({ length: count }, (_, id) => {
      const row = Math.floor(id / 2);
      const t = wrap(-(row * 4.4 + 5) / this.track.length);
      const lane = ((id % 2) ? 1 : -1) * Math.min(1.7, this.width * 0.17);
      const pos = this._trackPosition(t, lane);
      const tangent = this.track.getTangent(t);
      return {
        id, ...KARTS[id], x: pos.x, z: pos.z,
        modelId: validVehicleId(id===this.playerId?this.selectedModelId:null) || models[(id+this.seed)%Math.max(1,models.length)]?.id || null,
        heading: Math.atan2(tangent.x, tangent.z), speed: 0,
        progress: t, totalProgress: t - 1, lap: 1, completedLaps: 0,
        finished: false, finishTime: null, rank: id + 1,
        dnf: false,
        crash: null, grannyBlock:null, respawnProtection: 0, _ramCooldown: 0,
        boost: 0, drift: false, driftCharge: 0, driftDirection: 0,
        catchupActive: false, catchupBoost: 0,
        item: null, coins: 0, stun: 0, shield: 0, steering: 0, robotSlow: 0,
        offRoad: false, wrongWay: false, checkpoint: 0,
        lapTimes: [], bestLap: null,
        _vx: 0, _vz: 0, _lastT: t, _pathT: t, _lane: lane,
        _nextCheckpoint: 0, _startedLap: false, _lapStartedAt: 0,
        _wrongWayTime: 0, _collisionCooldown: 0, _resetCooldown: 0, _wallContact: 0,
        _aiItemTimer: 2 + this._random() * 4,
        _aiPace: 0.91 + this._random() * 0.1,
        _aiPhase: this._random() * TAU,
      };
    });
    for(const vehicle of vehicles){const spec=vehicleById(vehicle.modelId);if(spec?.available)vehicle.color='#'+spec.color.toString(16).padStart(6,'0');}
    this.state = {
      phase: 'menu', mode, multiplayer: this.multiplayer, elapsed: 0, countdown: 3,
      vehicles, lapTimes: vehicles[0].lapTimes, bestLap: null,
      result: null, totalLaps: this.laps, wrongWay: false,
      distanceToRoad: 0, speedKmh: 0,
      ...(this.multiplayer ? { finishCountdown: null, raceTimeRemaining: 600, finishReason: null } : {}),
    };
    this.robotEncounter=new RobotEncounter({track:this.track,seed:this.seed,kartRadius:KART_ROAD_RADIUS,
      onEvent:(type,detail)=>this._emit(type,detail),onHit:(vehicle,attack)=>this._robotHit(vehicle,attack)});
    this.state.robot=this.robotEncounter.state;
    this.kongEncounter=new KongEncounter({track:this.track,onGrab:(vehicle,kong)=>this._kongGrab(vehicle,kong),onThrow:(vehicle,kong)=>{
      if(vehicle?.crash?.sourceKind==='kong')this._emit('kart-crash',{vehicleId:vehicle.id,sourceId:'kong',sourceKind:'kong',crashId:vehicle.crash.id,x:vehicle.x,z:vehicle.z});
      this._emit('kong-throw',{vehicleId:vehicle?.id,attackId:kong.attackId,x:kong.x,z:kong.z});
    },onEvent:(type,detail)=>this._emit(type,detail)});
    this.state.kong=this.kongEncounter.state;
    this.grannyEncounter=new GrannyEncounter({track:this.track,onHit:(vehicle,granny,contact)=>this._stopForGranny(vehicle,granny,contact),onEvent:(type,detail)=>this._emit(type,detail)});
    this.state.granny=this.grannyEncounter.state;
    this.hazards = [];
    this.pickups = [];
    let id = 0;
    const add = (type, t, lane) => this.pickups.push({
      id: id++, type, t: wrap(t), lane, ...this._trackPosition(wrap(t), lane), active: true, respawn: 0,
    });
    // Keep a short circuit readable while maintaining item density on long
    // routes: about 10/24/2 pickups at 400-500 m and 24/60/5 at 1205 m.
    const itemRows = Math.max(5, Math.round(this.track.length / 100));
    const coinGroups = Math.max(8, Math.round(this.track.length / 60));
    const boostPads = Math.max(2, Math.round(this.track.length / 240));
    for (let row = 0; row < itemRows; row++) {
      const t = 0.07 + row * 0.86 / (itemRows - 1);
      for (const lane of [-this.width * 0.22, this.width * 0.22]) add('item', t, lane);
    }
    for (let group = 0; group < coinGroups; group++) {
      const lane = (group % 2 ? -1 : 1) * this.width * 0.16;
      const t = 0.045 + group * 0.91 / (coinGroups - 1);
      for (let coin = 0; coin < 3; coin++) add('coin', t + coin * 3 / this.track.length, lane);
    }
    for (let pad = 0; pad < boostPads; pad++) {
      const targetT = (pad + 0.5) / boostPads;
      const searchHalfWidth = Math.min(0.12, 0.24 / boostPads);
      let bestT = targetT, bestScore = Infinity;
      // Inspect a whole 52 m burst, not just the pad's immediate surroundings.
      // Search within each evenly spaced sector for the gentlest corridor.
      for (let offset = -12; offset <= 12; offset++) {
        const t = targetT + offset * searchHalfWidth / 12;
        if (t < 0.045 || t > 0.955) continue;
        let tangent = this.track.getTangent(wrap(t));
        let previousHeading = Math.atan2(tangent.x, tangent.z);
        let totalTurn = 0, sharpestCurvature = 0;
        for (let meters = 4; meters <= 52; meters += 4) {
          tangent = this.track.getTangent(wrap(t + meters / this.track.length));
          const heading = Math.atan2(tangent.x, tangent.z);
          const turn = Math.abs(angleDelta(heading, previousHeading));
          totalTurn += turn;
          sharpestCurvature = Math.max(sharpestCurvature, turn / 4);
          previousHeading = heading;
        }
        const score = totalTurn + sharpestCurvature * 20 + Math.abs(t - targetT) * 0.08;
        if (score < bestScore) { bestScore = score; bestT = t; }
      }
      add('boost', bestT, 0);
    }
  }

  _step(dt, input) {
    if (this.state.phase === 'countdown') {
      const before = Math.ceil(this.state.countdown);
      this.state.countdown = Math.max(0, this.state.countdown - dt);
      const after = Math.ceil(this.state.countdown);
      if (after < before && after > 0) this._emit('countdown', { value: after });
      if (this.state.countdown <= 0.00001) {
        this.state.countdown = 0;
        this.state.phase = 'racing';
        this._emit('race-start');
      }
      return;
    }
    if (this.state.phase !== 'racing') return;

    this.state.elapsed += dt;
    for (const pickup of this.pickups) {
      if (!pickup.active) {
        pickup.respawn -= dt;
        if (pickup.respawn <= 0) { pickup.active = true; pickup.respawn = 0; }
      }
    }
    for (const hazard of this.hazards) hazard.ttl -= dt;
    this.hazards = this.hazards.filter(h => h.ttl > 0);

    this._updateCatchup(dt);

    for (const v of this.state.vehicles) {
      v._stepX=v.x;v._stepZ=v.z;
      v._justRespawned = false;
      for (const key of ['boost', 'stun', 'shield', 'robotSlow', 'respawnProtection', '_ramCooldown', '_collisionCooldown', '_resetCooldown', '_wallContact']) v[key] = Math.max(0, v[key] - dt);
      if (v.crash) { this._updateCrash(v); continue; }
      if(v.grannyBlock){
        const b=v.grannyBlock;
        if(this.state.elapsed+1e-9<b.until){v.x=b.x;v.z=b.z;v.heading=b.heading;v.speed=v._vx=v._vz=0;continue;}
        v.grannyBlock=null;v.speed=b.speed;v._vx=b.vx;v._vz=b.vz;
      }
      if (this.multiplayer) {
        if (this.humanVehicleIds.has(v.id) && !v.finished) this._drivePlayer(v, dt, this._networkInputs?.get(v.id) || {});
        else this._driveAI(v, dt);
      } else if (v.id === this.playerId) this._drivePlayer(v, dt, input);
      else this._driveAI(v, dt);
      this._roadBoundary(v, dt);
    }
    this.grannyEncounter.update(dt,this.state.vehicles,this.state.phase,this.state.elapsed);
    this._kartCollisions();
    // Robot impulses are resolved before the final hard-road projection.
    this.robotEncounter.update(dt,this.state.vehicles,this.state.phase);
    this.kongEncounter.update(dt,this.state.vehicles,this.state.phase,this.state.elapsed);
    for (const v of this.state.vehicles) {
      if (v.crash || v.grannyBlock || v._justRespawned) continue;
      // Contact separation can push a kart sideways after its driving step.
      // Re-apply the hard road constraint before pickups and checkpoint logic.
      this._roadBoundary(v, dt);
      this._collectPickups(v);
      this._hitHazards(v);
      this._updateProgress(v, dt);
    }
    this._rankVehicles();
    if (this.multiplayer && this.humanVehicleIds.size) {
      const humans = this.state.vehicles.filter(v => this.humanVehicleIds.has(v.id));
      if (this._firstHumanFinishedAt === null && humans.some(v => v.finished)) {
        this._firstHumanFinishedAt = Math.min(...humans.filter(v => v.finished).map(v => v.finishTime));
      }
      this.state.raceTimeRemaining = Math.max(0, 600 - this.state.elapsed);
      this.state.finishCountdown = this._firstHumanFinishedAt === null ? null : Math.max(0, 90 - (this.state.elapsed - this._firstHumanFinishedAt));
      if (humans.every(v => v.finished)) {
        this.state.finishReason = 'all-finished';
        this._finishRace(this.player);
      } else if (this.state.raceTimeRemaining <= .00001 || (this.state.finishCountdown !== null && this.state.finishCountdown <= .00001)) {
        // AFK drivers do not keep the room locked forever. DNF preserves their
        // actual progress and null finishTime; it never fabricates a finish.
        for (const v of this.state.vehicles) if (!v.finished) v.dnf = true;
        this.state.finishReason = 'timeout';
        this._finishRace(this.player);
      }
    }
    this.state.speedKmh = Math.round(Math.abs(this.player.speed) * 3.6);
    this.state.wrongWay = this.player.wrongWay;
    this.state.bestLap = this.player.bestLap;
    this._updateCatchup(0);
  }

  _updateCatchup(dt) {
    const eligible = this.state.phase === 'racing' && this.state.mode === 'race' && this.state.vehicles.length > 1;
    const last = eligible ? this.state.vehicles.filter(v => !v.finished && !v.dnf)
      .reduce((tail, v) => !tail || v.rank > tail.rank ? v : tail, null) : null;
    for (const v of this.state.vehicles) {
      v.catchupActive = v === last && !v.crash && !v.grannyBlock;
      // Separate from collected items: no item-slot overwrite, no cooldown and
      // no stacking. Ramp out over 1.5 s so overtaking does not slam the brakes.
      v.catchupBoost = !eligible || v.finished || v.dnf || v.crash || v.grannyBlock ? 0
        : clamp((v.catchupBoost || 0) + dt * (v.catchupActive ? 4 : -2 / 3), 0, 1);
    }
  }

  _drivePlayer(v, dt, input) {
    const throttle = clamp(Number(input.throttle) || 0, 0, 1);
    const brake = clamp(Number(input.brake) || 0, 0, 1);
    const steer = clamp(Number(input.steer) || 0, -1, 1);
    const wasDrifting = v.drift;
    // Keyboard steering builds over roughly 0.2 seconds. Release returns more
    // quickly, and a deliberate left/right reversal crosses neutral promptly.
    const reversingSteer = steer * v.steering < -0.01;
    const steeringRate = Math.abs(steer) < 0.01 ? 20 : reversingSteer ? 22 : 11;
    v.steering = expLerp(v.steering, steer, steeringRate, dt);
    v.drift = !!input.drift && v.speed > 8 && Math.abs(steer) > 0.12 && v.stun <= 0;
    if (v.drift) {
      if (!wasDrifting) v.driftDirection = Math.sign(steer);
      v.driftCharge = Math.min(3, v.driftCharge + dt * (0.45 + Math.abs(steer) * 0.85));
    } else if (wasDrifting) {
      if (v.driftCharge >= 0.65 && v.stun <= 0) {
        const level = v.driftCharge >= 2.1 ? 3 : v.driftCharge >= 1.3 ? 2 : 1;
        v.boost = Math.max(v.boost, 0.45 + level * 0.42);
        this._emit('drift-boost', { vehicleId: v.id, level });
      }
      v.driftCharge = 0;
      v.driftDirection = 0;
    }

    const boostPower = v.stun > 0 ? 0 : Math.max(v.boost > 0 ? 1 : 0, v.catchupBoost || 0);
    const baseSpeed = 31.5 + Math.min(v.coins, 10) * 0.18;
    const maxSpeed = baseSpeed + (47 - baseSpeed) * boostPower;
    let acceleration = 0;
    // Boost never cancels a deliberate brake press, even with W still held.
    if (throttle) acceleration += (25.5 + 36.5 * (brake ? 0 : boostPower)) * throttle;
    if (brake) acceleration -= (v.speed > 0.5 ? 59 : 22) * brake;
    if (!throttle && !brake) acceleration -= Math.sign(v.speed) * 7;
    if (throttle && v.speed < 0) acceleration += 26;
    if (v.stun > 0) acceleration = -Math.sign(v.speed) * 34;
    if (v.robotSlow > 0 && acceleration * (v.speed < 0 ? -1 : 1) > 0) acceleration *= .35;
    const oldSpeed = v.speed;
    v.speed = clamp(v.speed + acceleration * dt, -9, maxSpeed);
    if (!throttle && !brake && Math.sign(v.speed) !== Math.sign(oldSpeed)) v.speed = 0;
    if (v.stun > 0 && Math.sign(v.speed) !== Math.sign(oldSpeed)) v.speed = 0;

    // A head-on wall contact must still let the player steer away while using
    // the pedals, even after its outward velocity has been removed.
    const speedAmount = Math.max(clamp(Math.abs(v.speed) / 7, 0, 1), v._wallContact > 0 && (throttle || brake) ? 0.55 : 0);
    const fastSteering = clamp((Math.abs(v.speed) - 10) / 22, 0, 1);
    const speedSteeringGain = 1 - 0.42 * fastSteering * fastSteering * (3 - 2 * fastSteering);
    const turnRate = (0.85 + Math.min(Math.abs(v.speed), 34) * 0.035) * speedSteeringGain * (v.drift ? 1.5 : 1);
    if (v.stun <= 0) v.heading += v.steering * turnRate * speedAmount * dt * (v.speed < 0 ? -1 : 1);
    else v.heading += Math.sin(this.state.elapsed * 18) * dt * 0.55;
    const desiredVX = Math.sin(v.heading) * v.speed;
    const desiredVZ = Math.cos(v.heading) * v.speed;
    const grip = v.drift ? 3.0 : 11;
    v._vx = expLerp(v._vx, desiredVX, grip, dt);
    v._vz = expLerp(v._vz, desiredVZ, grip, dt);
    v.x += v._vx * dt;
    v.z += v._vz * dt;
  }

  _driveAI(v, dt) {
    const t = v._pathT;
    const ahead = this.track.getTangent(wrap(t + 12 / this.track.length));
    const current = this.track.getTangent(t);
    const curve = Math.abs(angleDelta(Math.atan2(ahead.x, ahead.z), Math.atan2(current.x, current.z)));
    let desiredSpeed = (25.5 - clamp(curve, 0, 1.5) * 9) * v._aiPace;
    // Mild catch-up keeps a race close without changing the player's handling.
    const gap = this.player.totalProgress - v.totalProgress;
    desiredSpeed *= 1 + clamp(gap, -0.08, 0.10);
    if (v.boost > 0) desiredSpeed = 38;
    desiredSpeed += Math.max(0, 42 - desiredSpeed) * (v.catchupBoost || 0);
    if (v.stun > 0) desiredSpeed = 2;
    if (v.robotSlow > 0) desiredSpeed *= .82;
    if (v.finished) desiredSpeed = 16;
    v.speed = expLerp(v.speed, desiredSpeed, v.stun > 0 ? 6 : 1.8, dt);
    v._pathT = wrap(v._pathT + v.speed * dt / this.track.length);

    let targetLane = Math.sin(this.state.elapsed * 0.23 + v._aiPhase) * this.width * 0.2;
    for (const other of this.state.vehicles) {
      if (other.id === v.id || other.crash) continue;
      const forwardGap = (other.progress - v.progress + 1) % 1 * this.track.length;
      if (forwardGap > 0 && forwardGap < 11 && other.speed < v.speed + 2) {
        const side = v.id % 2 ? 1 : -1;
        targetLane = side * this.width * 0.3;
      }
    }
    v._lane = expLerp(v._lane, targetLane, 1.3, dt);
    const pos = this._trackPosition(v._pathT, v._lane);
    const dx = pos.x - v.x;
    const dz = pos.z - v.z;
    v.x = expLerp(v.x, pos.x, 13, dt);
    v.z = expLerp(v.z, pos.z, 13, dt);
    const tangent = this.track.getTangent(v._pathT);
    const wantedHeading = Math.hypot(dx, dz) > 0.03 ? Math.atan2(dx, dz) : Math.atan2(tangent.x, tangent.z);
    const turn = angleDelta(wantedHeading, v.heading);
    v.heading += turn * (1 - Math.exp(-dt * 8));
    v.steering = clamp(turn * 2, -1, 1);
    v._vx = Math.sin(v.heading) * v.speed;
    v._vz = Math.cos(v.heading) * v.speed;
    v._aiItemTimer -= dt;
    if (v.item && v._aiItemTimer <= 0 && !v.finished) {
      this._useItem(v);
      v._aiItemTimer = 2 + this._random() * 5;
    }
  }

  _roadBoundary(v, dt) {
    if (v.crash || v.grannyBlock) return;
    const near = this.track.closest(v.x, v.z);
    const limit = Math.max(0, this.width * 0.5 - KART_ROAD_RADIUS - ROAD_CLEARANCE);
    v.offRoad = false;
    if (v.id === this.playerId) this.state.distanceToRoad = Math.min(near.distance, limit);
    if (near.distance <= limit) return;
    const nx = (v.x - near.point.x) / near.distance;
    const nz = (v.z - near.point.z) / near.distance;
    // The complete body fits inside the road, even sideways through a drift.
    // Recompute each substep so boost and long frames cannot tunnel through.
    v.x = near.point.x + nx * limit;
    v.z = near.point.z + nz * limit;
    v._wallContact = 0.12;
    const outwardVelocity = v._vx * nx + v._vz * nz;
    if (outwardVelocity > 0) {
      // Cancel only the velocity into the wall; retain tangential motion so
      // glancing contact slides naturally instead of bouncing out or resetting.
      v._vx -= nx * outwardVelocity;
      v._vz -= nz * outwardVelocity;
      v.speed = Math.sign(v.speed) * Math.min(Math.abs(v.speed), Math.hypot(v._vx, v._vz));
    }
    if (v._collisionCooldown <= 0 && outwardVelocity > 3) {
      this._emit('collision', { vehicleId: v.id, kind: 'barrier', x: v.x, z: v.z });
      v._collisionCooldown = 0.5;
    }
  }

  _kartCollisions() {
    const vehicles = this.state.vehicles;
    for (let a = 0; a < vehicles.length; a++) for (let b = a + 1; b < vehicles.length; b++) {
      const va = vehicles[a], vb = vehicles[b];
      if (va.crash || vb.crash || va.grannyBlock || vb.grannyBlock || va.respawnProtection > 0 || vb.respawnProtection > 0 || va.finished || vb.finished || va.dnf || vb.dnf) continue;
      const dx = vb.x - va.x, dz = vb.z - va.z;
      const d = Math.hypot(dx, dz);
      if (d >= 2.0 || d < 0.00001) continue;
      if (isRearImpact(va, vb) && this._ramKart(va, vb)) continue;
      if (isRearImpact(vb, va) && this._ramKart(vb, va)) continue;
      const nx = dx / d, nz = dz / d, overlap = (2.0 - d) * 0.5;
      va.x -= nx * overlap; va.z -= nz * overlap;
      vb.x += nx * overlap; vb.z += nz * overlap;
      const impact = (va._vx - vb._vx) * nx + (va._vz - vb._vz) * nz;
      if (impact > 0) {
        const kick = Math.min(impact * 0.45, 8);
        va._vx -= nx * kick; va._vz -= nz * kick;
        vb._vx += nx * kick; vb._vz += nz * kick;
        if (!va.shield) va.speed *= 0.94;
        if (!vb.shield) vb.speed *= 0.94;
        if (impact > 3 && va._collisionCooldown <= 0 && vb._collisionCooldown <= 0) {
          this._emit('collision', { vehicleId: va.id, otherId: vb.id, kind: 'kart', x: va.x, z: va.z });
          va._collisionCooldown = vb._collisionCooldown = 0.6;
        }
      }
    }
  }

  _collectPickups(v) {
    if (v.finished || v.crash || v.grannyBlock) return;
    for (const p of this.pickups) {
      if (!p.active || (p.type === 'item' && v.item)) continue;
      const radius = p.type === 'boost' ? 2.2 : 1.75;
      if (Math.abs(v.x - p.x) > radius || Math.abs(v.z - p.z) > radius || distance(v, p) > radius) continue;
      p.active = false;
      p.respawn = p.type === 'item' ? 8 : p.type === 'coin' ? 5 : 1.5;
      if (p.type === 'coin') v.coins = Math.min(99, v.coins + 1);
      if (p.type === 'boost') v.boost = Math.max(v.boost, 1.1);
      if (p.type === 'item') {
        const pool = v.rank > Math.ceil(this.state.vehicles.length / 2)
          ? ['boost', 'boost', 'pulse', 'shield'] : ['boost', 'shield', 'pulse', 'banana'];
        v.item = pool[Math.floor(this._random() * pool.length)];
      }
      this._emit('pickup', { vehicleId: v.id, pickupId: p.id, pickupType: p.type, item: v.item, x: p.x, z: p.z });
    }
  }

  _useItem(v) {
    if (!v.item || v.finished || v.crash || v.grannyBlock || v.stun > 0) return;
    const item = v.item;
    v.item = null;
    if (item === 'boost') v.boost = Math.max(v.boost, 2.4);
    if (item === 'shield') v.shield = 7;
    if (item === 'pulse') {
      for (const other of this.state.vehicles) {
        if (other.id !== v.id && !other.finished && distance(v, other) < 17) this._damage(other, 1.35, v.id);
      }
    }
    if (item === 'banana') {
      const x = v.x - Math.sin(v.heading) * 3.4;
      const z = v.z - Math.cos(v.heading) * 3.4;
      this.hazards.push({ id: this._hazardId++, type: 'banana', ownerId: v.id, x, z, ttl: 28, bornAt: this.state.elapsed });
    }
    this._emit('item-used', { vehicleId: v.id, item, x: v.x, z: v.z });
  }

  _hitHazards(v) {
    if (v.finished || v.crash || v.grannyBlock || v.respawnProtection > 0) return;
    for (const h of this.hazards) {
      if (h.ttl <= 0 || (h.ownerId === v.id && this.state.elapsed - h.bornAt < 1.3)) continue;
      if (distance(v, h) < 1.45) {
        h.ttl = 0;
        this._damage(v, 1.5, h.ownerId);
        this._emit('hazard-hit', { vehicleId: v.id, hazardId: h.id, x: v.x, z: v.z });
      }
    }
  }

  _damage(v, seconds, sourceId) {
    if (v.crash || v.grannyBlock || v.respawnProtection > 0 || v.finished || v.dnf) return;
    if (v.shield > 0) {
      v.shield = 0;
      this._emit('shield-block', { vehicleId: v.id, sourceId });
      return;
    }
    v.stun = Math.max(v.stun, seconds);
    v.speed *= 0.36;
    v._vx *= 0.36; v._vz *= 0.36;
    v.boost = 0;
    v.coins = Math.max(0, v.coins - 2);
    this._emit('hit', { vehicleId: v.id, sourceId });
  }

  _robotHit(v, attack) {
    if (v.crash || v.grannyBlock || v.respawnProtection > 0 || v.finished || v.dnf) return;
    if(v.shield>0){
      v.shield=0;
      this._emit('shield-block',{vehicleId:v.id,sourceId:'robot',sourceKind:'robot',attackId:attack.attackId,kind:attack.kind});
      return;
    }
    const slam=attack.kind==='slam',missile=attack.kind==='missile',factor=missile?.72:slam?.76:.84;
    v.speed*=factor;v._vx*=factor;v._vz*=factor;
    v.robotSlow=Math.max(v.robotSlow,missile?.6:slam?.65:.8);
    let nx=v.x-attack.aim.x,nz=v.z-attack.aim.z,length=Math.hypot(nx,nz);
    if(length<.001){const near=this.track.closest(v.x,v.z);nx=near.point.x-v.x;nz=near.point.z-v.z;length=Math.hypot(nx,nz);}
    if(length<.001){const d=this.track.getTangent(v.progress);nx=d.x;nz=d.z;length=Math.hypot(nx,nz)||1;}
    nx/=length;nz/=length;
    const nudge=slam?.3:.2,kick=missile?2.8:slam?3.2:2.4;
    v.x+=nx*nudge;v.z+=nz*nudge;v._vx+=nx*kick;v._vz+=nz*kick;
    this._emit('robot-hit',{vehicleId:v.id,attackId:attack.attackId,kind:attack.kind,aim:{...attack.aim},x:v.x,z:v.z,blocked:false});
  }

  _updateProgress(v, dt) {
    if (v.crash || v.grannyBlock) return;
    const near = this.track.closest(v.x, v.z);
    const t = wrap(near.t);
    let delta = t - v._lastT;
    if (delta < -0.5) delta += 1;
    if (delta > 0.5) delta -= 1;
    const tangent = this.track.getTangent(t);
    const facing = Math.sin(v.heading) * tangent.x + Math.cos(v.heading) * tangent.z;
    if (delta < -0.00003 && Math.abs(v.speed) > 4 && (facing < 0.15 || v.speed < 0)) v._wrongWayTime += dt;
    else v._wrongWayTime = Math.max(0, v._wrongWayTime - dt * 2);
    v.wrongWay = v._wrongWayTime > 0.8;
    v.progress = t;

    // Gate crossings must be sequential, forward, on the road, and plausible in
    // one simulation step. A reset, shortcut, or repeated finish-line crossing
    // cannot award a lap. Twelve gates are spread evenly around the circuit.
    const plausibleDelta = Math.max(0.012, 65 * dt / this.track.length);
    if (!v.finished && delta > 0 && delta < plausibleDelta && near.distance <= this.width * 0.61) {
      let gate = v._nextCheckpoint / this._checkpointCount;
      if (gate <= v._lastT) gate += 1;
      if (v._lastT + delta >= gate) {
        if (v._nextCheckpoint === 0) {
          if (v._startedLap) this._completeLap(v);
          else { v._startedLap = true; v._lapStartedAt = this.state.elapsed; }
        }
        v._nextCheckpoint = (v._nextCheckpoint + 1) % this._checkpointCount;
        v.checkpoint = v._nextCheckpoint;
      }
    }
    v._lastT = t;
    if (v.finished) v.totalProgress = this.laps + 1 / (10000 + v.finishTime);
    else if (!v._startedLap) v.totalProgress = t > 0.5 ? t - 1 : 0;
    else {
      // Until the finish gate has been earned, wrapping t never grants progress.
      const legalLapT = v._nextCheckpoint === 0 && t < 0.5 ? 1 : t;
      const lastGate = (v._nextCheckpoint + this._checkpointCount - 1) % this._checkpointCount;
      const maximumEarned = v._nextCheckpoint === 0 ? 1 : (lastGate + 1) / this._checkpointCount;
      v.totalProgress = v.completedLaps + Math.min(legalLapT, maximumEarned);
    }
  }

  _completeLap(v) {
    const lapTime = this.state.elapsed - v._lapStartedAt;
    v.lapTimes.push(lapTime);
    v.bestLap = v.bestLap === null ? lapTime : Math.min(v.bestLap, lapTime);
    v.completedLaps++;
    v._lapStartedAt = this.state.elapsed;
    this._emit('lap', { vehicleId: v.id, lap: v.completedLaps, lapTime });
    if (this.state.mode === 'practice') {
      v.lap = v.completedLaps + 1;
      return;
    }
    v.lap = Math.min(this.laps, v.completedLaps + 1);
    if (v.completedLaps >= this.laps) {
      v.finished = true;
      v.catchupActive = false; v.catchupBoost = 0;
      v.finishTime = this.state.elapsed;
      v.totalProgress = this.laps + 1 / (10000 + v.finishTime);
      this._finishOrder.push(v.id);
      v.rank = this._finishOrder.length;
      this._emit('finish', { vehicleId: v.id, rank: v.rank, time: v.finishTime });
      // A finished online kart coasts under AI control while the others race.
      v._pathT = v.progress;
      v._lane = this.track.closest(v.x, v.z).signedDistance;
      if (!this.multiplayer && v.id === this.playerId) this._finishRace(v);
    }
  }

  _finishRace(v) {
    if (this.state.phase === 'finished') return;
    this._rankVehicles();
    this.state.phase = 'finished';
    this._updateCatchup(0);
    this.state.result = {
      rank: v.rank, total: this.state.vehicles.length, time: v.finishTime,
      dnf: !!v.dnf,
      bestLap: v.bestLap, lapTimes: [...v.lapTimes], coins: v.coins,
      standings: [...this.state.vehicles].sort((a, b) => a.rank - b.rank).map(k => ({
        id: k.id, name: k.name, color: k.color, rank: k.rank,
        finished: k.finished, dnf: !!k.dnf, time: k.finishTime, progress: k.totalProgress,
      })),
    };
    this._emit('race-finished', { result: this.state.result });
  }

  _rankVehicles() {
    const sorted = [...this.state.vehicles].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.totalProgress - a.totalProgress;
    });
    sorted.forEach((v, i) => { v.rank = i + 1; });
  }

  _resetKart(v) {
    if (v._resetCooldown > 0 || v.finished || v.crash || v.grannyBlock) return;
    const near = this.track.closest(v.x, v.z);
    // Place a stuck kart just behind its next gate if its current location is
    // beyond it. This makes recovery useful while retaining every earned lap.
    let t = wrap(near.t);
    if (v._startedLap) {
      const previousGate = (v._nextCheckpoint + this._checkpointCount - 1) % this._checkpointCount;
      const start = previousGate / this._checkpointCount;
      const alongSegment = wrap(t - start);
      const segmentLength = 1 / this._checkpointCount;
      const gateMargin = Math.min(2 / this.track.length, segmentLength * 0.2);
      if (alongSegment >= segmentLength) {
        // Recover just before a missed forward gate, or just after the last
        // earned gate when the kart reversed out of its current legal segment.
        // Never leave the reset position beyond an unearned checkpoint.
        t = wrap(start + (alongSegment < 0.5 ? segmentLength - gateMargin : gateMargin));
      }
    } else if (t < 0.9) t = wrap(-4 / this.track.length);
    const pos = this._trackPosition(t, 0);
    const tangent = this.track.getTangent(t);
    v.x = pos.x; v.z = pos.z;
    v.heading = Math.atan2(tangent.x, tangent.z);
    v.speed = 0; v._vx = 0; v._vz = 0;
    v.stun = 0; v.boost = 0; v.drift = false; v.driftCharge = 0; v._wallContact = 0; v.robotSlow = 0;
    v.catchupActive = false; v.catchupBoost = 0;
    v._lastT = t; v.progress = t; v._pathT = t;
    v.wrongWay = false; v._wrongWayTime = 0; v._resetCooldown = 0.8;
    this._emit('reset', { vehicleId: v.id, x: v.x, z: v.z });
  }

  _ramKart(attacker, target) {
    attacker._ramCooldown = .85;
    if (target.shield > 0) {
      target.shield = 0;
      this._emit('shield-block', {vehicleId: target.id, sourceId: attacker.id, sourceKind: 'ram'});
      return false;
    }
    // Freeze the last legally earned progress. Flight can never cross a gate.
    const near = this.track.closest(target.x, target.z), tangent = this.track.getTangent(target.progress);
    const side = Math.abs(near.signedDistance) > .25 ? Math.sign(near.signedDistance) : (target.id % 2 ? 1 : -1);
    const end = this._trackPosition(wrap(target.progress + 5 / this.track.length), side * (this.width / 2 + 2.2));
    target.crash = {id: ++this._crashId, at: this.state.elapsed, duration: CRASH.seconds, sourceId: attacker.id,
      x: target.x, z: target.z, endX: end.x, endZ: end.z, heading: target.heading, side,
      progress: target.progress, lane: near.signedDistance, fx: tangent.x, fz: tangent.z};
    target.speed = 0; target._vx = 0; target._vz = 0;
    target.boost = 0; target.stun = 0; target.robotSlow = 0;
    target.drift = false; target.driftCharge = 0; target.steering = 0;
    target.catchupActive = false; target.catchupBoost = 0; target.offRoad = true; target.wrongWay = false;
    attacker.speed *= .97; attacker._vx *= .97; attacker._vz *= .97;
    this._emit('kart-crash', {vehicleId: target.id, sourceId: attacker.id, crashId: target.crash.id, x: target.x, z: target.z});
    return true;
  }

  _kongGrab(target,kong) {
    if(target.crash||target.grannyBlock||target.finished||target.dnf||target.respawnProtection>0)return false;
    if(target.shield>0){target.shield=0;this._emit('shield-block',{vehicleId:target.id,sourceId:'kong',sourceKind:'kong'});return false;}
    const near=this.track.closest(target.x,target.z),tangent=this.track.getTangent(target.progress),side=target.id%2?1:-1;
    const end=this._trackPosition(wrap(target.progress+8/this.track.length),side*(this.width/2+6));
    const holdOrigin={x:kong.x,z:kong.z,heading:kong.heading},release=kongHandPose(holdOrigin,1);
    target.crash={id:++this._crashId,at:this.state.elapsed,duration:KONG.grab+CRASH.seconds,grabDuration:KONG.grab,sourceId:'kong',sourceKind:'kong',
      x:target.x,z:target.z,holdOrigin,releaseX:release.x,releaseZ:release.z,releaseY:release.y,endX:end.x,endZ:end.z,heading:target.heading,side,
      progress:target.progress,lane:near.signedDistance,fx:tangent.x,fz:tangent.z};
    Object.assign(target,{speed:0,_vx:0,_vz:0,boost:0,stun:0,robotSlow:0,drift:false,driftCharge:0,steering:0,catchupActive:false,catchupBoost:0,offRoad:true,wrongWay:false});
    this._emit('kong-grab',{vehicleId:target.id,attackId:kong.attackId,x:target.x,z:target.z});return true;
  }

  _stopForGranny(v,granny,contact=1){
    if(v.crash||v.grannyBlock||v.finished||v.dnf)return false;
    const x=(v._stepX??v.x)+(v.x-(v._stepX??v.x))*contact,z=(v._stepZ??v.z)+(v.z-(v._stepZ??v.z))*contact;
    v.grannyBlock={at:this.state.elapsed,until:this.state.elapsed+GRANNY.blockSeconds,hitId:granny.hitId+1,x,z,heading:v.heading,speed:v.speed,vx:v._vx,vz:v._vz};
    Object.assign(v,{x,z,speed:0,_vx:0,_vz:0,boost:0,stun:0,robotSlow:0,drift:false,driftCharge:0,steering:0,catchupActive:false,catchupBoost:0,wrongWay:false});
    return true;
  }

  _updateCrash(v) {
    const crash = v.crash;
    if (this.state.elapsed + 1e-9 < crash.at + (crash.duration||CRASH.seconds)) {
      const pose = crashPose(crash, this.state.elapsed);
      v.x = pose.x; v.z = pose.z; v.offRoad = true;
      return;
    }
    const limit = Math.max(0, this.width / 2 - KART_ROAD_RADIUS - ROAD_CLEARANCE);
    // Return at the same earned arc position; choose the least occupied lane.
    const lanes = [clamp(crash.lane, -limit, limit), 0, -limit * .82, limit * .82];
    const traffic = this.state.vehicles.filter(other => other.id !== v.id && !other.crash && !other.finished && !other.dnf);
    const clearance = lane => {const p = this._trackPosition(crash.progress, lane); return Math.min(30, ...traffic.map(other => distance(p, other)));};
    lanes.sort((a, b) => clearance(b) - clearance(a));
    const lane = lanes[0], p = this._trackPosition(crash.progress, lane), tangent = this.track.getTangent(crash.progress);
    v.crash = null; v.respawnProtection = CRASH.protection; v._justRespawned = true;
    v.x = p.x; v.z = p.z; v.heading = Math.atan2(tangent.x, tangent.z);
    v.progress = crash.progress; v._lastT = crash.progress; v._pathT = crash.progress; v._lane = lane;
    v.speed = 14; v._vx = tangent.x * 14; v._vz = tangent.z * 14;
    v._wrongWayTime = 0; v.wrongWay = false; v.offRoad = false;
    v._wallContact = 0; v._collisionCooldown = .5; v._resetCooldown = .8;
    this._emit('kart-respawn', {vehicleId: v.id, crashId: crash.id, x: p.x, z: p.z});
  }

  _trackPosition(t, lane) {
    const p = this.track.getPoint(wrap(t));
    const tangent = this.track.getTangent(wrap(t));
    const length = Math.hypot(tangent.x, tangent.z) || 1;
    return { x: p.x + tangent.z / length * lane, z: p.z - tangent.x / length * lane };
  }

  _random() {
    this._rng = (Math.imul(1664525, this._rng) + 1013904223) >>> 0;
    return this._rng / 4294967296;
  }

  _emit(type, detail = {}) {
    this._events.push({ type, ...detail });
    if (this._events.length > 256) this._events.shift();
  }
}
