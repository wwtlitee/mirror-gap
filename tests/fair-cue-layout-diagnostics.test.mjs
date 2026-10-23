import test from 'node:test';
import assert from 'node:assert/strict';

async function api(){let result;try{result=await import('../scripts/diagnose-fair-cue-layout.mjs');}catch{}
  assert.equal(typeof result?.declareFairLayout,'function','A predeclared fair stimulus diagnostic must exist before interpreting a symmetric-choice observation');return result;}

test('layout uses only the actual checkpoint position, fixed X axis and equal .65 metre offsets',async()=>{
  const {declareFairLayout,validateFairOptions}=await api(),center=[-3,1.1,2.3];
  const layout=declareFairLayout(center);
  assert.deepEqual(layout.left,[-3.65,1.1,2.3]);assert.deepEqual(layout.right,[-2.35,1.1,2.3]);
  assert.deepEqual(layout.center,center);assert.deepEqual(center,[-3,1.1,2.3]);
  assert.equal(validateFairOptions({}).trainingSeconds,12);assert.equal(validateFairOptions({}).probeSeconds,8);
  for(const invalid of [{seed:6100},{seed:8402},{axis:'z'},{offset:.7},{trainingSeconds:20},{probeSeconds:20}])
    assert.throws(()=>validateFairOptions(invalid),/fixed|seed|axis|offset|training|probe/i);
  assert.throws(()=>declareFairLayout([0,NaN,0]),/position/i);
});

function rows(){return Array.from({length:401},(_,i)=>{const t=i*.02;return {t,
  learned:{distanceA:t<=4?2:.5,distanceB:t<=4?.5:2,neutralProjected:true,
    motorWorld:[-1,0,0],rawNeutralForce:[-1,0,0],velocity:[-.1,0,0]},
  erased:{distanceA:1,distanceB:1,neutralProjected:false,motorWorld:[0,0,0],rawNeutralForce:[0,0,0],velocity:[0,0,0]}};});}

test('tail preference uses the predeclared last four seconds and retains q control and direction evidence',async()=>{
  const {summarizeFairProbe}=await api(),summary=summarizeFairProbe(rows());
  assert.equal(summary.tailSamples,200);assert.ok(Math.abs(summary.learned.tailPreferenceA-.6)<1e-12);
  assert.equal(summary.erased.tailPreferenceA,0);assert.ok(Math.abs(summary.tailQDifference-.6)<1e-12);
  assert.equal(summary.learned.motorForceAlignment,1);assert.equal(summary.learned.projectedSamples,401);
  assert.equal(summary.scientificLearningSuccess,null);
});

test('opposite motor direction and preference failure remain explicit diagnostic outcomes',async()=>{
  const {summarizeFairProbe}=await api(),trace=rows();
  for(const row of trace){row.learned.distanceA=2;row.learned.distanceB=.5;row.learned.motorWorld=[1,0,0];}
  const summary=summarizeFairProbe(trace);
  assert.ok(summary.learned.tailPreferenceA<0);assert.equal(summary.learned.motorForceAlignment,-1);
  assert.equal(summary.learned.tailPrefersA,false);
  assert.equal(summary.scientificLearningSuccess,null);
});

test('PN overlap reports shared input cells without labeling the unpaired cue as zero',async()=>{
  const {auditPNPatterns}=await api();
  assert.equal(typeof auditPNPatterns,'function','PN overlap must be measured from actual pattern vectors');
  const result=auditPNPatterns({A:[1,1,0,0],B:[0,1,1,0]},[0,1,2,3]);
  assert.equal(result.activeA,2);assert.equal(result.activeB,2);assert.equal(result.intersection,1);
  assert.equal(result.jaccard,1/3);assert.equal(result.sharedFractionA,.5);
});

test('KC audit uses q=1 as a neural negative control and never mutates the living association circuit',async()=>{
  const {auditKCGeneralization}=await api();
  assert.equal(typeof auditKCGeneralization,'function','KC generalization must be measured with identical readout seeds');
  const {NeutralOdorLearning}=await import('../src/neutral-odor-learning.mjs'),learning=new NeutralOdorLearning({seed:8401});
  const before=learning.circuit.step,weights=learning.serializeWeights().efficacy;
  const result=auditKCGeneralization(learning,weights);
  assert.equal(result.changedSynapses,0);assert.equal(result.depressedPlasticKCs,0);
  for(const odor of ['A','B'])assert.equal(result.readouts[odor].trainedRateMBON,result.readouts[odor].untrainedRateMBON);
  assert.equal(learning.circuit.step,before);assert.deepEqual(learning.serializeWeights().efficacy,weights);
});
