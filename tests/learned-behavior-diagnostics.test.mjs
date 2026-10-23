import test from 'node:test';
import assert from 'node:assert/strict';

async function api(){
  let module;try{module=await import('../scripts/diagnose-learned-behavior.mjs');}catch{}
  assert.equal(typeof module?.validateDiagnosticOptions,'function','Bounded q-only diagnostics must exist before interpreting a training pilot');
  return module;
}

test('diagnostic refuses heldout seeds, unbounded durations and invalid odors',async()=>{
  const {validateDiagnosticOptions}=await api();
  assert.equal(validateDiagnosticOptions({}).seed,8401);
  for(const seed of [6100,6107,-1,2**32,1.5])assert.throws(()=>validateDiagnosticOptions({seed}),/seed|heldout/i);
  assert.equal(validateDiagnosticOptions({trainingSeconds:12,probeSeconds:8}).trainingSeconds,12);
  for(const trainingSeconds of [0,11,61,12.01])assert.throws(()=>validateDiagnosticOptions({trainingSeconds}),/training/i);
  for(const probeSeconds of [0,8.02,.11,Infinity])assert.throws(()=>validateDiagnosticOptions({probeSeconds}),/probe/i);
  assert.throws(()=>validateDiagnosticOptions({odor:'food'}),/odor/i);
});

const observation=(overrides={})=>({inputs:[.2,.3,0,.1],motor:{local:[0,0,0],drive:.4},
  position:[0,1,0],heading:0,focus:'eat',targetId:null,routeStatus:null,
  neutralCueProjected:true,neutralValences:{A:.5,B:.1},neuralSteps:400,
  inventory:0,rewardPulses:0,weightsUnchanged:true,neuralError:null,...overrides});

test('summary separates changed sensation, changed motor and changed physical position',async()=>{
  const {summarizeDiagnostic}=await api();
  const rows=[{t:0,learned:observation(),erased:observation({inputs:[.1,.3,0,.1]})},
    {t:.02,learned:observation({motor:{local:[.2,0,0],drive:.4}}),erased:observation()},
    {t:.04,learned:observation({position:[.01,1,0]}),erased:observation()}];
  const summary=summarizeDiagnostic(rows,{body:true,originalBrain:true,associationActivity:true});
  assert.equal(summary.pass,true);assert.equal(summary.sensationDifferentTicks,1);
  assert.equal(summary.motorDifferentTicks,1);assert.equal(summary.positionDifferentTicks,1);
  assert.equal(summary.firstPositionDifferenceSeconds,.04);
  assert.equal(summary.scientificLearningSuccess,null);
});

test('counterfactual mismatches, absent response and contamination remain visible failures',async()=>{
  const {summarizeDiagnostic}=await api();
  const unchanged=[{t:0,learned:observation(),erased:observation()}];
  const neutral=summarizeDiagnostic(unchanged,{body:true,originalBrain:true,associationActivity:true});
  assert.equal(neutral.pass,true);assert.equal(neutral.motorDifferentTicks,0);
  assert.ok(neutral.behaviorFailures.includes('No q-dependent motor difference within this bounded probe'));
  const bad=summarizeDiagnostic([{t:.02,learned:observation({inventory:1,rewardPulses:1,weightsUnchanged:false}),
    erased:observation({neuralError:'failure'})}],{body:false,originalBrain:true,associationActivity:true});
  assert.equal(bad.pass,false);assert.match(bad.issues.join('\n'),/body|food|reward|weights|failure/i);
});

test('same current body sensory comparison excludes sensory differences caused by diverged positions',async()=>{
  const {summarizeDiagnostic}=await api();
  const summary=summarizeDiagnostic([{t:0,learned:observation(),erased:observation({inputs:[.1,.3,0,.1]}),
    sameBodyInputs:{learned:[.2,.3,0,.1],erased:[.2,.3,0,.1]}}],{body:true,originalBrain:true,associationActivity:true});
  assert.equal(summary.sensationDifferentTicks,1);
  assert.equal(summary.sameBodySensationDifferentTicks,0);
  assert.equal(summary.sameBodySamples,1);
});

test('runtime branch preserves body, original neural pending frame and association activity while changing only q',async()=>{
  const {cloneCounterfactual,counterfactualIdentity}=await api();
  const {EmbodiedLife}=await import('../src/embodied-life.mjs');
  const sim=new EmbodiedLife(null,{seed:8401,learningMode:'neutral'});
  sim.neural.learning.frozen=true;sim.neural.learning.rewardEnabled=false;
  sim.neural.advanceSlice(sim.state,80,.1);
  const before=counterfactualIdentity(sim),weights=sim.neural.learning.serializeWeights().efficacy;
  const branch=cloneCounterfactual(sim,{seed:8401,efficacy:weights.map((q,i)=>i===0?.5:q)});
  assert.deepEqual(counterfactualIdentity(branch),before);
  assert.equal(branch.neural.pending.steps,80);
  assert.equal(branch.neural.learning.serializeWeights().efficacy[0],.5);
  assert.equal(sim.neural.learning.serializeWeights().efficacy[0],1);
  branch.state.actor.position[0]+=1;
  assert.notDeepEqual(branch.state.actor.position,sim.state.actor.position);
  const identical=cloneCounterfactual(sim,{seed:8401,efficacy:weights});
  for(let i=0;i<5;i++){sim.tick(.02);identical.tick(.02);}
  assert.deepEqual(counterfactualIdentity(identical),counterfactualIdentity(sim),'q-identical replay must remain exact through completing a pending frame');
});
