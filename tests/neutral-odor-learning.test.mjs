import test from 'node:test';
import assert from 'node:assert/strict';

const api=()=>import('../src/neutral-odor-learning.mjs');
const state=()=>({actor:{position:[0,0,0]},home:{food:0}});
const cue=(odor,position=[0,0,0],id='cue-'+odor)=>({id,odor,position,strength:1,range:1,enabled:true});
function advanceFor(learning,s,milliseconds){
  let remaining=milliseconds;
  while(remaining>0){const amount=Math.min(20,remaining);learning.advance(s,amount/1000);remaining-=amount;}
}
function train(learning,s,odor,{paired=true}={}){
  for(let trial=0;trial<6;trial++){
    learning.setCues([cue(odor)]);advanceFor(learning,s,250);
    if(paired)assert.equal(learning.consume('actual-unit-food',.001),true);
    advanceFor(learning,s,250);learning.setCues([]);
    if(!paired){advanceFor(learning,s,3000);assert.equal(learning.consume('actual-unit-food',.001),true);advanceFor(learning,s,250);}
    advanceFor(learning,s,3000);
  }
}

test('independent neutral odor module must exist before changing the game integration',async()=>{
  let implemented=false;try{implemented=typeof (await api()).NeutralOdorLearning==='function';}catch{}
  assert.equal(implemented,true,'Neutral A/B learning has not been implemented');
});

test('untrained A/B readouts are exactly neutral despite different anatomical response magnitudes',async()=>{
  const {NeutralOdorLearning}=await api(),learning=new NeutralOdorLearning();
  const readouts=learning.refreshReadouts({force:true});
  for(const odor of ['A','B']){
    assert.ok(readouts[odor].baselineMBONHz>0,'A fixed stimulus must measurably activate the readout neuron');
    assert.equal(readouts[odor].rateMBON,readouts[odor].baselineMBONHz);
    assert.equal(readouts[odor].deltaHz,0);assert.equal(readouts[odor].valence,0);
  }
});

test('spatial A/B emitters work with zero food and do not carry food or navigation semantics',async()=>{
  const {NeutralOdorLearning}=await api(),learning=new NeutralOdorLearning({cues:[cue('A',[1,0,0])]});
  const s=state(),odor=learning.odorAt(s),signals=learning.sense(s);
  assert.ok(odor.some(value=>value>0));assert.equal(signals.length,1);
  assert.equal(signals[0].kind,'neutral-odor');assert.equal(signals[0].neuralValence,0);
  assert.equal(signals[0].distance,1);assert.ok(!Object.hasOwn(signals[0],'resourceKind'));
  const withoutFoodFields={actor:{position:[0,0,0]}};
  assert.deepEqual([...learning.odorAt(withoutFoodFields)],[...odor]);
  learning.setCues([]);assert.ok(learning.odorAt(s).every(value=>value===0));
  learning.setCues([{...cue('B'),enabled:false}]);assert.equal(learning.sense(s).length,0);
});

test('moving emitters changes sensory concentration without changing stored synapses',async()=>{
  const {NeutralOdorLearning}=await api(),learning=new NeutralOdorLearning({cues:[cue('A')]});
  const initial=learning.serializeWeights(),near=learning.sense(state())[0].intensity;
  learning.setCues([cue('A',[3,0,0])]);const far=learning.sense(state())[0].intensity;
  assert.ok(near>far);assert.deepEqual(learning.serializeWeights(),initial);
});

test('neutral cue identities select fixed sparse PN patterns without any food-id lookup',async()=>{
  const {NeutralOdorLearning}=await api(),a=new NeutralOdorLearning({seed:1}),b=new NeutralOdorLearning({seed:2});
  assert.deepEqual([...a.pattern('A')],[...b.pattern('A')]);assert.notDeepEqual([...a.pattern('A')],[...a.pattern('B')]);
  for(const id of ['A','B']){
    const pattern=a.pattern(id);assert.equal(pattern.filter(value=>value===1).length,29);
    for(let i=0;i<pattern.length;i++)if(pattern[i])assert.equal(a.circuit.roles[i],0);
  }
  assert.throws(()=>a.pattern('burger'));
});

test('only a positive consumption notification creates a bounded PAM teaching pulse',async()=>{
  const {NeutralOdorLearning,NEUTRAL_ODOR_READOUT}=await api(),learning=new NeutralOdorLearning({cues:[cue('A')]});
  const s=state();advanceFor(learning,s,1000);assert.equal(learning.rewardPulses,0);
  for(const amount of [0,-1,NaN,Infinity])assert.equal(learning.consume('food',amount),false);
  assert.equal(learning.consume('',1),false);assert.equal(learning.consume('burger',.001),true);
  assert.equal(learning.consume('pizza',.001),false);assert.equal(learning.rewardPulses,1);
  advanceFor(learning,s,300);assert.equal(learning.rewardUntilMs,1000+NEUTRAL_ODOR_READOUT.rewardPulseMs);
  assert.equal(learning.rewardUntilMs-learning.clockMs,-50);
  learning.rewardEnabled=false;advanceFor(learning,s,3000);
  assert.equal(learning.consume('food',.001),false);assert.equal(learning.rewardPulses,1);
});

