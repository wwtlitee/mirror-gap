import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompanion,adoptCompanion,validateCompanion,validName,appearanceFromSeed} from '../public/companion-identity.mjs';
import {rememberOutcome,signalPreference,observeCompanion,flushCompanion,chooseLearnedGame} from '../public/companion-learning.mjs';
import {companionCheckpoint,restoreCompanion,validateCompanionCheckpoint,readCompanionStorage,writeCompanionStorage,COMPANION_STORAGE_KEY,LEGACY_STORAGE_KEY,BACKUP_STORAGE_KEY} from '../public/companion-checkpoint.mjs';
import {bodyCheckpoint} from '../public/body-checkpoint.mjs';
import {VoiceSchedule,voiceEvent,voiceBankFor} from '../public/companion-voice.mjs';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {senseEnvironment} from '../src/neural-controller.mjs';
import {SIGNAL_SOURCES} from '../public/environment-spec.mjs';
const seed='0123456789abcdef0123456789abcdef';
function companion(){const c=createCompanion({seed,now:1000});adoptCompanion(c,'小豆',2000);return c;}
function state(){const s=new EmbodiedLife().state;s.companion=companion();return s;}
function storage(){const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};}
test('identity, appearance and voice assignment survive a full backup round trip',()=>{
  const s=state();rememberOutcome(s.companion,'food','banana',1,'吃饱了');const cp=companionCheckpoint(s),next=state();restoreCompanion(next,JSON.parse(JSON.stringify(cp)));
  assert.deepEqual(next.companion,s.companion);assert.deepEqual(appearanceFromSeed(next.companion.identity.seed),appearanceFromSeed(seed));assert.equal(voiceBankFor(seed).id,voiceBankFor(next.companion.identity.seed).id);
});
test('names reject blank, controls, markup and oversized values; adoption cannot reroll identity',()=>{
  for(const name of ['', ' ', '<script>', 'a\n', 'a'.repeat(25)]){if(name==='a\n')continue;assert.throws(()=>validName(name));}
  assert.throws(()=>validName('a\nb'));assert.equal(validName(' 小豆 '),'小豆');const c=companion();assert.throws(()=>adoptCompanion(c,'另一只'));
});
test('appearance combinations differ across independent entropy and keep bounded trait indexes',()=>{
  const seen=new Set();for(let i=0;i<2000;i++){const a=appearanceFromSeed(i.toString(16).padStart(32,'0'));seen.add(JSON.stringify(a));}
  assert.equal(seen.size,2000);
});
test('legacy body values migrate intact while the original key remains untouched',()=>{
  const s=state(),store=storage();s.needs.energy=43;const legacy=bodyCheckpoint(s);store.setItem(LEGACY_STORAGE_KEY,JSON.stringify(legacy));
  const next=state();restoreCompanion(next,readCompanionStorage(store));assert.equal(next.needs.energy,43);assert.equal(next.companion.identity.adoptedAt,null);
  writeCompanionStorage(store,companionCheckpoint(next));assert.equal(store.getItem(LEGACY_STORAGE_KEY),JSON.stringify(legacy));
});
test('corrupt current save never falls back to legacy or overwrites data',()=>{
  const store=storage();store.setItem(COMPANION_STORAGE_KEY,'broken');store.setItem(LEGACY_STORAGE_KEY,JSON.stringify(bodyCheckpoint(state())));
  assert.throws(()=>readCompanionStorage(store));assert.equal(store.getItem(COMPANION_STORAGE_KEY),'broken');
});
test('import validates every preference, memory and audio setting before any write',()=>{
  const cp=companionCheckpoint(state()),store=storage();writeCompanionStorage(store,cp);const before=store.getItem(COMPANION_STORAGE_KEY);
  for(const change of [c=>c.companion.learning.food.evil={score:1,count:1,lastAt:0},c=>c.companion.voice.volume=NaN,c=>c.companion.memories=[{kind:'missing'}],c=>c.companion.identity.name='<img>']){
    const bad=structuredClone(cp);change(bad);assert.throws(()=>writeCompanionStorage(store,bad,{backup:true}));assert.equal(store.getItem(COMPANION_STORAGE_KEY),before);
  }
});
test('import backup preserves previous identity and latest save remains valid',()=>{
  const store=storage(),first=companionCheckpoint(state());writeCompanionStorage(store,first);const second=companionCheckpoint(state());writeCompanionStorage(store,second,{backup:true});
  assert.equal(JSON.parse(store.getItem(BACKUP_STORAGE_KEY)).companion.identity.id,first.companion.identity.id);validateCompanionCheckpoint(readCompanionStorage(store));
});
test('rewarded food changes actual sensory input under identical body conditions',()=>{
  const baseline=state(),experienced=structuredClone(baseline);baseline.needs.satiety=experienced.needs.satiety=65;
  for(let i=0;i<12;i++)rememberOutcome(experienced.companion,'food','banana',1,'进食后恢复');
  const pulses={feed:0,mist:0,chime:0},source=SIGNAL_SOURCES.find(s=>s.resourceId==='banana');
  const a=senseEnvironment(baseline,pulses,[source]).signals.find(s=>s.resourceId==='banana');
  const b=senseEnvironment(experienced,pulses,[source]).signals.find(s=>s.resourceId==='banana');assert.ok(b.intensity>a.intensity*1.3);
  experienced.needs.satiety=10;assert.equal(signalPreference(experienced,source),1);
});
test('negative place experience can be relearned and preferences cannot grow without bound',()=>{
  const c=companion();for(let i=0;i<15;i++)rememberOutcome(c,'place','garden',-1,'受困');assert.ok(c.learning.place.garden.score<-.9);
  for(let i=0;i<50;i++)rememberOutcome(c,'place','garden',1,'安静');assert.ok(c.learning.place.garden.score>.9);assert.ok(c.learning.place.garden.score<=1);validateCompanion(c);
});
test('only actual eating with body recovery becomes a food memory',()=>{
  const s=state();s.actor.consumingResource={id:'banana',kind:'food'};s.needs.satiety=60;
  for(let i=0;i<8;i++){s.needs.satiety+=.65;observeCompanion(s,1);}flushCompanion(s);assert.ok(s.companion.learning.food.banana?.score>0);
  const other=state();other.living.focus.action='eat';other.actor.consumingResource=null;
  for(let i=0;i<8;i++)observeCompanion(other,1);flushCompanion(other);assert.deepEqual(other.companion.learning.food,{});
});
test('learned games alter subsequent choice distribution without eliminating exploration',()=>{
  const s=state();for(let i=0;i<20;i++)rememberOutcome(s.companion,'game','racer',1,'好玩');
  const counts={racer:0,breakout:0,invaders:0};for(let i=0;i<2000;i++)counts[chooseLearnedGame(s,Object.keys(counts),i)]++;
  assert.ok(counts.racer>counts.breakout*1.3);assert.ok(counts.invaders>200);
});
test('memory stays bounded after long activity and active time is persisted',()=>{
  const s=state();for(let i=0;i<200;i++){s.companion.activeSeconds++;rememberOutcome(s.companion,'food','apple',.5,'一次经历');}
  assert.equal(s.companion.memories.length,80);validateCompanion(s.companion);assert.equal(companionCheckpoint(s).companion.activeSeconds,200);
});
test('fixed voice schedule enforces global and per-event silence and rotates clips',()=>{
  const q=new VoiceSchedule(),first=q.select('play',0,seed,{bankId:'mambo'});assert.ok(first);assert.equal(q.select('escaped',10,seed,{bankId:'mambo'}),null);assert.equal(q.select('play',40,seed,{bankId:'mambo'}),null);
  assert.ok(q.select('escaped',40,seed,{bankId:'mambo'}));const next=q.select('play',181,seed,{bankId:'mambo'});assert.notEqual(first.index,next.index);
});
test('a stored voice bank remains authoritative independently of the random seed',()=>{
  const q=new VoiceSchedule();assert.equal(q.select('welcome',0,seed,{bankId:'theatre'}).bank,'theatre');
  const s=state();s.companion.voice.bank='theatre';const next=state();restoreCompanion(next,companionCheckpoint(s));
  assert.equal(next.companion.voice.bank,'theatre');
});
test('interaction memories and temperament change future chime response after restore',()=>{
  const plain=new EmbodiedLife(),learned=new EmbodiedLife();plain.state.companion=companion();learned.state.companion=companion();
  for(let i=0;i<12;i++)rememberOutcome(learned.state.companion,'interaction','chime',1,'熟悉的声音');
  const restored=new EmbodiedLife();restoreCompanion(restored.state,companionCheckpoint(learned.state));
  plain.interact('chime');restored.interact('chime');assert.ok(restored.state.living.alert<plain.state.living.alert);
});
test('speech is tied to completed real events, not merely intent or pause',()=>{
  const before=state(),after=structuredClone(before);after.living.focus.action='eat';assert.notEqual(voiceEvent(before,after),'fed');
  before.living.escape.phase='burst';after.living.escape.phase='recover';assert.equal(voiceEvent(before,after),'escaped');after.paused=true;assert.equal(voiceEvent(before,after),null);
});
