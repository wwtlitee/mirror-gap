import {MEMORY_LABELS, hashSeed, seededRandom} from './companion-identity.mjs';
import {ensureDevelopment,recordHabit,stablePreference,recordRelationship,recordCueOutcome,practiceToy,addMilestone} from './companion-development.mjs';
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const sessions=new WeakMap();
const adopted=c=>Boolean(c&&c.identity.adoptedAt!==null);
const bodySample=state=>({satiety:state.needs.satiety,comfort:state.needs.comfort,energy:state.needs.energy,thirst:state.living.physiology.thirst,dirt:state.living.physiology.dirt,wetness:state.living.wetness,gameElapsed:state.living.workstation.elapsed,gamePhase:state.living.workstation.phase,gameId:state.living.workstation.gameId,footstep:state.living.care?.footstep??0});
function trackerFor(state){
  let tracker=sessions.get(state);
  if(!tracker){tracker={elapsed:0,previous:bodySample(state),escape:'calm',session:null,pending:[],results:[],sequence:0,sounds:new Map()};sessions.set(state,tracker);}
  return tracker;
}
export function rememberOutcome(c,kind,target,reward,text,evidence){
  if(!adopted(c)||!Object.hasOwn(MEMORY_LABELS[kind]??{},target)||!Number.isFinite(reward))return;
  reward=clamp(reward,-1,1);
  const previous=c.learning[kind][target];
  const score=previous?previous.score+.18*(reward-previous.score):reward*.35;
  c.learning[kind][target]={score:clamp(score,-1,1),count:Math.min(1e9,(previous?.count??0)+1),lastAt:c.activeSeconds};
  c.memories.push({kind,target,reward,at:c.activeSeconds,text:String(text).slice(0,240)});
  if(c.memories.length>80)c.memories.splice(0,c.memories.length-80);
  if(evidence)recordHabit(c,kind,target,reward,evidence);
}
function flush(c,session){
  if(!session||session.duration<3)return;
  const reward=clamp(session.reward/session.duration,-1,1),label=MEMORY_LABELS[session.kind][session.target];
  const text=session.kind==='food'?`吃了${label}，饱足度恢复了 ${Math.max(0,session.gain).toFixed(1)} 分。`
    :session.kind==='game'?`玩了${label}，这次的体验${reward>.2?'很愉快':reward<-.2?'有些紧张':'很平静'}。`
    :`在${label}待了一会儿，感觉${reward>.2?'舒适':reward<-.2?'紧张':'平静'}。`;
  rememberOutcome(c,session.kind,session.target,reward,text,{duration:session.duration});
}
export function learningUrgent(state){
  const p=state.living.physiology;
  return state.needs.satiety<20||state.needs.energy<20||p.thirst>.8||p.sleepPressure>.8||p.waste>.85;
}
const soundContext=state=>state.living.sleep.active||state.living.behavior==='rest'?'rest':'active';
function sampleSounds(state,tracker,elapsed){
  const c=state.companion,care=state.living.care,context=soundContext(state);
  const present=new Set();
  for(const type of ['rain','wind'])if((care?.[type]??0)>.12)present.add(type);
  if((care?.footstep??0)>tracker.previous.footstep)tracker.footstepUntil=c.activeSeconds+12;
  if(c.activeSeconds<(tracker.footstepUntil??0))present.add('footstep');
  if(tracker.pending.some(p=>p.type==='chime'&&p.age<18))present.add('chime');
  const reward=clamp(.15+state.needs.comfort/100*.35-state.living.alert*.95-(care?.weakness??0)*.3,-1,1);
  for(const [key,sample] of tracker.sounds){
    if(!present.has(key.split(':')[0])||!key.endsWith(':'+context)||sample.duration>=45){
      recordHabit(c,'sound',key,sample.reward/Math.max(1,sample.duration),{duration:sample.duration});tracker.sounds.delete(key);
    }
  }
  for(const type of present){const key=`${type}:${context}`,sample=tracker.sounds.get(key)??{duration:0,reward:0};sample.duration+=elapsed;sample.reward+=reward*elapsed;tracker.sounds.set(key,sample);}
}
function sampleInteractions(state,tracker,elapsed,outcome){
  const c=state.companion,l=state.living;
  for(const pending of tracker.pending){
    pending.age+=elapsed;pending.calmSeconds+=l.alert<.3?elapsed:0;
    pending.stressSeconds+=l.alert>.65?elapsed:0;
    const benefits=pending.type==='feed'?outcome.food:pending.type==='water'?outcome.water:pending.type==='bedding'||pending.type==='quiet'?outcome.rest
      :pending.type==='dry'?outcome.dry:['mist','brush'].includes(pending.type)?outcome.clean:pending.type==='clean'?outcome.clean+outcome.comfort:pending.type==='enrich'?outcome.play:outcome.food+outcome.water+outcome.rest+outcome.clean+outcome.play;
    pending.benefit+=benefits;
    const paired=pending.benefit>=1&&pending.calmSeconds>=8&&pending.age>=12;
    if(!paired&&pending.age<90)continue;
    const reward=paired?clamp(.55+pending.benefit*.12,0,1):pending.stressSeconds>=8?-.45:0;
    const description=paired?`${MEMORY_LABELS.interaction[pending.type]}之后，实际${pending.type==='feed'?'吃到了食物':pending.type==='water'?'喝到了水':'获得了恢复或愉快体验'}。`
      :`${MEMORY_LABELS.interaction[pending.type]}之后${reward<0?'仍然紧张，暂时保持距离':'没有发生可确认的恢复'}。`;
    rememberOutcome(c,'interaction',pending.type,reward,description,{duration:pending.age});
    recordRelationship(c,reward);
    if(pending.type==='chime')recordCueOutcome(c,paired,reward);
    // This is an observed outcome in the care window, not proof of causation.
    tracker.results.push({id:pending.id,type:pending.type,startedAt:pending.startedAt,at:c.activeSeconds,
      status:paired?'recovered':reward<0?'uneasy':'unconfirmed',benefit:pending.benefit,text:description});
    if(tracker.results.length>8)tracker.results.splice(0,tracker.results.length-8);
    pending.finished=true;
  }
  tracker.pending=tracker.pending.filter(p=>!p.finished);
}
// Sample actual outcomes, not intended actions. No mutation of needs or motion.
export function observeCompanion(state,dt){
  const c=state.companion;if(!adopted(c)||state.paused||!(Number.isFinite(dt)&&dt>0))return;
  ensureDevelopment(c);c.activeSeconds+=dt;
  const growthStage=(c.growth?.progress??0)>=1?'mature':(c.growth?.progress??0)>=.08?'growing':null;
  if(growthStage)addMilestone(c,{id:`growth-${growthStage}`,kind:'growth',target:growthStage,text:growthStage==='mature'?'经过实际进食、休息和相处，身体已经长到成熟体型。':'身形已经明显长大，进入慢慢成长的阶段。'});
  const tracker=trackerFor(state);
  tracker.elapsed+=dt;if(tracker.elapsed<1)return;
  const elapsed=tracker.elapsed;tracker.elapsed=0;
  const decay=Math.exp(-elapsed/(2*3600));
  for(const values of Object.values(c.learning))for(const value of Object.values(values))value.score*=decay;
  const l=state.living,a=state.actor,n=state.needs,p=l.physiology,previous=tracker.previous;
  if(l.escape.phase==='burst'&&tracker.escape!=='burst'&&MEMORY_LABELS.place[a.zoneId])rememberOutcome(c,'place',a.zoneId,-.9,`曾在${MEMORY_LABELS.place[a.zoneId]}受困，正在寻找安全空隙。`);
  tracker.escape=l.escape.phase;
  const gain=n.satiety-previous.satiety,eating=a.consumingResource?.kind==='food'&&gain>0;
  const sameGame=previous.gamePhase==='playing'&&previous.gameId===l.workstation.gameId;
  const playedDelta=sameGame&&l.workstation.elapsed>=previous.gameElapsed?l.workstation.elapsed-previous.gameElapsed:l.workstation.elapsed;
  const playing=l.workstation.phase==='playing'&&a.contact&&playedDelta>0&&l.workstation.feedback>0;
  const resting=l.sleep.active||l.behavior==='rest';
  const outcome={food:eating?Math.max(0,gain):0,water:a.consumingResource?.kind==='water'?Math.max(0,previous.thirst-p.thirst)*50:0,
    rest:resting?Math.max(0,n.energy-previous.energy):0,clean:['groom','bathe','perch','idle-groom'].includes(l.behavior)?Math.max(0,previous.dirt-p.dirt)*50:0,
    dry:a.contact?Math.max(0,previous.wetness-l.wetness)*10:0,comfort:a.contact?Math.max(0,n.comfort-previous.comfort):0,
    play:playing?Math.max(0,l.workstation.feedback)*elapsed*.08:0};
  sampleInteractions(state,tracker,elapsed,outcome);sampleSounds(state,tracker,elapsed);
  if(l.workstation.phase!=='playing'||l.workstation.gameId!=='racer')tracker.toyActive=false;
  if(playing&&l.workstation.gameId==='racer'){practiceToy(c,Math.min(elapsed,playedDelta),{newSession:!tracker.toyActive});tracker.toyActive=true;}
  let kind=null,target=null,reward=0;
  if(eating){
    kind='food';target=a.consumingResource.id;
    const freshness=l.care?.maintenance?.foodFresh??1;
    const taste=.88+(hashSeed(c.identity.seed+':taste:'+target)%1000)/1000*.12;
    reward=clamp(gain/elapsed/.65*(.25+freshness*.55+n.comfort/100*.2)*taste-(1-freshness)*.75-(previous.satiety>95?.15:0),-1,1);
  }else if(playing){kind='game';target=l.workstation.gameId;reward=.2+l.workstation.feedback*.5-l.alert;}
  else if(a.contact&&l.escape.phase==='calm'&&MEMORY_LABELS.place[a.zoneId]){kind='place';target=a.zoneId;reward=.2+n.comfort/100*.3+(n.comfort-previous.comfort)/elapsed*.3-l.alert;}
  if(tracker.session&&(tracker.session.kind!==kind||tracker.session.target!==target||tracker.session.duration>=45)){flush(c,tracker.session);tracker.session=null;}
  if(kind&&Object.hasOwn(MEMORY_LABELS[kind],target)){
    const session=tracker.session??={kind,target,duration:0,reward:0,gain:0};
    session.duration+=elapsed;session.reward+=clamp(reward,-1,1)*elapsed;session.gain+=Math.max(0,gain);
  }
  tracker.previous=bodySample(state);
}
export function flushCompanion(state){
  const tracker=sessions.get(state);if(tracker?.session){flush(state.companion,tracker.session);tracker.session=null;}
  if(tracker)for(const [key,sample] of tracker.sounds){recordHabit(state.companion,'sound',key,sample.reward/Math.max(1,sample.duration),{duration:sample.duration});tracker.sounds.delete(key);}
}
export function signalPreference(state,source){
  const c=state.companion;if(!adopted(c)||learningUrgent(state))return 1;
  const food=source.resourceKind==='food'?(c.learning.food[source.resourceId]?.score??0)*.6+stablePreference(c,'food',source.resourceId)*.3:0;
  const place=(c.learning.place[source.zone]?.score??0)*.25+stablePreference(c,'place',source.zone)*.3;
  const disposition=source.kind==='space'?(c.temperament.curiosity-.5)*.35:source.kind==='shelter'?(c.temperament.caution-.5)*.35:0;
  const weather=source.zone==='garden'?stablePreference(c,'sound',`rain:${soundContext(state)}`)*(state.living.care?.rain??0)*.12:0;
  return clamp(1+food+place+disposition+weather,.65,1.85);
}
export function activityPreference(state,action){
  const c=state.companion;if(!adopted(c)||learningUrgent(state)||!['explore','play','observe'].includes(action))return 1;
  const bias=action==='play'?Math.max(0,...Object.values(c.learning.game).map(v=>v.score))*.2+Math.max(0,...Object.keys(MEMORY_LABELS.game).map(id=>stablePreference(c,'game',id)))*.2:0;
  return clamp(1+(c.temperament.curiosity-.5)*.5+bias,.8,1.45);
}
export function chooseLearnedGame(state,choices,decision){
  if(!choices.length)return null;
  const c=state.companion;if(!adopted(c)||learningUrgent(state))return choices[Math.abs(decision)%choices.length];
  const random=seededRandom(hashSeed(c.identity.seed+':game:'+decision));
  const weights=choices.map(id=>Math.max(.3,1+(c.learning.game[id]?.score??0)*.75+stablePreference(c,'game',id)*.6+(id==='racer'?toySkill(state,id)*.25:0)));
  let vote=random()*weights.reduce((sum,value)=>sum+value,0);
  for(let i=0;i<choices.length;i++){vote-=weights[i];if(vote<=0)return choices[i];}
  return choices.at(-1);
}
export function rememberInteraction(state,type){
  const c=state.companion;if(!adopted(c)||state.paused)return;
  type=({'replace-food':'feed','replace-water':'water',food:'feed'})[type]??type;
  if(!Object.hasOwn(MEMORY_LABELS.interaction,type)||type==='talk')return;
  const tracker=trackerFor(state);
  if(tracker.pending.some(p=>p.type===type)||tracker.pending.length>=4)return;
  tracker.pending.push({id:`${c.identity.id}:${c.activeSeconds.toFixed(3)}:${++tracker.sequence}`,type,startedAt:c.activeSeconds,age:0,benefit:0,calmSeconds:0,stressSeconds:0});
}
// Pending observations deliberately end when this runtime closes; they are not
// restored as completed events. Completed impressions remain in saved memories.
export function interactionSummary(state){
  const tracker=sessions.get(state);
  return {pending:tracker?.pending.map(p=>({id:p.id,type:p.type,startedAt:p.startedAt,elapsed:p.age}))??[],results:structuredClone(tracker?.results??[])};
}
export function soundSensitivity(state,type){
  const c=state.companion;if(!adopted(c)||!['rain','wind','footstep','chime'].includes(type))return 1;
  const familiarity=stablePreference(c,'sound',`${type}:${soundContext(state)}`);
  return clamp(1-familiarity*.35,.65,1.3);
}
export function interactionSensitivity(state,type){
  const c=state.companion;if(!adopted(c)||type!=='chime')return 1;
  const preference=c.learning.interaction.chime?.score??0,relationship=c.development?.relationship.familiarity??0;
  return clamp((1+(c.temperament.caution-.5)*.3-(c.temperament.sociability-.5)*.3-preference*.25-relationship*.12)*soundSensitivity(state,type),.55,1.35);
}
export function cueResponse(state){
  const c=state.companion,focus=state.living.focus?.action;
  if(!adopted(c)||state.paused||learningUrgent(state)||focus&&focus!=='explore'||['eat','drink','rest','toilet','play'].includes(state.living.behavior))return 0;
  const cue=c.development?.cues.chime;
  if(!cue||cue.paired<3||cue.association<.25||!trackerFor(state).pending.some(p=>p.type==='chime'&&p.age<20))return 0;
  return clamp(cue.association,0,.8);
}
export function cuePreference(state,source){return source.id==='bell'?1+cueResponse(state)*.3:1;}
export function toySkill(state,gameId='racer'){return adopted(state.companion)&&gameId==='racer'?state.companion.development?.toy.skill??0:0;}
