import {hashSeed,seededRandom} from './companion-identity.mjs';
export const WEATHER_TYPES={rain:{label:'下雨',en:'Rain',rain:1,wind:.65,cloud:.8},drizzle:{label:'小雨',en:'Drizzle',rain:.4,wind:.25,cloud:.6},cloudy:{label:'阴天',en:'Cloudy',rain:0,wind:.4,cloud:.65},clear:{label:'晴朗',en:'Clear',rain:0,wind:.15,cloud:0}};
export const WEATHER_SLOT_MS=10*60*1000;
export function weatherChoice(seed,slot){const n=seededRandom(hashSeed(seed+':weather:'+slot))();return n<.45?'rain':n<.75?'drizzle':n<.92?'cloudy':'clear';}
export function weatherAt(seed,now=Date.now(),mode='auto'){
  const slot=Math.floor(now/WEATHER_SLOT_MS),automatic=mode==='auto'||!Object.hasOwn(WEATHER_TYPES,mode);
  const type=automatic?weatherChoice(seed,slot):mode,previous=automatic?weatherChoice(seed,slot-1):type;
  const t=automatic?Math.max(0,Math.min(1,(now-slot*WEATHER_SLOT_MS)/25000)):1;
  const a=WEATHER_TYPES[previous],b=WEATHER_TYPES[type];
  return {type,label:b.label,en:b.en,mode:automatic?'auto':mode,rain:a.rain+(b.rain-a.rain)*t,wind:a.wind+(b.wind-a.wind)*t,cloud:a.cloud+(b.cloud-a.cloud)*t,slot};
}
