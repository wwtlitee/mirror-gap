import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {senseEnvironment} from '../src/neural-controller.mjs';
import {createCompanion} from '../public/companion-identity.mjs';
import {createCare} from '../public/pet-care.mjs';
import {FOOD_IDS} from '../public/food-stock.mjs';

const position=[-3.1874151621111615,1.2754599002118072,1.2610225787547757];
const heading=.25839221306456966;
function resident(){
  const sim=new EmbodiedLife(null,{learningMode:'legacy-food'});
  Object.assign(sim.state.actor,{position:[...position],heading,contact:true,zoneId:'feed',mode:'activity',velocity:[0,0,0]});
  sim.state.needs.satiety=25;sim.state.living.physiology.thirst=.1;sim.state.living.contactSeconds=4;
  return sim;
}

test('the original functional motor brain gains a separate anatomical learning circuit',()=>{
  const sim=new EmbodiedLife(null,{learningMode:'legacy-food'});
  assert.equal(sim.neural.brain.n,4386);
  assert.ok(sim.neural.learning,'missing synaptic learning circuit');
  assert.equal(sim.neural.learning.circuit.n,1259);
});

test('all uint32 motor seeds remain valid after adding the learning circuit',()=>{
  const sim=new EmbodiedLife(null,{seed:0xffffffff,learningMode:'legacy-food'});
  assert.ok(sim.neural.learning);
});

test('full saves preserve current weights through one source of truth',()=>{
  const sim=new EmbodiedLife(null,{learningMode:'legacy-food'}),weights=sim.neural.learning.serializeWeights();
  weights.efficacy.fill(.5);sim.neural.learning.restoreWeights(weights);
  const saved=sim.serialize(),restored=new EmbodiedLife(saved);
  assert.deepEqual(restored.neural.learning.serializeWeights(),weights);
  assert.equal(saved.neural.synapticMemory,undefined);
});

test('invalid synaptic data cannot partially change the existing motor controller',()=>{
  const sim=new EmbodiedLife(null,{learningMode:'legacy-food'}),controller=sim.neural,before=controller.serialize();
  const broken=structuredClone(before);broken.rng=123;broken.synapticMemory=null;
  assert.throws(()=>controller.restore(broken));
  assert.equal(controller.rng,before.rng);
});

test('actual eating, rather than food refill or proximity, supplies the teaching pulse',()=>{
  const sim=resident();
  assert.ok(sim.neural.learning,'missing actual-consumption learning hook');
  const initial=sim.neural.learning.snapshot();
  assert.equal(initial.consumedAmount,0);
  sim.interact('feed');
  assert.equal(sim.neural.learning.snapshot().rewardPulses,0);
  for(let i=0;i<200;i++)sim.tick(.02);
  assert.ok(sim.state.stats.ateSeconds>2,'requires real original-brain feeding');
  const result=sim.neural.learning.snapshot();
  assert.ok(result.consumedAmount>0);
  assert.ok(result.rewardPulses>0);
  assert.ok(result.changedSynapses>0);
  assert.equal(sim.state.synapticMemory.efficacy.length,946);
});

test('an empty food supply cannot write associative memory',()=>{
  const sim=resident();sim.state.home.food=0;
  // Legacy unowned rooms automatically refill empty food. A real individual
  // with explicitly empty pieces is needed to exercise no-consumption here.
  sim.state.companion=createCompanion({seed:'0123456789abcdef0123456789abcdef'});
  sim.state.living.care=createCare();
  sim.state.living.care.foods=Object.fromEntries(FOOD_IDS.map(id=>[id,0]));
  const before=sim.neural.learning.serializeWeights();
  for(let i=0;i<200;i++)sim.tick(.02);
  assert.equal(sim.state.stats.ateSeconds,0);
  assert.equal(sim.neural.learning.snapshot().rewardPulses,0);
  assert.deepEqual(sim.neural.learning.serializeWeights(),before);
});

test('disconnecting the original movement brain prevents learned odors from producing thrust',()=>{
  const sim=new EmbodiedLife(null,{learningMode:'legacy-food'}),weights=sim.neural.learning.serializeWeights();
  weights.efficacy.fill(.05);sim.neural.learning.restoreWeights(weights);
  sim.neural.learning.frozen=true;sim.neural.learning.rewardEnabled=false;
  Object.assign(sim.state.actor,{position:[-3.6,1.110099976158142,1.5],heading:0,contact:true,zoneId:'feed',mode:'activity',velocity:[0,0,0]});
  sim.state.needs.satiety=25;sim.state.living.physiology.thirst=.1;sim.state.living.focus.action='eat';
  sim.neural.brain.disconnect();
  for(let i=0;i<100;i++)sim.tick(.02);
  assert.equal(sim.neural.error,null);
  assert.deepEqual(sim.neural.motor.local,[0,0,0]);
  assert.equal(sim.neural.motor.drive,0);
  assert.ok(sim.neural.learning.readouts.burger.valence>0);
});

test('learned food sensation bypasses old external food preferences and goal routes',()=>{
  const sim=new EmbodiedLife(null,{learningMode:'legacy-food'}),s=sim.state;
  s.needs.satiety=20;s.living.focus.action='eat';
  const source={id:'training-odor',resourceId:'apple',resourceKind:'food',kind:'odor',zone:'feed',label:'气味',position:[-1,1,0],range:2};
  s.actor.position=[0,1,0];
  const options={foodLearning:{apple:{rateMBON:0,valence:1}},feedbackSeconds:.1};
  const first=senseEnvironment(s,{feed:0,mist:0,chime:0},[source],options);
  s.living.navigation.targetId='training-odor';
  s.living.navigation.route={status:'ready',targetId:'training-odor',direction:[1,0,0],waypoints:[[1,1,0]],index:0,remainingDistance:1};
  const second=senseEnvironment(s,{feed:0,mist:0,chime:0},[source],options);
  assert.deepEqual(second.inputs,first.inputs,'a food route must not replace odor-driven sensation');
  assert.equal(second.context.synapticFood,true);
});

test('food routes cannot override learned sensation during the initial focus sampling period',()=>{
  const sim=new EmbodiedLife(null,{learningMode:'legacy-food'}),s=sim.state;
  s.needs.satiety=20;s.living.focus.action=null;s.actor.position=[0,1,0];
  const source={id:'training-odor',resourceId:'apple',resourceKind:'food',kind:'odor',zone:'feed',label:'气味',position:[-1,1,0],range:2};
  const options={foodLearning:{apple:{rateMBON:0,valence:1}},feedbackSeconds:.1};
  const first=senseEnvironment(s,{feed:0,mist:0,chime:0},[source],options);
  s.living.navigation.targetId='training-odor';
  s.living.navigation.route={status:'ready',targetId:'training-odor',direction:[1,0,0],waypoints:[[1,1,0]],index:0,remainingDistance:1};
  const second=senseEnvironment(s,{feed:0,mist:0,chime:0},[source],options);
  assert.deepEqual(second.inputs,first.inputs);
});
