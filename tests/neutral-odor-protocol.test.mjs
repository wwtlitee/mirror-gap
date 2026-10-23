import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const api=()=>import('../scripts/run-neutral-odor-behavior.mjs');
const readProtocol=()=>JSON.parse(readFileSync(new URL('../config/neutral-odor-behavior-8.3.0.json',import.meta.url),'utf8'));

test('neutral learning protocol exists before running a new animal simulation',async()=>{
  let implemented=false;
  try{implemented=typeof(await api()).validateNeutralProtocol==='function';}catch{}
  assert.equal(implemented,true,'A food-free neutral-cue protocol must exist before the pilot starts');
});

test('relative preference uses both cues and stays bounded when the body overlaps a source',async()=>{
  const {preferenceIndex}=await api();
  assert.equal(preferenceIndex(0,1),1);assert.equal(preferenceIndex(1,0),-1);
  assert.equal(preferenceIndex(2,2),0);assert.equal(preferenceIndex(0,0),0);
  assert.throws(()=>preferenceIndex(-1,1));assert.throws(()=>preferenceIndex(NaN,1));
});

test('time-averaged preference uses the predeclared final window rather than the nearest endpoint',async()=>{
  const {summarizePreference}=await api();
  const samples=[{elapsed:0,distances:{A:0,B:1}},{elapsed:10,distances:{A:1,B:3}},
    {elapsed:15,distances:{A:3,B:1}},{elapsed:20,distances:{A:3,B:1}}];
  const result=summarizePreference(samples,'A',{seconds:20,analysisWindowSeconds:10});
  assert.equal(result.nIntervals,2);assert.equal(result.preferenceIndex,-.25);
  assert.throws(()=>summarizePreference(samples.slice(0,2),'A',{seconds:20,analysisWindowSeconds:10}));
});

test('formal protocol locks all eight fresh seeds and never allows food or reward during a probe',async()=>{
  const {validateNeutralProtocol}=await api();const protocol=readProtocol();
  assert.equal(validateNeutralProtocol(protocol).seeds.length,8);
  for(const mutate of [p=>p.seeds.pop(),p=>p.seeds[1]=p.seeds[0],p=>p.seeds[0]=2000,
    p=>p.probe.rewardEnabled=true,p=>p.probe.frozen=false,p=>p.probe.foods.burger=1,
    p=>p.probe.originalFoodNavigation=false,p=>p.training.requiredRewardPulses=5,
    p=>p.training.unpairedGapSeconds=.1,p=>p.criteria.meanPairedOverUnpairedMin=0,
    p=>p.criteria.directionFractionMin=.5,p=>p.criteria.baselineMeanAbsMax=1,
    p=>p.mappings.swapped.left='A',p=>p.training.actualConsumptionRequired=false]){
    const changed=structuredClone(protocol);mutate(changed);assert.throws(()=>validateNeutralProtocol(changed));
  }
});

test('pilot seeds and phase cannot enter a held-out summary',async()=>{
  const {pilotProtocol,validateNeutralProtocol}=await api();const formal=readProtocol();
  const pilot=pilotProtocol(formal);assert.equal(pilot.phase,'development-pilot');
  assert.ok(pilot.seeds.every(seed=>!formal.seeds.includes(seed)));
  assert.throws(()=>validateNeutralProtocol(pilot));
  assert.equal(validateNeutralProtocol(pilot,{allowPilot:true}).phase,'development-pilot');
});

