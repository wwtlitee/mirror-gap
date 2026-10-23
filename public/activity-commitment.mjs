import {needScore,NEED_METERS} from './need-display.mjs';
import {activityPermitted} from './behavior-focus.mjs';
const METRICS={eat:['satiety'],drink:['thirst'],rest:['energy','sleepPressure'],clean:['dirt','wetness'],toilet:['waste'],play:['curiosity'],observe:['comfort']};
const ACTIONS={eat:'eat',drink:'drink',rest:'rest',groom:'clean',bathe:'clean',toilet:'toilet',play:'play',observe:'observe'};
export const committedTo=(s,action)=>s.living.commitment?.action===action&&activityPermitted(s,action);
export function commitmentSource(s){
 const c=s.living.commitment;
 if(!c)return null;
 return c.resourceId?'resource:'+c.resourceId:({rest:'nest',play:'screen',observe:'window',toilet:'toilet'})[c.action]??null;
}
function metricScores(s,action){
 return Object.fromEntries(METRICS[action].map(key=>{
  const meter=NEED_METERS[key],group=meter.source==='needs'?s.needs:meter.source==='physiology'?s.living.physiology:s.living;
  const value=group[key]*(meter.source==='needs'?1:100);
  return [key,meter.inverse?100-value:value];
 }));
}
const complete=(s,action)=>METRICS[action].every(key=>needScore(s,key)===100);
export function updateCommitment(s){
 const l=s.living;
 let c=l.commitment;
 // Physiology is arbitrated by focus. A second emergency vote here used to
 // cancel every commitment whenever two different needs were critical.
 const emergency=()=>l.alert>.35||l.escape.phase==='burst';
 if(c){
  if(!activityPermitted(s,c.action)){l.commitment=null;return;}
  const scores=metricScores(s,c.action),score=Math.min(...Object.values(scores));
  if(complete(s,c.action)){l.commitment=null;return;}
  if(emergency(c.action)){l.commitment=null;return;}
  // Washing improves cleanliness before drying improves dryness. Compare real
  // consecutive measurements, while completion still requires every full meter.
  const improved=c.perMetricScores&&METRICS[c.action].some(key=>scores[key]>c.perMetricScores[key]+1e-8);
  if(score>c.bestScore||improved)c.lastProgressAt=s.simSeconds;
  c.bestScore=Math.max(c.bestScore,score);c.perMetricScores=scores;
  if(s.simSeconds-c.lastProgressAt>12){
   // A failed reach is not completion. Release the failed target for replanning.
   const source=commitmentSource(s);if(source)l.navigation.failedUntil[source]=s.simSeconds+20;
   (l.activityRetryUntil??={})[c.action]=s.simSeconds+20;
   l.commitment=null;return;
  }
  return;
 }
 const action=ACTIONS[l.behavior];
 if(!action||!activityPermitted(s,action)||!s.actor.contact||emergency(action)||complete(s,action))return;
 const scores=metricScores(s,action);
 l.commitment={action,resourceId:['eat','drink'].includes(action)?s.actor.consumingResource?.id??null:null,startedAt:s.simSeconds,lastProgressAt:s.simSeconds,bestScore:Math.min(...Object.values(scores)),perMetricScores:scores};
}
export function validateCommitment(c){
 if(c==null)return;
 if(!Object.hasOwn(METRICS,c.action)||!(c.resourceId===null||typeof c.resourceId==='string')||!['startedAt','lastProgressAt','bestScore'].every(k=>Number.isFinite(c[k])&&c[k]>=0)||c.bestScore>100)throw Error('Invalid activity commitment');
 const scores=c.perMetricScores;
 if(scores!==undefined&&(!scores||Array.isArray(scores)||typeof scores!=='object'||Object.keys(scores).length!==METRICS[c.action].length||Object.entries(scores).some(([key,value])=>!METRICS[c.action].includes(key)||!Number.isFinite(value)||value<0||value>100)))throw Error('Invalid activity progress metrics');
}
