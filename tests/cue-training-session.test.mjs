import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {withFoodStock} from '../public/food-stock.mjs';
import {resourceContact} from '../public/resource-contact.mjs';
import {supportedFeet} from '../public/collision-world.mjs';

const imported=await import('../src/cue-training-session.mjs').catch(()=>null);
function create(options){
  assert.equal(typeof imported?.CueTrainingSession,'function','isolated player training session is missing');
  return new imported.CueTrainingSession(options);
}
function physical(snapshot){
  return {position:snapshot.actor.position,velocity:snapshot.actor.velocity,heading:snapshot.actor.heading,
    needs:snapshot.needs,simSeconds:snapshot.simSeconds,motor:snapshot.neural.motor};
}
function inventory(snapshot){return structuredClone(snapshot.living.care.foods);}
function until(session,predicate,maxSeconds){
  for(let t=0;t<maxSeconds&&!predicate(session.snapshot());t+=.25)session.tick(.25);
  return session.snapshot();
}

test('new lab starts at one true supported release without food contact or existing memories',()=>{
  const session=create(),s=session.snapshot();
  assert.equal(s.experiment.phase,'training');assert.equal(s.experiment.emission,'off');
  assert.equal(s.experiment.canProbe,false);assert.equal(s.needs.satiety,25);
  assert.equal(s.clock.hour,12);assert.equal(s.experiment.learning.changedSynapses,0);
  assert.equal(s.actor.contact,true);
  assert.equal(withFoodStock(s,()=>supportedFeet(s.actor.position,s.actor.heading,s.actor)),6);
  assert.equal(withFoodStock(s,()=>resourceContact(s.actor,'food')),null);
  assert.ok(Object.values(inventory(s)).every(amount=>amount===100));
  assert.equal(s.companion.identity.adoptedAt,2000);
  session.dispose();
});

test('fixed integer seed reproduces the initial body and personality but each experiment has a fresh identity',()=>{
  const a=create({seed:8401}),b=create({seed:8401}),sa=a.snapshot(),sb=b.snapshot();
  assert.deepEqual(physical(sa),physical(sb));assert.deepEqual(sa.companion.temperament,sb.companion.temperament);
  assert.equal(sa.companion.identity.seed,sb.companion.identity.seed);
  assert.notEqual(sa.experiment.id,sb.experiment.id);assert.notEqual(sa.companion.identity.id,sb.companion.identity.id);
  for(const seed of [-1,1.1,NaN,Infinity,'8401',2**32])assert.throws(()=>create({seed}));
  a.dispose();b.dispose();
});

test('player emission changes stimuli without granting reward, moving the fly or changing q',()=>{
  const session=create(),before=session.snapshot(),memory=session.exportMemory();
  for(const odor of ['A','B','off']){
    const s=session.command('emit',odor);
    assert.equal(s.experiment.emission,odor);assert.deepEqual(physical(s),physical(before));
    assert.deepEqual(session.exportMemory(),memory);assert.equal(s.experiment.teachingEvents,0);
    assert.equal(s.experiment.learning.rewardPulses,0);
    assert.equal(s.experiment.learning.cues.length,odor==='off'?0:1);
    assert.equal(s.experiment.canProbe,false);
  }
  session.dispose();
});

test('invalid commands and ticks reject before changing phase, cues, body, inventory or weights',()=>{
  const session=create();session.command('emit','A');
  const before=session.snapshot(),memory=session.exportMemory();
  for(const [type,value]of [['emit','C'],['emit',{odor:'A'}],['pause','true'],['probe',true],
    ['probe',undefined],['swap',undefined],['reset',undefined],['reset',{newExperiment:false}],['teleport',[1,2,3]]]){
    assert.throws(()=>session.command(type,value));
    const after=session.snapshot();assert.deepEqual(physical(after),physical(before));
    assert.deepEqual(inventory(after),inventory(before));assert.equal(after.experiment.phase,before.experiment.phase);
    assert.equal(after.experiment.emission,before.experiment.emission);assert.deepEqual(session.exportMemory(),memory);
  }
  for(const dt of [-1,.251,NaN,Infinity,'0.02'])assert.throws(()=>session.tick(dt));
  session.dispose();
});

test('pause stops physical and session time while zero time is harmless',()=>{
  const session=create();session.command('pause',true);const before=session.snapshot();
  session.tick(.25);session.tick(0);assert.deepEqual(physical(session.snapshot()),physical(before));
  assert.equal(session.snapshot().experiment.paused,true);
  session.command('pause',false);session.tick(.02);
  assert.ok(session.snapshot().simSeconds>before.simSeconds);session.dispose();
});

