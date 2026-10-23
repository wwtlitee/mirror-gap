import test from 'node:test';
import assert from 'node:assert/strict';

const api=()=>import('../scripts/summarize-guidance-mechanism.mjs');
const close=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-10));

test('offline receptor inversion and world transform recover a known direction',async()=>{
  const {decodeGuidanceInput,guidanceWorldVector}=await api(),d=1/Math.sqrt(3),local=[.3,-.2,.4];
  const receptors=[[d,d,d],[-d,-d,d],[-d,d,-d],[d,-d,-d]];
  const inputs=receptors.map(r=>.34+.28*r.reduce((sum,x,i)=>sum+x*local[i],0));
  close(decodeGuidanceInput(inputs),local);
  close(guidanceWorldVector([0,0,1],Math.PI/2),[1,0,0]);
});

test('only newly decoded motors align inputs with the sampled reference heading',async()=>{
  const {summarizeGuidanceFrames}=await api(),d=1/Math.sqrt(3),input=[d,d,-d,-d].map(x=>.34+.28*x);
  const first={local:[0,0,0],populations:[.34,.34,.34,.34],referenceHeading:0,drive:1};
  const fresh={local:[0,0,1],populations:[.5,.5,.2,.2],referenceHeading:Math.PI/2,drive:1};
  const row=(t,motor)=>({t,position:[0,0,0],heading:-Math.PI/2,motor,sensoryInputs:input});
  const report=summarizeGuidanceFrames([row(0,first),row(.02,first),row(.04,fresh),row(.06,fresh)],{source:[1,0,0]});
  assert.equal(report.freshFrames,1);
  assert.equal(report.inputTarget.meanCosine,1);
  assert.equal(report.motorTarget.meanCosine,1);
  assert.equal(report.inputMotor.meanCosine,1);
  assert.equal(report.worldFrame,'completed-neural-frame motor.referenceHeading');
});

test('clipped receptor samples remain visible and never masquerade as exact inversions',async()=>{
  const {summarizeGuidanceFrames}=await api();
  const row=(t,x)=>({t,position:[0,0,0],motor:{local:[x,0,0],referenceHeading:0,populations:[x,0,0,0]},sensoryInputs:[.8,.8,0,0]});
  const report=summarizeGuidanceFrames([row(0,0),row(.02,1)],{source:[1,0,0]});
  assert.equal(report.freshFrames,1);
  assert.equal(report.clippedReceptorFrames,1);
  assert.equal(report.inputTarget.samples,0);
  assert.equal(report.motorTarget.samples,1);
});

test('horizontal cue alignment remains separate from vertical motor and gravity compensation',async()=>{
  const {summarizeGuidanceFrames}=await api(),d=1/Math.sqrt(3),input=[d,d,-d,-d].map(x=>.34+.28*x);
  const row=(t,up)=>({t,position:[0,0,0],velocity:[1,-5,0],motor:{local:[0,up,1],referenceHeading:Math.PI/2},sensoryInputs:input});
  const report=summarizeGuidanceFrames([row(0,0),row(.02,100)],{source:[1,0,0]});
  assert.ok(report.motorTarget.meanCosine<.011);
  assert.equal(report.motorTargetHorizontal.meanCosine,1);
  assert.equal(report.inputMotorHorizontal.meanCosine,1);
  assert.equal(report.velocityTargetHorizontal.meanCosine,1);
});

test('an apparently positive probe never overrides insufficient actual teaching in the observational report',async()=>{
  const {guidanceMechanismPrimaryValidity}=await api();
  const animal={seed:9310,target:'A',status:'complete',sourcesUnchanged:true,failures:['paired-insufficient-real-intake'],
    training:{paired:{actualTeachingEvents:1,changedSynapses:100},frozen:{actualTeachingEvents:1,changedSynapses:0,teachingMatched:true}},
    mappings:Object.fromEntries(['native','swapped'].map(mapping=>[mapping,{valid:true,commonCheckpointMatched:true,restoreExact:true,frozenControlValid:true,
      learned:{tailPreferenceTarget:.8},erased:{tailPreferenceTarget:0},restored:{tailPreferenceTarget:.8}}]))};
  const report=guidanceMechanismPrimaryValidity(animal);
  assert.equal(report.native.valid,false);
  assert.equal(report.native.qualifying,false);
  assert.equal(report.native.primaryContribution,0);
  assert.ok(report.native.failures.includes('insufficient-real-intake-or-memory'));
});
