import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const protocol=JSON.parse(readFileSync(new URL('../config/odor-behavior-8.2.0.json',import.meta.url),'utf8'));
const api=()=>import('../scripts/run-odor-behavior.mjs');
const copy=()=>structuredClone(protocol);

test('formal behavior protocol parser rejects missing implementation before any animal simulation runs',async()=>{
  let implemented=false;
  try{const module=await api();implemented=typeof module.validateOdorProtocol==='function';}catch{}
  assert.equal(implemented,true,'Formal preregistered protocol parser must exist before running held-out seeds');
});

test('locked protocol retains all eight held-out seeds, actual consumption and exact causal controls',async()=>{
  const {validateOdorProtocol}=await api();assert.equal(validateOdorProtocol(copy()).seeds.length,8);
  for(const mutate of [p=>p.seeds.pop(),p=>p.seeds[1]=2000,p=>p.seeds[0]=1000,p=>p.training.requiredRewardPulses=5,
    p=>p.probe.rewardEnabled=true,p=>p.probe.frozen=false,p=>p.probe.sampleEverySeconds=.5,
    p=>p.criteria.directionFractionMin=.5,p=>p.criteria.meanAdvantageMinMeters=0,
    p=>p.mappings.swapped.burger='burger',p=>p.foods.apple=100,p=>p.release.requiredSupportedFeet=3]){
    const value=copy();mutate(value);assert.throws(()=>validateOdorProtocol(value));
  }
});

test('target identity follows chemical mapping and headings are balanced without reward-target confounding',async()=>{
  const {targetForSeed,headingForSeed,expectedPhysicalTarget}=await api();
  assert.deepEqual(protocol.seeds.map(targetForSeed),['burger','pizza','burger','pizza','burger','pizza','burger','pizza']);
  assert.deepEqual(protocol.seeds.map(headingForSeed),[0,0,Math.PI,Math.PI,0,0,Math.PI,Math.PI]);
  assert.equal(expectedPhysicalTarget('burger',protocol.mappings.native),'burger');
  assert.equal(expectedPhysicalTarget('burger',protocol.mappings.swapped),'pizza');
  assert.equal(expectedPhysicalTarget('pizza',protocol.mappings.swapped),'burger');
});

function seedResult(seed,advantage=.5){
  const condition=(end,trace)=>({status:'complete',trajectoryHash:trace,summary:{startTargetDistance:2,endTargetDistance:end,
    minimumTargetDistance:end,weightsUnchanged:true,rewardPulses:0,noRoute:true,originalMotorFrames:10,
    ateSeconds:0,firstConsumption:null}});
  return {seed,status:'complete',trainingTarget:seed%2===0?'burger':'pizza',sourcesUnchanged:true,
    training:{trained:{status:'complete',summary:{actualConsumption:true,rewardPulses:6}},
      frozen:{status:'complete',summary:{actualConsumption:true,rewardPulses:6,weightsAllOne:true}}},
    mappings:Object.fromEntries(['native','swapped'].map(mapping=>[mapping,{conditions:{
      trained:condition(1-advantage,'learned'),restored:condition(1-advantage,'learned'),
      frozen:condition(1,'baseline'),erased:condition(1,'baseline')}}]))};
}

test('predeclared endpoint advantage requires both mappings, six of eight positive seeds and mean over .25 m',async()=>{
  const {evaluateBehaviorResults}=await api();
  const values=protocol.seeds.map(seed=>seedResult(seed));
  assert.equal(evaluateBehaviorResults(values,protocol).pass,true);
  values[0].mappings.swapped.conditions.trained.summary.endTargetDistance=2;
  values[1].mappings.swapped.conditions.trained.summary.endTargetDistance=2;
  values[2].mappings.swapped.conditions.trained.summary.endTargetDistance=2;
  const summary=evaluateBehaviorResults(values,protocol);
  assert.equal(summary.pass,false);assert.equal(summary.mappings.swapped.positiveSeeds,5);
  assert.equal(summary.mappings.native.positiveSeeds,8);
});

test('zero advantage and exactly .25 m do not meet the strict primary thresholds',async()=>{
  const {evaluateBehaviorResults}=await api();
  assert.equal(evaluateBehaviorResults(protocol.seeds.map(seed=>seedResult(seed,0)),protocol).pass,false);
  assert.equal(evaluateBehaviorResults(protocol.seeds.map(seed=>seedResult(seed,.25)),protocol).pass,false);
});

test('missing seeds and errors remain failures in the eight-seed denominator',async()=>{
  const {evaluateBehaviorResults}=await api();
  const result=evaluateBehaviorResults(protocol.seeds.slice(1).map(seed=>seedResult(seed)),protocol);
  assert.equal(result.pass,false);assert.equal(result.nExpectedSeeds,8);assert.equal(result.nCompletedSeeds,7);
  assert.deepEqual(result.missingSeeds,[2000]);
});

test('causal integrity rejects reward leakage, altered probes, non-neural routes or trajectory mismatch',async()=>{
  const {evaluateBehaviorResults}=await api();
  for(const mutate of [r=>r.mappings.native.conditions.frozen.trajectoryHash='different',
    r=>r.mappings.swapped.conditions.restored.trajectoryHash='different',
    r=>r.mappings.native.conditions.trained.summary.weightsUnchanged=false,
    r=>r.mappings.native.conditions.trained.summary.rewardPulses=1,
    r=>r.mappings.native.conditions.trained.summary.noRoute=false,
    r=>r.training.frozen.summary.weightsAllOne=false,r=>r.sourcesUnchanged=false,
    r=>r.training.trained.summary.actualConsumption=false]){
    const values=protocol.seeds.map(seed=>seedResult(seed));mutate(values[0]);
    assert.equal(evaluateBehaviorResults(values,protocol).pass,false);
  }
});

test('both rewarded-food groups and actual eating successes are reported even when approach passes without feeding',async()=>{
  const {evaluateBehaviorResults}=await api();
  const result=evaluateBehaviorResults(protocol.seeds.map(seed=>seedResult(seed)),protocol);
  assert.equal(result.mappings.native.rewardedFoodGroups.burger.nSeeds,4);
  assert.equal(result.mappings.native.rewardedFoodGroups.pizza.nSeeds,4);
  assert.equal(result.mappings.native.feedingSuccess.trained,0);
  assert.equal(result.mappings.native.pass,true);
  assert.match(result.scope,/approach|趋近/);
});

test('output reservation refuses an existing directory and keeps existing files unchanged',async()=>{
  const {reserveOutput}=await api();const parent=mkdtempSync(join(tmpdir(),'odor-protocol-'));
  try{writeFileSync(join(parent,'keep.txt'),'keep');await assert.rejects(()=>reserveOutput(parent));
    assert.equal(readFileSync(join(parent,'keep.txt'),'utf8'),'keep');
  }finally{rmSync(parent,{recursive:true});}
});
