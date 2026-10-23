import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompanion,adoptCompanion,validateCompanion,companionSummary} from '../public/companion-identity.mjs';
import {observeCompanion,flushCompanion,rememberInteraction,rememberOutcome,signalPreference,activityPreference,soundSensitivity,cueResponse,toySkill} from '../public/companion-learning.mjs';
import {recordHabit,stablePreference,addMilestone,MAX_MILESTONES} from '../public/companion-development.mjs';
const seed='0123456789abcdef0123456789abcdef';
function makeState(){
  const c=createCompanion({seed,now:1000});adoptCompanion(c,'小豆',2000);
  return {companion:c,paused:false,simSeconds:0,needs:{satiety:65,comfort:90,energy:85,curiosity:50},actor:{contact:false,zoneId:'garden',position:[0,1,0],consumingResource:null},
    living:{alert:0,wetness:0,behavior:'flight',focus:{action:null},escape:{phase:'calm'},sleep:{active:false},physiology:{thirst:.2,sleepPressure:.2,waste:.2,dirt:.1},
      care:{rain:0,wind:0,footstep:0,weakness:0,maintenance:{foodFresh:1}},workstation:{phase:'idle',gameId:'racer',elapsed:0,feedback:0}}};
}
function tick(state,seconds,update=()=>{}){for(let i=0;i<seconds;i++){update(state,i);state.simSeconds++;observeCompanion(state,1);}}
function meal(state,id='banana',seconds=12){state.needs.satiety=60;state.actor.consumingResource={kind:'food',id};tick(state,seconds,s=>{s.needs.satiety+=.65;});state.actor.consumingResource=null;flushCompanion(state);}
function trainFood(state,id='banana',episodes=5){for(let i=0;i<episodes;i++){meal(state,id);tick(state,125);}}
test('durable preferences require spaced actual meals, survive restore, and preserve short-term impressions',()=>{
  const trained=makeState(),plain=makeState(),rushed=makeState();
  trainFood(trained);for(let i=0;i<5;i++)meal(rushed);
  assert.ok(stablePreference(trained.companion,'food','banana')>.2);
  assert.equal(stablePreference(rushed.companion,'food','banana'),0);
  const source={resourceKind:'food',resourceId:'banana',zone:'feed'};
  // Remove recent impressions to isolate the lasting habit from ordinary learning.
  trained.companion.learning.food={};
  assert.ok(signalPreference(trained,source)>signalPreference(plain,source)+.06);
  const restored=makeState();restored.companion=validateCompanion(JSON.parse(JSON.stringify(trained.companion)));
  assert.equal(signalPreference(restored,source),signalPreference(trained,source));
  assert.deepEqual(companionSummary(restored.companion).developmentSummary,companionSummary(trained.companion).developmentSummary);
});
test('fresh versus stale food creates different learned preferences under identical position and nutrition',()=>{
  const fresh=makeState(),stale=makeState();stale.living.care.maintenance.foodFresh=0;
  trainFood(fresh,'apple');trainFood(stale,'apple');
  assert.ok(stablePreference(fresh.companion,'food','apple')>0);
  assert.ok(stablePreference(stale.companion,'food','apple')<0);
  assert.ok(signalPreference(fresh,{resourceKind:'food',resourceId:'apple',zone:'feed'})>signalPreference(stale,{resourceKind:'food',resourceId:'apple',zone:'feed'}));
});
test('a single opposite experience cannot flip a habit, but sustained new experience can revise it',()=>{
  const s=makeState();trainFood(s);
  const positive=stablePreference(s.companion,'food','banana');
  s.living.care.maintenance.foodFresh=0;meal(s);
  assert.ok(stablePreference(s.companion,'food','banana')>0);
  for(let i=0;i<16;i++){tick(s,125);meal(s);}
  assert.ok(stablePreference(s.companion,'food','banana')<0);assert.ok(positive>0);
  assert.ok(s.companion.development.milestones.some(m=>m.id==='habit-food-banana-negative'));
  validateCompanion(s.companion);
});
test('clicks and unpaired cues cannot create a positive relationship or conditioned response',()=>{
  const s=makeState();for(let i=0;i<1000;i++)rememberInteraction(s,'chime');
  assert.equal(s.companion.development.relationship.familiarity,0);assert.deepEqual(s.companion.learning.interaction,{});
  for(let i=0;i<6;i++){rememberInteraction(s,'chime');tick(s,95);meal(s);tick(s,125);}
  assert.equal(s.companion.development.relationship.familiarity,0);
  assert.equal(s.companion.development.cues.chime.paired,0);
  rememberInteraction(s,'chime');assert.equal(cueResponse(s),0);
});
test('paired real outcomes create familiarity and a bounded cue response without interrupting a need',()=>{
  const s=makeState();
  for(let i=0;i<7;i++){rememberInteraction(s,'chime');meal(s);tick(s,125);}
  assert.ok(s.companion.development.relationship.familiarity>.25);
  assert.ok(s.companion.development.cues.chime.association>.25);
  const restored=makeState();restored.companion=validateCompanion(JSON.parse(JSON.stringify(s.companion)));
  rememberInteraction(restored,'chime');assert.ok(cueResponse(restored)>0);
  const focus={action:'drink',target:'water'};restored.living.focus=focus;
  assert.equal(cueResponse(restored),0);assert.deepEqual(restored.living.focus,focus);
  restored.living.focus.action=null;restored.needs.satiety=10;
  assert.equal(cueResponse(restored),0);assert.equal(activityPreference(restored,'play'),1);
  assert.equal(signalPreference(restored,{resourceKind:'food',resourceId:'banana',zone:'feed'}),1);
});
test('sound learning remains specific to source and resting versus active context',()=>{
  const s=makeState();s.living.care.rain=.8;
  tick(s,800);flushCompanion(s);
  assert.ok(soundSensitivity(s,'rain')<1);
  assert.equal(soundSensitivity(s,'wind'),1);assert.equal(soundSensitivity(s,'footstep'),1);
  s.living.sleep.active=true;s.living.behavior='rest';assert.equal(soundSensitivity(s,'rain'),1);
  validateCompanion(s.companion);
});
test('racer skill needs actual contact and multiple game sessions, never intended play',()=>{
  const s=makeState(),floating=makeState(),gameOver=makeState();
  for(const state of [s,floating,gameOver]){
    tick(state,1);
    for(let i=0;i<6;i++){
      state.actor.contact=state!==floating;state.living.workstation.phase='playing';state.living.workstation.elapsed=0;state.living.workstation.feedback=state===gameOver?0:1;
      tick(state,82,x=>x.living.workstation.elapsed++);
      state.living.workstation.phase='idle';tick(state,125);
    }
  }
  assert.equal(toySkill(s),1);assert.equal(toySkill(floating),0);assert.equal(toySkill(gameOver),0);
  assert.equal(s.companion.development.toy.sessions,6);
  assert.ok(s.companion.development.milestones.some(m=>m.id==='toy-racer-practiced'));
  validateCompanion(s.companion);
});
test('important experiences are separate, unique and bounded despite ordinary log churn',()=>{
  const s=makeState();trainFood(s,'apple');const first=s.companion.development.milestones[0];
  for(let i=0;i<300;i++)rememberOutcome(s.companion,'place','garden',.2,'普通停留');
  assert.equal(s.companion.memories.length,80);assert.ok(s.companion.development.milestones.some(m=>m.id===first.id));
  assert.equal(addMilestone(s.companion,first),false);
  for(let i=0;i<200;i++)addMilestone(s.companion,{id:`event-${i}`,kind:'first',target:'apple',text:'有界经历'});
  assert.equal(s.companion.development.milestones.length,MAX_MILESTONES);validateCompanion(s.companion);
});
test('legacy saves keep identity and impressions without inventing growth or durable experiences',()=>{
  const c=makeState().companion;c.activeSeconds=8000;rememberOutcome(c,'food','apple',1,'旧经历');delete c.growth;delete c.development;
  const before=structuredClone(c);validateCompanion(c);
  assert.deepEqual(c.identity,before.identity);assert.deepEqual(c.voice,before.voice);assert.deepEqual(c.learning,before.learning);
  assert.equal(c.growth.startedAt,8000);assert.equal(c.growth.progress,0);assert.deepEqual(c.development.milestones,[]);
  assert.deepEqual(c.development.habits.food,{});
});
test('pause freezes learning and imported malformed development is rejected',()=>{
  const s=makeState();s.paused=true;rememberInteraction(s,'feed');tick(s,100);assert.equal(s.companion.activeSeconds,0);
  for(const change of [c=>c.development.habits.food.apple={score:1,count:5,firstAt:0,lastAt:0},c=>c.development.relationship.familiarity=NaN,c=>c.development.toy.skill=1,c=>c.development.cues.chime.paired=-1,c=>c.development.milestones=[{id:'x',kind:'unknown'}]]){
    const c=structuredClone(s.companion);change(c);assert.throws(()=>validateCompanion(c));
  }
  const c=s.companion;assert.equal(recordHabit(c,'food','apple',1,{duration:0}),false);
});
test('recent impressions fade while an established habit persists across active time',()=>{
  const s=makeState();trainFood(s);const short=s.companion.learning.food.banana.score,lasting=stablePreference(s.companion,'food','banana');
  tick(s,10800);assert.ok(s.companion.learning.food.banana.score<short*.25);assert.equal(stablePreference(s.companion,'food','banana'),lasting);validateCompanion(s.companion);
});
test('mature imports record the current stage without inventing a later growing event',()=>{
  const s=makeState();s.companion.activeSeconds=21600;s.companion.growth={format:1,startedAt:0,elapsed:21600,nutrition:180,rest:600,progress:1};
  tick(s,2);assert.deepEqual(s.companion.development.milestones.filter(m=>m.kind==='growth').map(m=>m.id),['growth-mature']);
  const restored=makeState();restored.companion=validateCompanion(JSON.parse(JSON.stringify(s.companion)));tick(restored,2);
  assert.equal(restored.companion.development.milestones.at(-1).id,'growth-mature');
});
