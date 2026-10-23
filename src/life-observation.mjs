import {NEED_METERS,needScore} from '../public/need-display.mjs';

const COMPLETION_METERS={eat:['satiety'],drink:['thirst'],rest:['energy','sleepPressure'],toilet:['waste'],clean:['dirt','wetness'],play:['curiosity'],observe:['comfort']};
export function observationSample(state,wallMs) {
 const l=state.living;
 return {wallMs,simSeconds:state.simSeconds,version:state.version,paused:state.paused,
  position:[...state.actor.position],velocity:[...state.actor.velocity],contact:state.actor.contact,
  behavior:l.behavior,focus:l.focus?.action??null,target:l.navigation?.targetId??null,
  route:l.navigation?.route?.status??null,routeRemaining:l.navigation?.route?.remainingDistance??null,
  scores:Object.fromEntries(Object.keys(NEED_METERS).map(k=>[k,needScore(state,k)])),
  activityCooldowns:{...l.activityCooldowns},bowelMovements:l.hygiene.bowelMovements,
  escape:{phase:l.escape.phase,attempts:l.escape.attempts,escapes:l.escape.escapes},
  neuralMs:state.neural?.computeMs??null,neuralSliceMs:state.neural?.sliceMs??null,feedbackHz:state.neural?.feedbackHz??null,timing:state.server?.timing??null,neuralSequence:state.neural?.metrics?.sequence??null,
  neuralAvailable:state.neural?.available===true,persistenceError:state.server?.persistenceError??null};
}
const distribution=values=>{
 const a=values.filter(Number.isFinite).sort((a,b)=>a-b);
 return a.length?{p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1)}:null;
};
export function analyzeObservation(samples) {
 if(!samples.length)throw Error('No observation samples');
 const first=samples[0],last=samples.at(-1),behaviors={},focusSeconds={},issues=[],transitions=[];
 const metrics=Object.fromEntries(Object.keys(NEED_METERS).map(k=>[k,{first:first.scores[k],last:last.scores[k],min:100,max:0,recoveryPoints:0,fullRecoveries:0,declinedAfterFull:false}]));
 const completionEvents=[];
 const recovering=new Set(),completed=new Set();let rapidReturns=0,confinement=0,maxConfinement=0,anchor=first.position;
 const gaps=[];
 for(let i=0;i<samples.length;i++){
  const s=samples[i],p=samples[i-1],dt=p?Math.max(0,s.simSeconds-p.simSeconds):0;
  if(p){gaps.push(s.wallMs-p.wallMs);behaviors[p.behavior]=(behaviors[p.behavior]??0)+dt;focusSeconds[p.focus??'collecting']=(focusSeconds[p.focus??'collecting']??0)+dt;}
  if(p&&s.focus!==p.focus){transitions.push({at:s.simSeconds,from:p.focus,to:s.focus});const old=transitions.at(-2);if(old?.from===s.focus&&s.simSeconds-old.at<4)rapidReturns++;}
  const completedNow=new Set();
  if(p)for(const [action,keys] of Object.entries(COMPLETION_METERS)){
   const until=s.activityCooldowns?.[action]??0;
   if(until>(p.activityCooldowns?.[action]??0)&&until>s.simSeconds){completionEvents.push({action,observedAt:s.simSeconds,cooldownUntil:until});for(const key of keys)completedNow.add(key);}
  }
  for(const [k,m] of Object.entries(metrics)){
   const score=s.scores[k];if(!Number.isFinite(score)||score<0||score>100){if(!issues.includes('invalid-score:'+k))issues.push('invalid-score:'+k);continue;}
   m.min=Math.min(m.min,score);m.max=Math.max(m.max,score);
   if(score<95)recovering.add(k);
   if(p&&score>p.scores[k])m.recoveryPoints+=score-p.scores[k];
   if((score===100||completedNow.has(k))&&recovering.has(k)){m.fullRecoveries++;recovering.delete(k);completed.add(k);}
   if(completed.has(k)&&score<95)m.declinedAfterFull=true;
  }
  const productive=['eat','drink','rest','toilet','groom','bathe','play','observe'].includes(s.behavior);
  if(productive||s.focus==='explore'||s.paused||Math.hypot(...s.position.map((v,j)=>v-anchor[j]))>.35){confinement=0;anchor=s.position;}
  else confinement+=dt;
  maxConfinement=Math.max(maxConfinement,confinement);
  if(!s.neuralAvailable&&!issues.includes('neural-unavailable'))issues.push('neural-unavailable');
  if(s.persistenceError&&!issues.includes('persistence-error'))issues.push('persistence-error');
 }
 const wallSeconds=(last.wallMs-first.wallMs)/1000,simulationSeconds=last.simSeconds-first.simSeconds;
 if(maxConfinement>20)issues.push('nonproductive-confinement-over-20s');
 return {version:first.version,wallSeconds,simulationSeconds,simulationPerWallSecond:wallSeconds?simulationSeconds/wallSeconds:null,
  packets:samples.length,arrivalMs:distribution(gaps),gapsOver200ms:gaps.filter(n=>n>200).length,neuralMs:distribution(samples.map(s=>s.neuralMs)),
  neuralSliceMs:distribution(samples.map(s=>s.neuralSliceMs)),completionEvents,behaviors,focusSeconds,metrics,transitions,rapidReturns,maxNonproductiveConfinementSeconds:maxConfinement,
  eliminationEvents:last.bowelMovements-first.bowelMovements,escapeAttempts:last.escape.attempts-first.escape.attempts,issues,
  interpretation:'Observed recovery/full-score/decline are reported separately. Unseen activities and long-term cycles are not assumed to pass.'};
}