test('natural food consumption gates teaching and the full reversible player probe lifecycle',()=>{
  const session=create();
  let s=until(session,snapshot=>snapshot.stats.ateSeconds>0,60);
  assert.ok(s.stats.ateSeconds>0,'original brain must actually find and eat food without pose intervention');
  assert.equal(s.experiment.canProbe,false,'food while cue is off is not A/B training');
  assert.equal(s.experiment.teachingEvents,0);assert.throws(()=>session.command('probe'));
  session.command('emit','A');s=until(session,snapshot=>snapshot.experiment.canProbe,20);
  assert.equal(s.experiment.canProbe,true,'real consumption with emitted cue and changed q must enable probe');
  assert.ok(s.experiment.cueTraining.A.consumedAmount>0);
  assert.ok(s.experiment.cueTraining.A.teachingEvents>0);assert.ok(s.experiment.cueTraining.A.changedSynapses>0);
  const before=s,memory=session.exportMemory(),food=inventory(s),ate=s.stats.ateSeconds,rewards=s.experiment.learning.rewardPulses;
  s=session.command('probe');
  assert.equal(s.experiment.phase,'probing');assert.deepEqual(physical(s),physical(before));
  assert.ok(Object.values(inventory(s)).every(amount=>amount===0));
  assert.equal(s.experiment.learning.frozen,true);assert.equal(s.experiment.learning.rewardEnabled,false);
  assert.equal(s.experiment.probe.elapsed,0);assert.equal(s.experiment.probe.remaining,20);
  assert.deepEqual(s.experiment.probe.inventoryBefore,food);
  assert.deepEqual(session.exportMemory(),memory);assert.throws(()=>session.command('probe'));
  assert.throws(()=>session.command('swap'));assert.throws(()=>session.command('emit','B'));
  session.command('pause',true);session.tick(.25);assert.equal(session.snapshot().experiment.probe.elapsed,0);
  session.command('pause',false);
  for(let t=0;t<20;t+=.25)session.tick(.25);
  s=session.snapshot();assert.equal(s.experiment.phase,'result');
  assert.equal(s.experiment.probe.result.completed,true);assert.equal(s.experiment.probe.result.aborted,false);
  assert.ok(Math.abs(s.experiment.probe.elapsed-20)<1e-8);assert.equal(s.experiment.probe.remaining,0);
  assert.deepEqual(inventory(s),food);assert.equal(s.experiment.learning.frozen,false);
  assert.equal(s.experiment.learning.rewardEnabled,true);assert.deepEqual(session.exportMemory(),memory);
  assert.equal(s.stats.ateSeconds,ate);assert.equal(s.experiment.learning.rewardPulses,rewards);
  assert.ok(Number.isFinite(s.experiment.probe.result.preferenceIndex));
  assert.ok(s.experiment.probe.result.trace.length>=21);assert.equal(s.experiment.probe.result.inventoryRestored,true);
  const endBody=physical(s);s=session.command('swap');assert.equal(s.experiment.phase,'probing');
  assert.deepEqual(s.experiment.probe.mapping,{left:'B',right:'A'});assert.deepEqual(physical(s),endBody);
  session.tick(.25);s=session.command('endProbe');assert.equal(s.experiment.probe.result.aborted,true);
  assert.equal(s.experiment.probe.result.reason,'ended');assert.deepEqual(inventory(s),food);
  assert.deepEqual(session.exportMemory(),memory);
  session.command('probe');session.tick(.25);const priorDispose=physical(session.snapshot());
  s=session.dispose();assert.equal(s.experiment.phase,'disposed');assert.deepEqual(inventory(s),food);
  assert.deepEqual(physical(s),priorDispose);assert.deepEqual(session.exportMemory(),memory);
  const id=s.experiment.id;assert.equal(session.dispose().experiment.id,id);
  session.tick(.25);assert.deepEqual(physical(session.snapshot()),priorDispose);
  assert.throws(()=>session.command('emit','A'));
});

test('reset explicitly creates a new experiment rather than a disguised training action',()=>{
  const session=create(),before=session.snapshot();session.command('emit','A');
  const after=session.command('reset',{newExperiment:true});
  assert.notEqual(after.experiment.id,before.experiment.id);assert.equal(after.experiment.phase,'training');
  assert.equal(after.experiment.emission,'off');assert.equal(after.experiment.learning.changedSynapses,0);
  assert.equal(after.experiment.actualFeedingSeconds,0);assert.equal(after.experiment.canProbe,false);
  assert.deepEqual(after.actor.position,before.actor.position);session.dispose();
});

test('an internal runtime error disposes the isolated session without leaving a probe food mask',()=>{
  const session=create();session.command('emit','A');
  const trained=until(session,snapshot=>snapshot.experiment.canProbe,60);
  assert.equal(trained.experiment.canProbe,true);
  const food=inventory(trained),memory=session.exportMemory();
  session.command('probe');session.tick(.25);
  const before=physical(session.snapshot()),originalTick=EmbodiedLife.prototype.tick;
  try{
    EmbodiedLife.prototype.tick=function(){throw Error('injected runtime failure');};
    assert.throws(()=>session.tick(.02),/injected runtime failure/);
  }finally{EmbodiedLife.prototype.tick=originalTick;}
  const after=session.snapshot();assert.equal(after.experiment.phase,'disposed');
  assert.deepEqual(inventory(after),food);assert.equal(after.experiment.emission,'off');
  assert.deepEqual(physical(after),before);assert.deepEqual(session.exportMemory(),memory);
  assert.equal(after.experiment.probe.result.reason,'error');
  assert.equal(after.experiment.probe.result.aborted,true);
  assert.equal(after.experiment.probe.result.inventoryRestored,true);
  assert.equal(after.experiment.learning.frozen,false);assert.equal(after.experiment.learning.rewardEnabled,true);
});
