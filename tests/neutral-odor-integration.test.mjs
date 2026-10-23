import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {senseEnvironment} from '../src/neural-controller.mjs';
import {updateNavigation} from '../public/navigation-attention.mjs';
import {createCompanion} from '../public/companion-identity.mjs';
import {createCare} from '../public/pet-care.mjs';
import {FOOD_IDS,syncFoodTotal} from '../public/food-stock.mjs';
import {companionCheckpoint,restoreCompanion} from '../public/companion-checkpoint.mjs';

const pulses={feed:0,mist:0,chime:0};
const cues=[{id:'cue-A',odor:'A',position:[-1,2,0],strength:1,range:1,enabled:true},
  {id:'cue-B',odor:'B',position:[1,2,0],strength:1,range:1,enabled:true}];
function resident(options={}){
  const sim=new EmbodiedLife(null,options),s=sim.state;
  Object.assign(s.actor,{position:[0,2,0],velocity:[0,0,0],heading:0,contact:false,zoneId:'flight'});
  s.needs.satiety=25;s.living.physiology.thirst=.1;s.living.focus.action='eat';
  s.living.clock={mode:'preview',hour:12,anchor:s.simSeconds};
  return sim;
}
function neutral(sim){
  assert.equal(typeof sim.neural.learning?.setCues,'function','default controller needs independent neutral cues');
  return sim.neural.learning;
}
function emptyFoods(s){
  s.companion=createCompanion({id:'11111111-1111-4111-8111-111111111111',seed:'0123456789abcdef0123456789abcdef',now:1000});
  s.living.care=createCare();s.living.care.foods=Object.fromEntries(FOOD_IDS.map(id=>[id,0]));syncFoodTotal(s);
}

test('default restores original food navigation while using one neutral weight owner',()=>{
  const sim=resident(),s=sim.state;
  assert.equal(s.synapticForaging,false,'default must not disable the original hungry food route');
  assert.equal(sim.neural.learning,sim.neural.neutralLearning);
  assert.equal(sim.neural.learning.constructor.name,'NeutralOdorLearning');
  const source={id:'resource-burger',resourceId:'burger',resourceKind:'food',kind:'odor',zone:'feed',
    intensity:5,regionalNeed:.75,distance:Math.SQRT1_2,position:[.5,2,.5]};
  updateNavigation(s,[source],1);
  assert.equal(s.living.navigation.targetId,source.id);
  assert.equal(s.living.navigation.route?.status,'ready');
});

test('default sensation is the original hungry food sensation when no neutral cues exist',()=>{
  const sim=resident(),s=sim.state;
  const expected=senseEnvironment(s,pulses,undefined,{feedbackSeconds:1,landingSearchCache:sim.neural.landingSearchCache});
  sim.neural.advanceSlice(s,80,1);
  assert.deepEqual(sim.neural.sensory.inputs.slice(0,4),expected.inputs);
  assert.equal(sim.neural.sensory.context.synapticFood,false);
});

test('legacy food learning is an explicit reproducible mode',()=>{
  const sim=resident({learningMode:'legacy-food'});
  assert.equal(sim.state.synapticForaging,true);
  assert.equal(sim.neural.learning.constructor.name,'OdorLearning');
  assert.equal(sim.neural.neutralLearning,null);
});

test('neutral A and B carry no food resource meaning and cannot become route targets',()=>{
  const sim=resident(),learner=neutral(sim);emptyFoods(sim.state);learner.setCues(cues);
  const signals=learner.sense(sim.state);
  assert.equal(signals.length,2);
  for(const signal of signals){
    assert.equal(signal.kind,'neutral-odor');
    assert.equal(Object.hasOwn(signal,'resourceKind'),false);
    assert.equal(Object.hasOwn(signal,'resourceId'),false);
    assert.equal(signal.neuralValence,0,'untrained cue must be behaviorally neutral');
  }
  updateNavigation(sim.state,signals,1);
  assert.equal(sim.state.living.navigation.targetId,null);
  assert.equal(sim.state.living.navigation.route,null);
  const before=senseEnvironment(sim.state,pulses,[]);
  const after=senseEnvironment(sim.state,pulses,[],{neutralOdors:signals});
  assert.deepEqual(after.inputs,before.inputs);
  assert.equal(after.signals.filter(signal=>signal.kind==='neutral-odor').length,2);
});