test('each standard food exposure releases stale food retries while preserving the live brain and learning state',async()=>{
  const {resetExposureAttention}=await api();
  const state={simSeconds:14,neural:{step:5600},synapticMemory:{efficacy:[.4]},living:{contactSeconds:0,
    focus:{action:'explore',lastUpdatedAt:13.9,candidate:'rest',candidateSince:13},
    navigation:{targetId:'resource:burger',failedUntil:{'resource:burger':30},route:{targetId:'nest'}},
    commitment:{action:'observe'},resourceSession:{id:'burger'},activityRetryUntil:{eat:30,drink:20},activityCooldowns:{eat:30,drink:10}}};
  resetExposureAttention(state,4);
  assert.equal(state.living.focus.action,'eat');assert.equal(state.living.focus.candidate,null);
  assert.equal(state.living.contactSeconds,4);assert.equal(state.living.activityRetryUntil.eat,undefined);
  assert.equal(state.living.activityRetryUntil.drink,20);assert.equal(state.living.activityCooldowns.eat,0);
  assert.equal(state.living.navigation.targetId,null);assert.equal(state.living.commitment,null);
  assert.deepEqual(state.neural,{step:5600});assert.deepEqual(state.synapticMemory,{efficacy:[.4]});
});

test('physics evidence checks every step for empty food, no consumption, reward, plasticity or cue routes',async()=>{
  const {summarizeProbeIntegrity}=await api();
  const clean=()=>({homeFood:0,foodStock:{apple:0,burger:0},ateSeconds:4,consumedAmount:0,
    rewardEnabled:false,rewardPulses:0,rewardUntilMs:0,frozen:true,weightSHA256:'unchanged',
    navigationTarget:null,routeTarget:null,synapticForaging:false});
  const summarize=frames=>summarizeProbeIntegrity(frames,{initialWeightSHA256:'unchanged',initialAteSeconds:4,initialConsumedAmount:0});
  assert.equal(summarize([clean(),clean()]).pass,true);
  for(const mutate of [x=>x.homeFood=1,x=>x.foodStock.apple=1,x=>x.ateSeconds=4.02,
    x=>x.consumedAmount=.001,x=>x.rewardEnabled=true,x=>x.rewardPulses=1,
    x=>x.frozen=false,x=>x.weightSHA256='changed',x=>x.navigationTarget='cue-left',
    x=>x.routeTarget='cue-right',x=>x.synapticForaging=true]){
    const frames=[clean(),clean()];mutate(frames[1]);assert.equal(summarize(frames).pass,false);
  }
});

function result(seed,pi=.5,unpaired=0){
  const probe=(value,hash)=>({status:'complete',trajectoryHash:hash,summary:{preferenceIndex:value,
    emptyFoodAllFrames:true,noConsumption:true,noReward:true,weightsUnchanged:true,noCueRoute:true,
    originalFoodNavigationEnabled:true,originalMotorFrames:200,initialStateHash:'same-body-and-brain',
    frozenAllFrames:true,physicsFrameCount:1000,invariantFailureCounts:{food:0,consumption:0,reward:0,plasticity:0,cueRoute:0,originalForaging:0}}});
  const train=allOne=>({status:'complete',summary:{actualConsumption:true,consumptionTicks:6,
    ateSeconds:.12,consumedAmount:.0075,rewardPulses:6,pulsesFromSameStep:true,cueExposureMs:9000,
    weightsAllOne:allOne,minimumUnpairedGapMs:3000,naturallyDecayedBeforeUnpaired:true,naturallyDecayedBeforeUnpairedBites:true}});
  return {seed,status:'complete',sourcesUnchanged:true,training:{paired:train(false),unpaired:train(false),frozen:train(true)},
    noCue:probe(0,'baseline'),mappings:Object.fromEntries(['native','swapped'].map(mapping=>[mapping,{conditions:{
      baseline:probe(0,'baseline'),paired:probe(pi,'learned'),unpaired:probe(unpaired,'unpaired'),
      frozen:probe(0,'baseline'),erased:probe(0,'baseline'),restored:probe(pi,'learned')}}]))};
}

