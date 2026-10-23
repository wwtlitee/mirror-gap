import test from 'node:test';
import assert from 'node:assert/strict';
import {NEED_METERS,needScore} from '../public/need-display.mjs';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {updateBodyNeeds} from '../public/body-needs.mjs';
function group(s,m){return m.source==='needs'?s.needs:m.source==='physiology'?s.living.physiology:s.living;}
test('all ten metrics show 100 at best, 0 at worst, without changing simulation values',()=>{
 const state=new EmbodiedLife().state;assert.equal(Object.keys(NEED_METERS).length,10);
 for(const [key,m]of Object.entries(NEED_METERS)){
  const max=m.source==='needs'?100:1;
  group(state,m)[key]=m.inverse?0:max;assert.equal(needScore(state,key),100,key);
  group(state,m)[key]=m.inverse?max:0;assert.equal(needScore(state,key),0,key);
  group(state,m)[key]=max*.25;const before=structuredClone(state);assert.equal(needScore(state,key),m.inverse?75:25,key);assert.deepEqual(state,before);
 }
});
test('care improves corresponding positive scores with real physiology updates',()=>{
 const s=new EmbodiedLife().state;Object.assign(s.living.physiology,{thirst:.5,dirt:.5,waste:.8,sleepPressure:.5});s.needs.curiosity=50;s.actor.contact=true;s.actor.zoneId='garden';s.living.contactSeconds=3;s.living.hygiene.toiletElapsed=3;
 const keys=['thirst','dirt','sleepPressure','curiosity'],before=keys.map(k=>needScore(s,k));
 updateBodyNeeds(s,{atWater:true,drinking:true,resting:true,bathing:true,toileting:false,hour:12},10);
 keys.forEach((k,i)=>assert.ok(needScore(s,k)>before[i],k));
 Object.assign(s.actor,{zoneId:'toilet',position:[4.39,.615,.38],heading:Math.PI/2});
 const wasteBefore=needScore(s,'waste');
 updateBodyNeeds(s,{toileting:true,hour:12},10);
 assert.ok(needScore(s,'waste')>wasteBefore);
});
test('invalid values remain unknown, and out-of-range values are clamped',()=>{
 for(const key of Object.keys(NEED_METERS)){
  const m=NEED_METERS[key],s={needs:{},living:{physiology:{}}};
  for(const v of [undefined,null,NaN,Infinity,'50']){group(s,m)[key]=v;assert.equal(needScore(s,key),null);}
  for(const v of [-999,999]){group(s,m)[key]=v;assert.ok([0,100].includes(needScore(s,key)));}
 }
});
