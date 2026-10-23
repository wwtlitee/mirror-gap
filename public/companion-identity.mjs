import {VOICE_BANKS} from './companion-voice-catalog.mjs';
import {DEVELOPMENT_LABELS,createDevelopment,ensureDevelopment,validateDevelopment,developmentSummary} from './companion-development.mjs';
import {createGrowth,ensureGrowth,validateGrowth,growthSummary} from './companion-growth.mjs';
// Identity is independent of the simulation RNG and survives every restart.
export const TRAIT_COUNTS = Object.freeze({eyes:24, shell:24, abdomen:16, wings:16, antennae:8, core:16});
export function hashSeed(value) {
  let h = 2166136261;
  for (const c of value) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => { s += 0x6d2b79f5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function appearanceFromSeed(seed) {
  const random = seededRandom(hashSeed(seed));
  return {version:1, ...Object.fromEntries(Object.entries(TRAIT_COUNTS).map(([key,count]) => [key, Math.floor(random()*count)])), hue:Math.floor(random()*360)};
}
export function temperamentFromSeed(seed) {
  const random = seededRandom(hashSeed(seed + ':temperament'));
  const bank=VOICE_BANKS[hashSeed(seed+':voice')%VOICE_BANKS.length];
  return Object.fromEntries(['curiosity','caution','sociability'].map(key=>[key,Math.max(.25,Math.min(.75,bank[key]+(random()-.5)*.12))]));
}
export function validName(value) {
  if (typeof value !== 'string') throw Error('请给果蝇取一个名字。');
  const name = value.normalize('NFC').trim();
  if (!name || [...name].length > 24 || /[\p{Cc}\p{Cf}<>]/u.test(name)) throw Error('名字需为 1—24 个字符，不能含控制符或尖括号。');
  return name;
}
export function createCompanion({id=crypto.randomUUID(),seed,now=Date.now()}={}) {
  seed ??= [...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
  return {format:1, identity:{id,seed,name:'',createdAt:now,adoptedAt:null}, temperament:temperamentFromSeed(seed),
    activeSeconds:0, growth:createGrowth(), learning:{food:{},place:{},game:{},interaction:{}}, development:createDevelopment(), memories:[], voice:{bank:VOICE_BANKS[hashSeed(seed+':voice')%VOICE_BANKS.length].id,enabled:false,volume:.7}};
}
export function adoptCompanion(companion, name, now=Date.now()) {
  if (companion.identity.adoptedAt !== null) throw Error('已经领养了这只果蝇，可以在档案里改名。');
  companion.identity.name = validName(name); companion.identity.adoptedAt = now;
}
export const FOOD_NAMES = Object.freeze(DEVELOPMENT_LABELS.food);
export const PLACE_NAMES = Object.freeze(DEVELOPMENT_LABELS.place);
export const GAME_NAMES = Object.freeze(DEVELOPMENT_LABELS.game);
export const INTERACTION_NAMES = Object.freeze(DEVELOPMENT_LABELS.interaction);
export const MEMORY_LABELS = {food:FOOD_NAMES,place:PLACE_NAMES,game:GAME_NAMES,interaction:INTERACTION_NAMES};
const record = value => value && typeof value==='object' && !Array.isArray(value);
const number = (v,min,max) => typeof v==='number' && Number.isFinite(v) && v>=min && v<=max;
const text = (v,max) => typeof v==='string' && v.length<=max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
export function validateCompanion(c) {
  const i=c?.identity;
  if (!record(c)||c.format!==1||!record(i)||!/^[-a-f\d]{36}$/i.test(i.id)||! /^[a-f\d]{32}$/i.test(i.seed)
    ||!number(i.createdAt,0,9e15)||!(i.adoptedAt===null||number(i.adoptedAt,i.createdAt,9e15))
    ||!(i.adoptedAt===null?i.name==='':validName(i.name)===i.name)||!number(c.activeSeconds,0,1e12)) throw Error('果蝇身份存档无效，原数据已保留。');
  if (!record(c.temperament)||!['curiosity','caution','sociability'].every(k=>number(c.temperament[k],.25,.75))) throw Error('性格存档无效。');
  if(!record(c.learning))throw Error('学习存档无效。');
  for(const [kind,labels] of Object.entries(MEMORY_LABELS)) {
    const values=c.learning[kind];
    if(!record(values)||Object.entries(values).some(([key,v])=>!Object.hasOwn(labels,key)||!record(v)||!number(v.score,-1,1)||!Number.isSafeInteger(v.count)||v.count<1||v.count>1e9||!number(v.lastAt,0,c.activeSeconds)))throw Error('偏好存档无效。');
  }
  if(!Array.isArray(c.memories)||c.memories.length>80||c.memories.some(m=>!record(m)||!Object.hasOwn(MEMORY_LABELS,m.kind)||!Object.hasOwn(MEMORY_LABELS[m.kind],m.target)||!number(m.at,0,c.activeSeconds)||!number(m.reward,-1,1)||!text(m.text,240)))throw Error('经历存档无效。');
  if(!record(c.voice)||!VOICE_BANKS.some(bank=>bank.id===c.voice.bank)||typeof c.voice.enabled!=='boolean'||!number(c.voice.volume,0,1))throw Error('声音设置无效。');
  // Old saves retain every existing impression. They start durable development
  // without inventing spaced experiences that the old format did not record.
  if(c.development===undefined)c.development=createDevelopment();
  validateDevelopment(c.development,c.activeSeconds);
  if(c.growth===undefined)ensureGrowth(c);
  validateGrowth(c.growth,c.activeSeconds);
  return c;
}
export function companionSummary(c) {
  if(!c)return null;
  ensureDevelopment(c);
  return structuredClone({...c,appearance:appearanceFromSeed(c.identity.seed),memories:c.memories.slice(-12),developmentSummary:developmentSummary(c),growthSummary:growthSummary(c)});
}