test('both spatial mappings need six positive changes and paired improvement exceeding the equal-food timing control',async()=>{
  const {evaluateNeutralResults}=await api();const p=readProtocol(),values=p.seeds.map(seed=>result(seed));
  const passing=evaluateNeutralResults(values,p);assert.equal(passing.pass,true);
  assert.equal(passing.mappings.native.positiveAbsolutePreferenceSeeds,8);
  assert.equal(passing.mappings.native.seeds[0].pairedPostPreference,.5);
  for(let i=0;i<3;i++)values[i].mappings.swapped.conditions.paired.summary.preferenceIndex=-.1;
  const summary=evaluateNeutralResults(values,p);assert.equal(summary.pass,false);
  assert.equal(summary.mappings.swapped.positiveSeeds,5);assert.equal(summary.mappings.native.positiveSeeds,8);
  assert.equal(evaluateNeutralResults(p.seeds.map(seed=>result(seed,.2,0)),p).pass,false);
  assert.equal(evaluateNeutralResults(p.seeds.map(seed=>result(seed,.6,.5)),p).pass,false);
});

test('missing and failed seeds stay in the eight-seed denominator and A+/B+ results remain separate',async()=>{
  const {evaluateNeutralResults}=await api();const p=readProtocol(),values=p.seeds.slice(1).map(seed=>result(seed));
  const s=evaluateNeutralResults(values,p);assert.equal(s.pass,false);assert.equal(s.nExpectedSeeds,8);
  assert.deepEqual(s.missingSeeds,[p.seeds[0]]);
  assert.equal(s.mappings.native.rewardedCueGroups.A.nExpectedSeeds,4);
  assert.equal(s.mappings.native.rewardedCueGroups.B.nExpectedSeeds,4);
});

test('causal checks reject food leakage, reward, plasticity, cue routes, mismatched states or a noncausal trajectory',async()=>{
  const {evaluateNeutralResults}=await api();const p=readProtocol();
  for(const mutate of [r=>r.mappings.native.conditions.paired.summary.emptyFoodAllFrames=false,
    r=>r.mappings.native.conditions.paired.summary.noConsumption=false,
    r=>r.mappings.native.conditions.paired.summary.noReward=false,
    r=>r.mappings.native.conditions.paired.summary.weightsUnchanged=false,
    r=>r.mappings.native.conditions.paired.summary.frozenAllFrames=false,
    r=>r.mappings.native.conditions.paired.summary.physicsFrameCount=999,
    r=>r.mappings.native.conditions.paired.summary.invariantFailureCounts.food=1,
    r=>r.mappings.native.conditions.paired.summary.noCueRoute=false,
    r=>r.mappings.native.conditions.paired.summary.originalFoodNavigationEnabled=false,
    r=>r.mappings.native.conditions.paired.summary.initialStateHash='different-state',
    r=>r.mappings.native.conditions.erased.trajectoryHash='not-baseline',
    r=>r.mappings.native.conditions.restored.trajectoryHash='not-paired',
    r=>r.mappings.native.conditions.baseline.trajectoryHash='innate-cue-drive',
    r=>r.training.frozen.summary.weightsAllOne=false,r=>r.sourcesUnchanged=false,
    r=>r.training.unpaired.summary.consumedAmount*=2,
    r=>r.training.unpaired.summary.cueExposureMs+=20,
    r=>r.training.unpaired.summary.naturallyDecayedBeforeUnpaired=false,
    r=>r.training.unpaired.summary.naturallyDecayedBeforeUnpairedBites=false,
    r=>r.training.unpaired.summary.minimumUnpairedGapMs=200]){
    const values=p.seeds.map(seed=>result(seed));mutate(values[0]);
    assert.equal(evaluateNeutralResults(values,p).pass,false);
  }
});

test('evidence output never overwrites an existing run',async()=>{
  const {reserveOutput}=await api();const directory=mkdtempSync(join(tmpdir(),'neutral-protocol-'));
  try{writeFileSync(join(directory,'keep.txt'),'keep');await assert.rejects(()=>reserveOutput(directory));
    assert.equal(readFileSync(join(directory,'keep.txt'),'utf8'),'keep');}
  finally{rmSync(directory,{recursive:true});}
});

test('source registration binds the binary collision world and dependency lockfile',async()=>{
  const {sourceHashes}=await api();const hashes=await sourceHashes();
  assert.match(hashes['public/assets/room-collision.bin']??'',/^[a-f0-9]{64}$/);
  assert.match(hashes['package-lock.json']??'',/^[a-f0-9]{64}$/);
});
