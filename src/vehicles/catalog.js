import {GENERATED_VEHICLES} from './generated-manifest.js';
import {assetUrl} from '../asset-url.js';

const definitions = [
  ['falcon', '赤焰游隼', '帅气', 0xd64c3e, '低伏车头，尾翼掠风。', '为每一次漂亮超越而生。', 'sport'],
  ['black-muscle', '暗金雷霆', '帅气', 0x8e7646, '黑金引擎，蓄势轰鸣。', '把直道开成自己的主场。', 'sport'],
  ['blue-rally', '疾风蓝鲨', '帅气', 0x3474bb, '拉力灯亮，勇往直前。', '带着冒险的心，冲进下一个弯。', 'offroad'],
  ['mint-cat', '薄荷喵喵', '可爱', 0x8bcfbb, '猫耳迎风，尾巴翘起。', '可爱，也可以快得出奇。', 'cute'],
  ['panda', '熊猫快跑', '可爱', 0xdadaca, '黑白团子，竹节排气。', '看起来软萌，超车很认真。', 'cute'],
  ['star-shuttle', '星河迅雷', '科幻', 0x6996af, '离子引擎，星际来客。', '把首钢园当作下一站银河。', 'sport'],
  ['moon-rover', '月球探测车', '科幻', 0xe6a348, '月面装备，全副武装。', '今天的探索目标：终点线。', 'offroad'],
  ['violet-mech', '紫电机甲', '科幻', 0x9759cc, '机甲装甲，紫电破风。', '启动核心，进入竞速状态。', 'sport'],
  ['bubble-duck', '泡泡鸭鸭', '搞笑', 0xf3c744, '浴缸上路，鸭鸭领航。', '一边兜风，一边制造快乐。', 'cute'],
  ['burger', '美味汉堡', '搞笑', 0xda9a45, '芝士加满，生菜起飞。', '请注意：这份快餐真的很快。', 'cute'],
];
export const VEHICLES = Object.freeze(definitions.map(([id,name,category,color,line1,line2,wheel],index) => Object.freeze({
  id,name,category,color,line1,line2,wheel,index,
  reference:assetUrl(`/assets/vehicles/references/${id}.png`),
  ...GENERATED_VEHICLES[id],
  thumbnail:assetUrl(GENERATED_VEHICLES[id]?.thumbnail||`/assets/vehicles/references/${id}.png`),
  body:GENERATED_VEHICLES[id]?.body?{...GENERATED_VEHICLES[id].body,url:assetUrl(GENERATED_VEHICLES[id].body.url)}:null,
  wheelAsset:GENERATED_VEHICLES[id]?.wheelAsset?{...GENERATED_VEHICLES[id].wheelAsset,url:assetUrl(GENERATED_VEHICLES[id].wheelAsset.url)}:null,
  available:!!(GENERATED_VEHICLES[id]?.body?.url && GENERATED_VEHICLES[id]?.wheelAsset?.url),
})));
const byId = new Map(VEHICLES.map(vehicle => [vehicle.id, vehicle]));
export const vehicleById = id => byId.get(id) || null;
export const availableVehicles = () => VEHICLES.filter(vehicle => vehicle.available);
export const validVehicleId = id => typeof id === 'string' && byId.get(id)?.available ? id : null;
export const SELECTION_KEY = 'shougang-vehicle-v1';
export function readVehicleChoice() {
  try { return validVehicleId(localStorage.getItem(SELECTION_KEY)); } catch { return null; }
}
export function saveVehicleChoice(id) {
  const choice = validVehicleId(id);
  if (!choice) return false;
  try { localStorage.setItem(SELECTION_KEY, choice); } catch { /* Selection still works without storage. */ }
  return true;
}
