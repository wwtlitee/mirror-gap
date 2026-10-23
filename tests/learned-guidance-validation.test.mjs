import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const protocol=()=>JSON.parse(readFileSync(new URL('../config/learned-guidance-validation-8.5.0.json',import.meta.url)));
async function api(){let result;try{result=await import('../scripts/validate-learned-guidance.mjs');}catch{}
  assert.equal(typeof result?.validateGuidanceProtocol,'function','The full fresh-seed protocol and failure-inclusive aggregator must exist before any cohort animal is run');return result;}

function result(seed,learned=.5,erased=0){return {seed,target:seed%2?'B':'A',status:'complete',sourcesUnchanged:true,failures:[],
  training:{paired:{actualTeachingEvents:2,consumptionTicks:272,consumedAmount:.2176,changedSynapses:169},
    frozen:{actualTeachingEvents:2,consumptionTicks:272,consumedAmount:.2176,changedSynapses:0,teachingMatched:true}},
  mappings:Object.fromEntries(['native','swapped'].map(mapping=>[mapping,{valid:true,failures:[],
    commonCheckpointMatched:true,restoreExact:true,frozenControlValid:true,
    learned:{tailPreferenceTarget:learned},erased:{tailPreferenceTarget:erased},
    frozen:{tailPreferenceTarget:0},restored:{tailPreferenceTarget:learned}}]))};}

test('protocol fixes all16 fresh seeds, balanced target identity, physical geometry, safety and thresholds',async()=>{
  const {validateGuidanceProtocol,planGuidanceValidation}=await api(),p=validateGuidanceProtocol(protocol());
  assert.equal(p.seeds.length,16);assert.equal(p.workerConcurrency,1);
  const plan=planGuidanceValidation(p);assert.equal(plan.animalsStarted,0);assert.equal(plan.seeds[0].target,'A');
  assert.equal(plan.seeds[15].target,'B');assert.equal(plan.expectedProbeBranches,128);
  for(const mutate of [x=>x.seeds.pop(),x=>x.seeds[0]=6100,x=>x.seeds[1]=9300,x=>x.workerConcurrency=2,
    x=>x.training.maxSeconds=31,x=>x.training.minActualTeachingEvents=1,x=>x.probe.axis='z',x=>x.probe.offsetMetres=.7,
    x=>x.probe.rewardEnabled=true,x=>x.primary.perMappingRequiredPositiveSeeds=11,x=>x.primary.denominator=15]){
    const bad=protocol();mutate(bad);assert.throws(()=>validateGuidanceProtocol(bad));}
});

test('passing fixture requires both mappings,16-seed denominator and reports trained A/B separately',async()=>{
  const {summarizeGuidanceValidation}=await api(),p=protocol(),summary=summarizeGuidanceValidation(p.seeds.map(seed=>result(seed)),p);
  assert.equal(summary.predeclaredCriteriaMet,true);assert.equal(summary.animalsAssigned,16);
  assert.equal(summary.mappings.native.positiveSeeds,16);assert.equal(summary.mappings.native.meanImprovement,.5);
  assert.equal(summary.mappings.native.targets.A.assigned,8);assert.equal(summary.mappings.native.targets.B.assigned,8);
  assert.equal(summary.scientificLearningSuccess,null);
});

test('missing, insufficient feeding, blocked and urgent seeds remain visible and in every denominator',async()=>{
  const {summarizeGuidanceValidation}=await api(),p=protocol(),values=p.seeds.slice(1).map(seed=>result(seed));
  Object.assign(values[0],{status:'failed',failures:['insufficient-real-intake']});
  values[1].mappings.native.valid=false;values[1].mappings.native.failures=['occluded-left'];
  values[2].mappings.native.valid=false;values[2].mappings.native.failures=['urgent-toilet'];
  const s=summarizeGuidanceValidation(values,p),native=s.mappings.native;
  assert.equal(native.assigned,16);assert.equal(native.positiveSeeds,12);assert.equal(native.meanImprovement,12*.5/16);
  assert.equal(native.unavailableOrInvalid,4);assert.equal(native.observations.length,16);
  assert.ok(native.observations.some(x=>x.seed===9300&&x.failures.includes('missing-seed-result')));
  assert.ok(native.observations.some(x=>x.failures.includes('occluded-left')));
});

