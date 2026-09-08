// Millimetre-scale pose precision; progress needs six decimals for checkpoints.
export function compactNumber(key,value){
  if(typeof value!=='number'||!Number.isFinite(value)||Number.isInteger(value))return value;
  const precision=['progress','totalProgress','_pathT'].includes(key)?1e6:1e4;
  return Math.round(value*precision)/precision;
}

export function encodeSnapshot(room,state,events,serverTime){
  const sequence=room.snapshotSequence=(room.snapshotSequence||0)+1;
  return JSON.stringify({type:'snapshot',protocol:2,raceId:room.raceId,serverTime,state,
    pickups:sequence===1||sequence%100===0?room.game.pickups:undefined,
    pickupStates:room.game.pickups.filter(p=>!p.active).map(p=>[p.id,p.respawn]),
    hazards:room.game.hazards,events},compactNumber);
}
