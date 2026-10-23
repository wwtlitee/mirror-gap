import {needScore} from './need-display.mjs';
export const ACTIVITY_COOLDOWN_SECONDS=180;
export function urgentActivity(state,action){
 const n=state.needs,p=state.living.physiology;
 return ({eat:n.satiety<20,drink:p.thirst>.8,rest:n.energy<15||p.sleepPressure>.9,
  toilet:p.waste>.9,clean:p.dirt>.8||state.living.wetness>.7})[action]??false;
}
export function activityAvailable(state,action){
 if(action?.startsWith('explore:'))action='play';
 return urgentActivity(state,action)||Math.max(state.living.activityCooldowns?.[action]??0,state.living.activityRetryUntil?.[action]??0)<=state.simSeconds;
}
export function startActivityCooldown(state,action){
 const map=state.living.activityCooldowns??={};
 if((map[action]??0)<=state.simSeconds)map[action]=state.simSeconds+ACTIVITY_COOLDOWN_SECONDS;
}
export function validateActivityCooldowns(map){
 if(map===undefined)return;
 if(!map||Array.isArray(map)||typeof map!=='object'||Object.entries(map).some(([k,v])=>! /^(eat|drink|rest|toilet|clean|play|observe|explore:[a-z-]+)$/.test(k)||!Number.isFinite(v)||v<0))throw Error('Invalid activity cooldowns');
}
// A displayed full score starts one cooldown, rather than extending it every tick.
const TARGETS={eat:['satiety'],drink:['thirst'],rest:['energy','sleepPressure'],toilet:['waste'],clean:['dirt','wetness'],play:['curiosity'],observe:['comfort']};
export function updateActivityCooldowns(state){
 const l=state.living,previous=l.activityFull??={};
 for(const [action,keys]of Object.entries(TARGETS)){
  const full=keys.every(key=>needScore(state,key)===100);
  if(full&&!previous[action])startActivityCooldown(state,action);
  previous[action]=full;
 }
}
export function validateActivityFull(map){
 if(map!==undefined&&(!map||Array.isArray(map)||typeof map!=='object'||Object.entries(map).some(([k,v])=>!Object.hasOwn(TARGETS,k)||typeof v!=='boolean')))throw Error('Invalid activity completion state');
}
export function signalActivity(source){
 if(source.resourceKind==='food')return 'eat';
 if(source.resourceKind==='water')return 'drink';
 return ({nest:'rest',screen:'play',toilet:'toilet',window:'observe'})[source.id]??(source.scope==='surface'?'explore:'+source.zone:null);
}