test('restore mismatch or frozen intake mismatch invalidates a seed without dropping its observed data',async()=>{
  const {summarizeGuidanceValidation}=await api(),p=protocol(),values=p.seeds.map(seed=>result(seed));
  values[0].mappings.native.restoreExact=false;values[1].training.frozen.teachingMatched=false;
  const s=summarizeGuidanceValidation(values,p);
  assert.equal(s.mappings.native.positiveSeeds,14);assert.equal(s.mappings.native.observations[0].learnedPreference,.5);
  assert.ok(s.mappings.native.observations[0].failures.some(x=>/restore/.test(x)));
  assert.throws(()=>summarizeGuidanceValidation([...values,values[0]],p),/duplicate/i);
});

test('twelve positive seeds alone cannot bypass mean improvement or a failing swapped mapping',async()=>{
  const {summarizeGuidanceValidation}=await api(),p=protocol(),values=p.seeds.map(seed=>result(seed,.1,0));
  assert.equal(summarizeGuidanceValidation(values,p).predeclaredCriteriaMet,false);
  for(const row of values){row.mappings.native.learned.tailPreferenceTarget=.6;row.mappings.native.restored.tailPreferenceTarget=.6;
    row.mappings.swapped.learned.tailPreferenceTarget=-.2;row.mappings.swapped.restored.tailPreferenceTarget=-.2;}
  const s=summarizeGuidanceValidation(values,p);assert.equal(s.mappings.native.criteriaMet,true);
  assert.equal(s.mappings.swapped.criteriaMet,false);assert.equal(s.predeclaredCriteriaMet,false);
});

test('frozen natural body differences are reported without pretending that its history is a q-only matched clone',async()=>{
  const {summarizeGuidanceValidation}=await api(),p=protocol(),values=p.seeds.map(seed=>result(seed));
  values[0].training.frozen.postStateDifference={positionMetres:.2,originalBrainMatched:false,mbActivityMatched:false};
  const s=summarizeGuidanceValidation(values,p);
  assert.equal(s.mappings.native.observations[0].valid,true);
  assert.equal(s.mappings.native.observations[0].frozenPhysicalDifferences.positionMetres,.2);
});

test('an explicit run lock is required before any future animal execution can be enabled',async()=>{
  const {requireGuidanceRunLock,guidanceHash}=await api(),p=protocol();
  assert.throws(()=>requireGuidanceRunLock(null,p),/approval|lock/i);
  assert.throws(()=>requireGuidanceRunLock({rootApproved:true,protocolSHA256:'wrong',sourceHashes:{}},p),/approval|lock/i);
  const lock={rootApproved:true,protocolSHA256:guidanceHash(p),approvedAt:'fixture-only',sourceHashes:{'fixture-only':'0'.repeat(64)}};
  assert.equal(requireGuidanceRunLock(lock,p).rootApproved,true);
});

test('branch plan shares paired checkpoints for learned/erased/restored and retains frozen own history for both layouts',async()=>{
  const {buildGuidanceBranches}=await api();
  assert.equal(typeof buildGuidanceBranches,'function');
  const specs=buildGuidanceBranches(protocol(),'B',[0,1,2],[1,2,3]);
  assert.equal(specs.length,8);
  for(const spec of specs){assert.equal(spec.anchor,spec.condition==='frozen'?'frozen':'paired');
    const center=spec.condition==='frozen'?[1,2,3]:[0,1,2];
    assert.equal(spec.positions.A[1],center[1]);assert.equal(spec.positions.B[2],center[2]);
    assert.ok(Math.abs(spec.positions.A[0]-center[0])===.65||Math.abs(Math.abs(spec.positions.A[0]-center[0])-.65)<1e-12);}
});

test('live auxiliary caches and observer state are deep copied without sharing Map or typed-array storage',async()=>{
  const {copyGuidanceAuxiliary}=await api();
  assert.equal(typeof copyGuidanceAuxiliary,'function');
  const source={neural:{landingSearchCache:new Map([['surface',{offsets:new Float64Array([1,2])}]]),
    frame:{at:123,inputs:[.3]},paused:false,error:null,metrics:{counts:new Uint16Array([3,4]),windowMs:40,sequence:5}}};
  const target={neural:{metrics:{counts:new Uint16Array(2)}}};copyGuidanceAuxiliary(source,target);
  target.neural.landingSearchCache.get('surface').offsets[0]=9;target.neural.metrics.counts[0]=8;
  assert.equal(source.neural.landingSearchCache.get('surface').offsets[0],1);assert.equal(source.neural.metrics.counts[0],3);
  assert.deepEqual(target.neural.frame,source.neural.frame);assert.equal(target.neural.metrics.sequence,5);
});

