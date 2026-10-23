import test from 'node:test';
import assert from 'node:assert/strict';
import {OdorLearning,FOOD_ODORS,makeOdorPatterns} from '../src/odor-learning.mjs';
import {EmbodiedLife} from '../src/embodied-life.mjs';

test('synthetic odors have equal fixed PN counts and do not change with rewards',()=>{
  const learner=new OdorLearning(),before=learner.patterns;
  for(const source of FOOD_ODORS){
    assert.equal(before[source.id].reduce((a,b)=>a+b,0),29);
    before[source.id].forEach((drive,i)=>{if(drive)assert.equal(learner.circuit.roles[i],0);});
  }
  const duplicate=makeOdorPatterns(learner.circuit.pnIndices,learner.circuit.n);
  assert.deepEqual(duplicate,before);
});

test('mixture normalization stays within PN probability bounds despite rounding',()=>{
  const sim=new EmbodiedLife(null,{learningMode:'legacy-food'});
  sim.state.companion={};
  sim.state.living.care={foods:Object.fromEntries(FOOD_ODORS.map(source=>[source.id,['burger','pizza'].includes(source.id)?100:0]))};
  for(const position of [[-3.8862825967371464,1.1082005117787048,.44941461039707065],[-3.6,1.05,1.5]]){
    sim.state.actor.position=position;
    const odor=sim.neural.learning.odorAt(sim.state);
    assert.ok(odor.every(value=>value>=0&&value<=1),'normalization exceeded one');
  }
});

test('reward pulses require positive actual consumption and have a refractory interval',()=>{
  const learner=new OdorLearning();
  for(const amount of [0,-1,NaN,Infinity])assert.equal(learner.consume('apple',amount),false);
  assert.equal(learner.consume('unrecognized',1),false);
  assert.equal(learner.snapshot().rewardPulses,0);
  assert.equal(learner.consume('apple',.01),true);
  assert.equal(learner.consume('apple',.01),false);
  assert.equal(learner.snapshot().rewardPulses,1);
  assert.equal(learner.snapshot().consumedAmount,.02);
});

test('probe mode counts food consumption without adding a teaching pulse',()=>{
  const learner=new OdorLearning();learner.rewardEnabled=false;
  assert.equal(learner.consume('apple',.01),false);
  assert.equal(learner.snapshot().rewardPulses,0);
  assert.equal(learner.snapshot().consumedAmount,.01);
});

test('inference restores only weights and cannot modify the learning circuit',()=>{
  const learner=new OdorLearning(),before=learner.serializeWeights();
  const readouts=learner.refreshReadouts({force:true});
  assert.deepEqual(learner.serializeWeights(),before);
  assert.deepEqual(Object.keys(readouts),FOOD_ODORS.map(source=>source.id));
  for(const value of Object.values(readouts))assert.ok(Number.isFinite(value.rateMBON)&&Math.abs(value.valence)<=1);
  const saved=learner.serializeWeights();saved.efficacy.fill(.1);learner.restoreWeights(saved);
  assert.deepEqual(learner.readouts,{});
  assert.ok(learner.refreshReadouts({force:true}).apple.rateMBON<readouts.apple.rateMBON);
});

test('freezing stops plasticity while sensation and real-time neural activity continue',()=>{
  const sim=new EmbodiedLife(null,{learningMode:'legacy-food'}),learner=sim.neural.learning;
  learner.frozen=true;
  sim.state.actor.position=[-3.11,1.09,1.55];
  learner.consume('apple',.01);
  for(let i=0;i<20;i++)learner.advance(sim.state,.02);
  assert.equal(learner.clockMs,400);
  assert.ok(learner.serializeWeights().efficacy.every(q=>q===1));
});