test('A+ and B+ conditioning each creates an odor-specific neural response change',async()=>{
  const {NeutralOdorLearning}=await api();
  for(const target of ['A','B']){
    const learning=new NeutralOdorLearning({seed:11000}),s=state();train(learning,s,target);
    const readouts=learning.refreshReadouts({force:true}),other=target==='A'?'B':'A';
    assert.equal(learning.rewardPulses,6);assert.ok(learning.serializeWeights().efficacy.some(q=>q<1));
    assert.ok(readouts[target].deltaHz>10,'Rewarded odor MBON response should decrease');
    assert.ok(readouts[target].valence>readouts[other].valence+.1,'Rewarded odor effect should exceed the unpaired odor');
  }
});

test('frozen plasticity preserves neutral responses despite cue and consumption experience',async()=>{
  const {NeutralOdorLearning}=await api(),learning=new NeutralOdorLearning({frozen:true});
  train(learning,state(),'A');assert.ok(learning.serializeWeights().efficacy.every(q=>q===1));
  assert.equal(learning.refreshReadouts({force:true}).A.valence,0);
});

test('continuous unreinforced A/B exposure reports baseline DAN instead of silently inventing reward',async()=>{
  const {NeutralOdorLearning}=await api(),learning=new NeutralOdorLearning({seed:11000}),s=state();
  for(let trial=0;trial<6;trial++){
    learning.setCues([cue(trial%2?'A':'B')]);advanceFor(learning,s,500);
    learning.setCues([]);advanceFor(learning,s,3000);
  }
  const snapshot=learning.snapshot();assert.equal(snapshot.rewardPulses,0);
  assert.equal(snapshot.nonRewardDanSpikes,0);assert.ok(learning.serializeWeights().efficacy.every(q=>q===1));
});

test('three-second natural blank actually clears eligibility and dopamine before a wrong-time reward',async()=>{
  const {NeutralOdorLearning}=await api(),learning=new NeutralOdorLearning({seed:11000}),s=state();
  learning.setCues([cue('A')]);advanceFor(learning,s,500);learning.setCues([]);advanceFor(learning,s,3000);
  const before=learning.snapshot();assert.ok(before.eligibilityMax<1e-8);assert.ok(before.dopamineMean<1e-8);
  const paired=new NeutralOdorLearning({seed:11000});train(paired,s,'A');train(learning,s,'A',{paired:false});
  assert.equal(learning.rewardPulses,paired.rewardPulses);
  const wrong=learning.refreshReadouts({force:true}),right=paired.refreshReadouts({force:true});
  assert.ok(Math.abs(wrong.A.valence)<.02);assert.ok(right.A.valence>wrong.A.valence+.2);
});

test('pure 946-weight storage retains learning with no cues, scores, positions or activity in the save',async()=>{
  const {NeutralOdorLearning}=await api(),learning=new NeutralOdorLearning({seed:11000}),s=state();train(learning,s,'A');
  const expected=learning.refreshReadouts({force:true}),saved=learning.serializeWeights();
  assert.deepEqual(Object.keys(saved).sort(),['efficacy','format','graphHash','modelVersion']);assert.equal(saved.efficacy.length,946);
  const restored=new NeutralOdorLearning({saved});assert.deepEqual(restored.refreshReadouts({force:true}),expected);
  restored.setCues([cue('A',[2,0,0])]);restored.restoreWeights({...saved,efficacy:saved.efficacy.map(()=>1)});
  assert.equal(restored.refreshReadouts({force:true}).A.valence,0);
  restored.restoreWeights(saved);assert.deepEqual(restored.refreshReadouts({force:true}),expected);
  const snap=restored.snapshot();assert.equal(snap.clockMs,0);assert.equal(snap.eligibilityMax,0);assert.equal(snap.dopamineMean,0);
});

test('failed restore and invalid cue replacements leave weights, clock and existing emitters intact',async()=>{
  const {NeutralOdorLearning}=await api(),learning=new NeutralOdorLearning({cues:[cue('A')]});advanceFor(learning,state(),200);
  const weights=learning.serializeWeights(),clock=learning.clockMs,signals=learning.sense(state());
  assert.throws(()=>learning.restoreWeights({...weights,efficacy:[.1]}));
  for(const cues of [[cue('C')],[cue('A'),cue('B',[1,0,0],'cue-A')],[{...cue('A'),position:[NaN,0,0]}],[{...cue('A'),resourceKind:'food'}]])assert.throws(()=>learning.setCues(cues));
  assert.deepEqual(learning.serializeWeights(),weights);assert.equal(learning.clockMs,clock);assert.deepEqual(learning.sense(state()),signals);
});
