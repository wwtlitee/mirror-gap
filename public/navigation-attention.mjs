import {bodyMetrics} from './body-metrics.mjs';
import {commitmentSource} from './activity-commitment.mjs';
import {urgentActivity,signalActivity,activityAvailable} from './activity-cooldowns.mjs';
import {focusedActivity,signalSupportsActivity} from './behavior-focus.mjs';
import {learnedForagingAvailable} from './learned-foraging.mjs';
import {updateRoute,validateRoute} from './route-planner.mjs';
import {resourceIntent} from './resource-contact.mjs';
import {stationaryActivity} from './behavior-policy.mjs';
import {topSurfaceApproach} from './environment-spec.mjs';
const PRIMARY=new Set(['nest','screen','window','toilet','high-perch','open-air']);
export const createNavigation=()=>({targetId:null,selectedAt:0,bestDistance:null,lastProgressAt:0,failedUntil:{},failedFrom:{},resourceWait:0,resourceId:null,approach:null,route:null});
export function validateNavigation(n){
 if(!n||!['selectedAt','lastProgressAt','resourceWait'].every(k=>Number.isFinite(n[k])&&n[k]>=0)||!(n.bestDistance===null||Number.isFinite(n.bestDistance))||!(n.targetId===null||typeof n.targetId==='string')||!(n.resourceId===null||typeof n.resourceId==='string')||!n.failedUntil||Object.values(n.failedUntil).some(v=>!Number.isFinite(v)||v<0))throw Error('Navigation checkpoint invalid');
 if(n.evidence!==undefined&&(!Array.isArray(n.evidence)||n.evidence.length>20||n.evidence.some(f=>!f||!Number.isFinite(f.t)||f.t<0||!f.scores||Array.isArray(f.scores)||Object.keys(f.scores).length>128||Object.values(f.scores).some(v=>!Number.isFinite(v)||v<0))))throw Error('Invalid attention evidence');
 if(n.nextReviewAt!==undefined&&(!Number.isFinite(n.nextReviewAt)||n.nextReviewAt<0))throw Error('Invalid attention review clock');
 if(n.approach&&(!['clear-edge','rise','cross-edge'].includes(n.approach.phase)||typeof n.approach.id!=='string'))throw Error('Approach checkpoint invalid');
 if(n.route!=null)validateRoute(n.route);
 if(n.failedFrom!==undefined&&(!n.failedFrom||Array.isArray(n.failedFrom)||Object.keys(n.failedFrom).length>256||Object.values(n.failedFrom).some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite))))throw Error('Invalid failed route origins');
}
function retire(n,target,now,seconds=30,position=null){
 if(target?.id)n.failedUntil[target.id]=now+seconds;
 if(target?.resourceId)n.failedUntil['resource:'+target.resourceId]=now+seconds;
 if(position)for(const id of [target?.id,target?.resourceId?'resource:'+target.resourceId:null].filter(Boolean))(n.failedFrom??={})[id]=[...position];
 n.targetId=null;n.approach=null;n.route=null;
}
// This arbitration changes sensory attention only. It never changes pose or motor output.
export function updateNavigation(state,signals=[],dt){
 const m=bodyMetrics(state.actor),n=state.living.navigation,now=state.simSeconds,focus=focusedActivity(state);
 for(const [id,until]of Object.entries(n.failedUntil)){
  const origin=n.failedFrom?.[id];
  if(until<=now||origin&&Math.hypot(...origin.map((v,i)=>v-state.actor.position[i]))>.65){delete n.failedUntil[id];if(n.failedFrom)delete n.failedFrom[id];}
 }
 if(state.living.escape?.phase==='burst'){
  // Do not return directly to the attraction that confined the body.
  retire(n,signals.find(s=>s.id===n.targetId)??{id:n.targetId},now);
  n.evidence=[];return;
 }
 const intent=resourceIntent(state),productive=state.actor.action==='eat'||state.living.behavior==='drink';
 if(intent&&!productive){n.resourceWait=n.resourceId===intent.id?n.resourceWait+dt:dt;n.resourceId=intent.id;
  if(n.resourceWait>=4){n.failedUntil['resource:'+intent.id]=now+20;n.resourceWait=0;n.resourceId=null;}
 }else{n.resourceWait=0;n.resourceId=null;}
 if((state.synapticForaging||learnedForagingAvailable(state,signals))&&focus==='eat'){
  // Preserve the contact timeout above. Only remote food waypoints are
  // removed; being unable to bite must still release a feeding hold.
  n.targetId=null;n.route=null;n.approach=null;n.evidence=[];return;
 }
 n.approach=topSurfaceApproach(state.actor,n.approach);
 if(focus==='explore'){
  // Free exploration uses local surface/airflow cues, not a mandatory remote
  // waypoint that would immediately turn every grounded walk into takeoff.
  n.targetId=null;n.route=null;return;
 }
 n.evidence??=[];
 const scores=Object.fromEntries((signals??[]).filter(s=>s.kind!=='neutral-odor'&&(s.resourceKind||PRIMARY.has(s.id))&&Number.isFinite(s.intensity)&&s.intensity>=0).map(s=>[s.id,s.intensity]));
 n.evidence.push({t:now,scores});while(n.evidence.length>20||n.evidence.length>1&&now-n.evidence[0].t>2)n.evidence.shift();
 const averaged=(signals??[]).map(s=>({...s,intensity:n.evidence.reduce((sum,f)=>sum+(f.scores[s.id]??0),0)/n.evidence.length}));
 const committed=commitmentSource(state),matches=s=>s.id===committed||'resource:'+s.resourceId===committed;
 const eligible=averaged.filter(s=>s.kind!=='neutral-odor'&&(s.resourceKind||PRIMARY.has(s.id))&&s.intensity>0
  &&!(state.synapticForaging&&s.resourceKind==='food')
  &&(focus?signalSupportsActivity(state,s):activityAvailable(state,signalActivity(s)))
  &&(focus||s.regionalNeed>.1||matches(s)));
 const candidates=eligible.filter(s=>!(n.failedUntil[s.id]>now)&&!(n.failedUntil['resource:'+s.resourceId]>now)).sort((a,b)=>b.intensity-a.intensity);
 let current=candidates.find(s=>s.id===n.targetId);
 const doing=Boolean(stationaryActivity(state))||['eat','drink','rest','play','watch','toilet','bathe','groom','observe'].includes(state.living.behavior);
 if(current){
  const distance=n.route?.status==='ready'?n.route.remainingDistance:current.distance;
  if(n.bestDistance===null||distance<n.bestDistance-Math.max(.003,.08*m.scale)||doing){n.bestDistance=distance;n.lastProgressAt=now;}
  if(!doing&&now-n.lastProgressAt>18){retire(n,current,now,20,state.actor.position);current=null;}
 }
 // Physiological preemption belongs to focus, not a second navigation policy.
 const emergency=focus?null:current&&urgentActivity(state,signalActivity(current))?current:candidates.find(s=>!(n.failedUntil[s.id]>now)&&urgentActivity(state,signalActivity(s)));
 const best=emergency??candidates.find(matches)??candidates.find(s=>!(n.failedUntil[s.id]>now));
 if(!current||emergency||now>=(n.nextReviewAt??0)){
  n.nextReviewAt=now+2;
  if(!current||(committed&&best&&matches(best)&&!matches(current))||(emergency&&best.id!==current.id)||(!focus&&!doing&&now-n.selectedAt>6&&best&&best.id!==current.id&&best.intensity>current.intensity*1.7)){
   current=best;n.targetId=best?.id??null;n.selectedAt=now;n.lastProgressAt=now;n.bestDistance=best?.distance??null;n.route=null;
  }
 }
 // Bounded work per tick. Route following still enters through neural sensation.
 for(let attempt=0;attempt<2&&current&&!doing;attempt++){
  if(!Array.isArray(current.position))break;
  const startBlocked=n.route?.status==='unreachable'&&n.route.reason==='start-blocked';
  if(startBlocked&&now-n.route.plannedAt<1)break;
  n.route=updateRoute(state.actor,current.id,current.position,startBlocked?null:n.route,now,current.arrival??null);
  if(!['unreachable','stalled'].includes(n.route.status))break;
  // Being wedged at the start says nothing about whether the water/toilet is
  // reachable once the body leaves that spot. Keep the need and retry locally.
  if(n.route.reason==='start-blocked')break;
  retire(n,current,now,12,state.actor.position);
  current=candidates.find(s=>!(n.failedUntil[s.id]>now)&&!(n.failedUntil['resource:'+s.resourceId]>now));
  n.targetId=current?.id??null;n.selectedAt=now;n.lastProgressAt=now;n.bestDistance=null;
 }
}
