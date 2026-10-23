import {foodStock} from './food-stock.mjs';
import {createCare,validateCare} from './pet-care.mjs';
import {bodyCheckpoint,validateBodyCheckpoint,restoreBody} from './body-checkpoint.mjs';
import {createCompanion,validateCompanion} from './companion-identity.mjs';
import {applyGrowthSize} from './companion-growth.mjs';
import {validateSynapticMemory,validateSynapticMemoryMode} from './synaptic-memory-schema.mjs';
import {VERSION} from './world-spec.mjs';
export const COMPANION_STORAGE_KEY='mirror-gap-companion-v2';
export const LEGACY_STORAGE_KEY='mirror-gap-digital-twin-body-v1';
export const BACKUP_STORAGE_KEY='mirror-gap-companion-backup-v2';
export const GOOD_SNAPSHOTS_STORAGE_KEY='mirror-gap-companion-good-v1';
export const MAX_GOOD_SNAPSHOTS=3;
export const GOOD_SNAPSHOT_INTERVAL_MS=60000;
export const MAX_CHECKPOINT_BYTES=256000;
const byteLength=value=>new TextEncoder().encode(value).length;
function validateMetadata(metadata){
  if(metadata===undefined)return;
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)
    ||typeof metadata.productVersion!=='string'||!/^\d+\.\d+\.\d+[a-z]?$/.test(metadata.productVersion)
    ||!Number.isSafeInteger(metadata.revision)||metadata.revision<0
    ||!(metadata.modelFingerprint===null||typeof metadata.modelFingerprint==='string'&&/^[a-f0-9]{64}$/.test(metadata.modelFingerprint)))throw Error('果蝇存档来源信息无效。');
  const parts=version=>version.match(/^(\d+)\.(\d+)\.(\d+)([a-z]?)$/).slice(1).map((part,i)=>i<3?Number(part):part?part.charCodeAt(0)-96:0);
  const incoming=parts(metadata.productVersion),current=parts(VERSION);
  for(let i=0;i<current.length;i++){
    if(incoming[i]>current[i])throw Error('这份存档来自更新版本，请先更新页面，原数据没有被覆盖。');
    if(incoming[i]<current[i])break;
  }
}
export function validateCompanionCheckpoint(value) {
  if(!value||value.format!==2||!Number.isFinite(value.savedAt)||value.savedAt<0||value.savedAt>8.64e15)throw Error('不支持的果蝇存档格式。');
  validateBodyCheckpoint(value.body);validateCompanion(value.companion);
  validateMetadata(value.metadata);
  if(Object.hasOwn(value,'synapticMemory'))validateSynapticMemory(value.synapticMemory);
  if(Object.hasOwn(value,'synapticMemoryMode')){
    validateSynapticMemoryMode(value.synapticMemoryMode);
    if(!Object.hasOwn(value,'synapticMemory'))throw Error('突触记忆模式缺少对应权重。');
  }
  if(value.habitat){const h=value.habitat;if(!['food','water'].every(k=>Number.isFinite(h[k])&&h[k]>=0&&h[k]<=100)||!Number.isFinite(h.seconds)||h.seconds<0||h.seconds>1e12||!Number.isFinite(h.hour)||h.hour<0||h.hour>=24)throw Error('房间存档无效');validateCare(h.care);}
  const sanitation=value.habitat?.sanitation;
  if(sanitation&&(!Number.isSafeInteger(sanitation.bowelMovements)||sanitation.bowelMovements<0||sanitation.bowelMovements>1e12||!(sanitation.lastDropPosition===null||Array.isArray(sanitation.lastDropPosition)&&sanitation.lastDropPosition.length===3&&sanitation.lastDropPosition.every(v=>Number.isFinite(v)&&Math.abs(v)<=10))))throw Error('卫生存档无效');
  if(byteLength(JSON.stringify(value))>MAX_CHECKPOINT_BYTES)throw Error('果蝇存档过大。');
  return value;
}
export function parseCompanionCheckpoint(text) {
  if(typeof text!=='string'||byteLength(text)>MAX_CHECKPOINT_BYTES)throw Error('请选择有效的果蝇备份文件。');
  return validateCompanionCheckpoint(JSON.parse(text));
}
export function companionCheckpoint(state,{revision=0,modelFingerprint=null}={}) {
  const synapticMemory=Object.hasOwn(state,'synapticMemory')
    ?{synapticMemory:structuredClone(validateSynapticMemory(state.synapticMemory)),
      synapticMemoryMode:validateSynapticMemoryMode(state.synapticMemoryMode??'legacy-food')}:{};
  state.living.care??=createCare();foodStock(state);
  return validateCompanionCheckpoint({format:2,savedAt:Date.now(),metadata:{productVersion:VERSION,revision,modelFingerprint},body:bodyCheckpoint(state),habitat:{...state.home,seconds:state.simSeconds,hour:((state.living.clock.hour+(state.simSeconds-state.living.clock.anchor)/60)%24+24)%24,care:structuredClone(state.living.care??createCare()),sanitation:{bowelMovements:state.living.hygiene.bowelMovements,lastDropPosition:structuredClone(state.living.hygiene.lastDropPosition)}},companion:structuredClone(state.companion),...synapticMemory});
}
export function restoreCompanion(state,saved) {
  if(saved?.format===2)validateCompanionCheckpoint(saved);else if(saved)validateBodyCheckpoint(saved);
  state.living.care=createCare();state.living.clock={mode:'cycle',anchor:state.simSeconds,hour:9};
  if(saved?.format===2){restoreBody(state,saved.body);state.companion=structuredClone(saved.companion);if(saved.habitat){const h=saved.habitat;state.home={food:h.food,water:h.water};state.simSeconds=h.seconds;state.living.clock={mode:'cycle',anchor:h.seconds,hour:h.hour};state.living.care=structuredClone(h.care);if(h.sanitation)Object.assign(state.living.hygiene,structuredClone(h.sanitation));if(h.care.maintenance?.quiet)state.living.workstation.enabled=false;}}
  else {if(saved)restoreBody(state,saved);state.companion=createCompanion();}
  if(saved?.format===2&&Object.hasOwn(saved,'synapticMemory')){
    state.synapticMemory=structuredClone(saved.synapticMemory);
    state.synapticMemoryMode=saved.synapticMemoryMode??'legacy-food';
  }else{delete state.synapticMemory;delete state.synapticMemoryMode;}
  applyGrowthSize(state);
}
export function readCompanionStorage(storage) {
  const current=storage.getItem(COMPANION_STORAGE_KEY);
  if(current!==null)return parseCompanionCheckpoint(current);
  const legacy=storage.getItem(LEGACY_STORAGE_KEY);
  if(legacy!==null){const value=JSON.parse(legacy);validateBodyCheckpoint(value);return value;}
  return null;
}
export function writeCompanionStorage(storage,value,{backup=false}={}) {
  validateCompanionCheckpoint(value);
  const previous=storage.getItem(COMPANION_STORAGE_KEY);
  let snapshots=[],snapshotError=null;
  try{snapshots=readGoodCompanionSnapshots(storage,{strict:true});}catch(error){
    snapshotError=error.message;
    // An auxiliary recovery file cannot block a valid primary save. Keep its
    // raw bytes untouched and still offer any individually valid entries.
    try{snapshots=readGoodCompanionSnapshots(storage);}catch{}
  }
  // Keep the preceding valid primary as well, including a v2 save from before
  // rolling snapshots existed. A damaged primary is preserved only as raw data.
  let prior;
  if(previous!==null){try{prior=parseCompanionCheckpoint(previous);}catch{}}
  const newest=snapshots[0];
  const identityChanged=prior&&(prior.companion.identity.id!==value.companion.identity.id
    ||prior.companion.identity.adoptedAt!==value.companion.identity.adoptedAt);
  // An imported clock may be ahead, or the local clock may move backwards.
  // Start a new interval on the current clock and retain the preceding primary.
  const clockMovedBackwards=newest&&value.savedAt<newest.savedAt;
  const recordSnapshot=!snapshotError&&(backup||!newest||identityChanged||clockMovedBackwards||value.savedAt-newest.savedAt>=GOOD_SNAPSHOT_INTERVAL_MS);
  let good=snapshots;
  if(recordSnapshot){
    const candidates=[value,...(backup||!newest||clockMovedBackwards?prior?[prior]:[]:[]),...snapshots],seen=new Set();
    good=candidates.filter(checkpoint=>{
      const key=companionSnapshotKey(checkpoint);if(seen.has(key))return false;seen.add(key);return true;
    }).slice(0,MAX_GOOD_SNAPSHOTS);
  }
  if(backup&&previous!==null)storage.setItem(BACKUP_STORAGE_KEY,previous);
  // localStorage has no multi-key transaction. Write verified recovery copies
  // first; a subsequent primary-write failure is still reported to the caller.
  if(recordSnapshot){
    try{storage.setItem(GOOD_SNAPSHOTS_STORAGE_KEY,JSON.stringify({format:1,snapshots:good}));}
    catch(error){
      // An automatic recovery copy is auxiliary. A quota failure may still
      // allow replacement of the smaller existing primary. Retain the actual
      // old copies and report degraded recovery; never claim unwritten copies.
      snapshotError=`恢复快照更新失败：${error.message??String(error)}`;
      good=snapshots;
    }
  }
  storage.setItem(COMPANION_STORAGE_KEY,JSON.stringify(value));
  return {snapshots:good,snapshotError};
}

export function companionSnapshotKey(checkpoint){return `${checkpoint.companion.identity.id}:${checkpoint.metadata?.revision??0}:${checkpoint.savedAt}`;}
export function readGoodCompanionSnapshots(storage,{strict=false}={}){
  const text=storage.getItem(GOOD_SNAPSHOTS_STORAGE_KEY);if(text===null)return [];
  if(typeof text!=='string'||byteLength(text)>MAX_CHECKPOINT_BYTES*MAX_GOOD_SNAPSHOTS+100)throw Error('恢复快照文件过大，原数据已保留。');
  let value;try{value=JSON.parse(text);}catch{throw Error('恢复快照无法读取，原数据已保留。');}
  if(!value||value.format!==1||!Array.isArray(value.snapshots)||value.snapshots.length>MAX_GOOD_SNAPSHOTS)throw Error('恢复快照格式无效，原数据已保留。');
  const valid=value.snapshots.filter(checkpoint=>{try{validateCompanionCheckpoint(checkpoint);return true;}catch{return false;}});
  if(strict&&valid.length!==value.snapshots.length)throw Error('部分恢复快照无效，原数据已保留。');
  return valid;
}