test('source closure follows static runtime imports and numeric assets but excludes unrelated coop UI',async()=>{
  const {collectGuidanceClosure,verifyGuidanceHashes}=await api();
  assert.equal(typeof collectGuidanceClosure,'function');
  const root=mkdtempSync(join(tmpdir(),'guidance-closure-'));mkdirSync(join(root,'src'));
  writeFileSync(join(root,'src','entry.mjs'),"import './body.mjs'; const asset=new URL('./mesh.bin',import.meta.url);\n");
  writeFileSync(join(root,'src','body.mjs'),"export {value} from './cells.mjs';\n");
  writeFileSync(join(root,'src','cells.mjs'),'export const value=1;\n');writeFileSync(join(root,'src','mesh.bin'),'numeric-asset');
  writeFileSync(join(root,'src','coop-ui.mjs'),'unrelated');
  const closure=collectGuidanceClosure({root,entrypoints:['src/entry.mjs'],manifests:[]});
  assert.equal(Object.keys(closure.sourceHashes).length,4);assert.equal(closure.sourceHashes['src/coop-ui.mjs'],undefined);
  assert.equal(verifyGuidanceHashes(closure).pass,true);
  writeFileSync(join(root,'src','mesh.bin'),'changed');assert.equal(verifyGuidanceHashes(closure).pass,false);
});

test('natural training stop never manufactures intake and interrupted evidence is never selected away',async()=>{
  const {guidanceTrainingDecision,guidanceResumePlan}=await api();
  assert.equal(typeof guidanceTrainingDecision,'function');
  assert.equal(guidanceTrainingDecision(11.98,2,2).done,false);
  assert.equal(guidanceTrainingDecision(12,2,2).done,true);
  assert.equal(guidanceTrainingDecision(12,3,2).failure,null,'Paired minimum-two teaching may naturally overshoot before the minimum time');
  assert.equal(guidanceTrainingDecision(12,3,2,{exact:true}).failure,'teaching-yoke-overshoot');
  assert.equal(guidanceTrainingDecision(30,1,2).failure,'insufficient-real-intake');
  const resume=guidanceResumePlan([9300,9301,9302],new Set([9300]),new Set([9301]));
  assert.deepEqual(resume.completed,[9300]);assert.deepEqual(resume.interrupted,[9301]);assert.deepEqual(resume.pending,[9302]);
});

test('replay hashes retain original pending inputs, live MB traces and geometry-cache contents while ignoring wall-clock frame time',async()=>{
  const {guidanceRuntimeHashes}=await api();
  const circuit=()=>({v:new Float64Array([1]),g:new Float64Array([2]),refractory:new Float64Array([0]),eligibility:new Float64Array([.3]),
    dopamine:new Float64Array([.2]),queue:[[]],step:1,seed:1,frozen:false,q:new Float64Array([1])});
  const learning={circuit:circuit(),probe:circuit(),serializeWeights(){return {efficacy:[1]};},readouts:{},readoutWeights:null,lastReadoutMs:-Infinity};
  const sim={state:{actor:{position:[0,1,0]},synapticMemory:{efficacy:[1]}},neural:{learning,
    landingSearchCache:new Map([['a',{next:1}]]),frame:{at:1,inputs:[.3]},metrics:{counts:new Uint16Array([1]),windowMs:40,sequence:1},
    pending:{inputs:[.3],steps:80},serialize(){return {rng:1,pending:structuredClone(this.pending)};}}};
  const a=guidanceRuntimeHashes(sim);sim.neural.frame.at=2;assert.equal(guidanceRuntimeHashes(sim).replay,a.replay);
  sim.neural.pending.inputs[0]=.4;assert.notEqual(guidanceRuntimeHashes(sim).originalBrain,a.originalBrain);sim.neural.pending.inputs[0]=.3;
  learning.circuit.eligibility[0]=.4;assert.notEqual(guidanceRuntimeHashes(sim).mbActivity,a.mbActivity);learning.circuit.eligibility[0]=.3;
  sim.neural.landingSearchCache.get('a').next=2;assert.notEqual(guidanceRuntimeHashes(sim).geometryCache,a.geometryCache);
});