test('learned neutral valence changes sensation only where no original goal route owns direction',()=>{
  const sim=resident(),s=sim.state;
  const learned=[{id:'cue-A',odor:'A',kind:'neutral-odor',position:[1,2,0],distance:1,intensity:1,neuralValence:1}];
  const before=senseEnvironment(s,pulses,[]),after=senseEnvironment(s,pulses,[],{neutralOdors:learned});
  assert.notDeepEqual(after.inputs,before.inputs,'learned cue must reach original neural input');
  s.living.navigation.targetId='resource-burger';
  s.living.navigation.route={status:'ready',targetId:'resource-burger',direction:[0,0,1],
    waypoints:[[0,2,1]],index:0,remainingDistance:1};
  const routed=senseEnvironment(s,pulses,[]),withCue=senseEnvironment(s,pulses,[],{neutralOdors:learned});
  assert.deepEqual(withCue.inputs,routed.inputs,'original route must retain priority over an optional cue');
});

test('empty food and a visible neutral cue cannot generate reward or change weights',()=>{
  const sim=resident(),learner=neutral(sim);emptyFoods(sim.state);learner.setCues(cues);
  const weights=learner.serializeWeights();
  for(let i=0;i<100;i++)sim.tick(.02);
  assert.equal(sim.neural.error,null);
  assert.equal(sim.state.stats.ateSeconds,0);
  assert.equal(learner.snapshot().rewardPulses,0);
  assert.equal(learner.snapshot().consumedAmount,0);
  assert.deepEqual(learner.serializeWeights(),weights);
});

test('disconnecting the original brain prevents learned neutral cues from moving the body',()=>{
  const sim=resident(),learner=neutral(sim);emptyFoods(sim.state);learner.setCues(cues.slice(0,1));
  const weights=learner.serializeWeights();weights.efficacy.fill(.05);learner.restoreWeights(weights);
  learner.frozen=true;learner.rewardEnabled=false;sim.neural.brain.disconnect();
  assert.ok(learner.sense(sim.state)[0].neuralValence>0);
  for(let i=0;i<100;i++)sim.tick(.02);
  assert.equal(sim.neural.error,null);assert.deepEqual(sim.neural.motor.local,[0,0,0]);
  assert.equal(sim.neural.motor.drive,0);
  assert.equal(sim.state.actor.position[0],0);assert.equal(sim.state.actor.position[2],0);
});

test('946 learned weights survive full and browser saves without making a second circuit',()=>{
  const sim=resident(),learner=neutral(sim);emptyFoods(sim.state);
  const weights=learner.serializeWeights();weights.efficacy.fill(.5);learner.restoreWeights(weights);
  const saved=sim.serialize(),restored=new EmbodiedLife(saved);
  assert.deepEqual(restored.neural.learning.serializeWeights(),weights);
  assert.equal(restored.neural.learning,restored.neural.neutralLearning);
  assert.equal(saved.neural.synapticMemory,undefined);
  const backup=companionCheckpoint(sim.state),fresh=resident();
  restoreCompanion(fresh.state,backup);fresh.neural.learning.restoreWeights(fresh.state.synapticMemory);
  assert.deepEqual(fresh.neural.learning.serializeWeights(),weights);
});

test('memory mode persists through full and individual saves without changing old food semantics',()=>{
  const sim=resident({learningMode:'legacy-food'});emptyFoods(sim.state);
  const weights=sim.neural.learning.serializeWeights();weights.efficacy.fill(.5);sim.neural.learning.restoreWeights(weights);
  const full=sim.serialize();assert.equal(full.synapticMemoryMode,'legacy-food');
  const restored=new EmbodiedLife(full);
  assert.equal(restored.neural.learningMode,'legacy-food');assert.equal(restored.state.synapticForaging,true);
  assert.deepEqual(restored.neural.learning.serializeWeights(),weights);
  const backup=companionCheckpoint(sim.state);assert.equal(backup.synapticMemoryMode,'legacy-food');
  const target=resident().state;restoreCompanion(target,backup);
  assert.equal(target.synapticMemoryMode,'legacy-food');
});

test('unmarked 8.2 weights restore as legacy food memory and cannot silently enter neutral mode',()=>{
  const sim=resident({learningMode:'legacy-food'});emptyFoods(sim.state);
  const full=sim.serialize();full.version='8.2.0';delete full.synapticMemoryMode;delete full.neural.synapticMemoryMode;
  const restored=new EmbodiedLife(full);
  assert.equal(restored.neural.learningMode,'legacy-food');
  assert.throws(()=>new EmbodiedLife(full,{learningMode:'neutral'}),/模式/);
  const backup=companionCheckpoint(sim.state);delete backup.synapticMemoryMode;
  const target=resident().state;restoreCompanion(target,backup);
  assert.equal(target.synapticMemoryMode,'legacy-food');
});

test('invalid memory mode rejects the whole backup before state changes',()=>{
  const sim=resident();emptyFoods(sim.state);
  const backup=companionCheckpoint(sim.state);backup.synapticMemoryMode='unknown';
  const target=resident().state,before=structuredClone(target);
  assert.throws(()=>restoreCompanion(target,backup),/模式/);
  assert.deepEqual(target,before);
});
