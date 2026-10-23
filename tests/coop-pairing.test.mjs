import test from 'node:test';
import assert from 'node:assert/strict';
import {SYNAPTIC_MODEL_VERSION,SYNAPTIC_GRAPH_HASH,SYNAPTIC_WEIGHT_COUNT} from '../public/synaptic-memory-schema.mjs';

const api=()=>import('../public/coop-pairing.mjs');
const weights=(q=1)=>({format:1,modelVersion:SYNAPTIC_MODEL_VERSION,graphHash:SYNAPTIC_GRAPH_HASH,efficacy:Array(SYNAPTIC_WEIGHT_COUNT).fill(q)});
const cue=(odor='A',intensity=.8)=>({id:'cue-mechanical',odor,intensity,distance:.2,position:[0,0,0],kind:'neutral-odor'});
const sample=(state,extra={})=>({simSeconds:state.lastSimSeconds+.02,seconds:.02,consumedDelta:0,rewardPulseDelta:0,
  rewardWindowRemainingMs:0,actualOdor:'off',cueSamples:[],weights:structuredClone(state.lastWeights),frozen:false,rewardEnabled:true,...extra});
async function tick(state,extra={}){return(await api()).advanceCoopPairing(state,sample(state,extra));}
async function completePair(state,{q=.9,odor='A',intensity=.8}={}){
  let result=await tick(state,{consumedDelta:.001,rewardPulseDelta:1,rewardWindowRemainingMs:230,actualOdor:odor,cueSamples:[cue(odor,intensity)],weights:weights(q)});
  for(let remaining=210;remaining>=0;remaining-=20)result=await tick(result.state,{rewardWindowRemainingMs:remaining,weights:weights(q)});
  if(result.state.pending)result=await tick(result.state,{rewardWindowRemainingMs:0,weights:weights(q)});
  return result.state;
}
async function until(state,time){let result;while(state.lastSimSeconds<time-1e-8){result=await tick(state);state=result.state;}return result??{state,receipt:null};}

test('A and real consumption arriving inside an actual food reward window are counted',async()=>{
  const {createCoopPairing}=await api();let state=createCoopPairing({simSeconds:0,weights:weights()});
  state=(await tick(state,{consumedDelta:.001,rewardPulseDelta:1,rewardWindowRemainingMs:230})).state;
  assert.equal(state.pending,null);assert.equal(state.counts.qualifiedPulses,0);
  state=(await tick(state,{consumedDelta:.001,rewardWindowRemainingMs:210,actualOdor:'A',cueSamples:[cue()],weights:weights(.99)})).state;
  assert.equal(state.counts.qualifiedPulses,1);assert.ok(state.pending);
  for(let remaining=190;remaining>=10;remaining-=20)state=(await tick(state,{rewardWindowRemainingMs:remaining})).state;
  state=(await tick(state)).state;
  assert.equal(state.pairedPulses,1);assert.ok(state.changedSynapses>0);
});

test('reward provenance, current eating and an unexpired reward window are all required',async()=>{
  const {createCoopPairing}=await api();
  let state=createCoopPairing({simSeconds:0,weights:weights()});
  state=(await tick(state,{consumedDelta:.001,rewardWindowRemainingMs:210,actualOdor:'A',cueSamples:[cue()],weights:weights(.99)})).state;
  assert.equal(state.pending,null); // A nonzero timer without a witnessed teaching event is not evidence.
  state=createCoopPairing({simSeconds:0,weights:weights()});
  state=(await tick(state,{consumedDelta:.001,rewardPulseDelta:1,rewardWindowRemainingMs:230})).state;
  state=(await tick(state,{rewardWindowRemainingMs:210,actualOdor:'A',cueSamples:[cue()],weights:weights(.99)})).state;
  assert.equal(state.pending,null); // Smelling after eating stopped does not satisfy this gameplay protocol.
  for(let remaining=190;remaining>=10;remaining-=20)state=(await tick(state,{rewardWindowRemainingMs:remaining})).state;
  state=(await tick(state,{consumedDelta:.001,actualOdor:'A',cueSamples:[cue()],weights:weights(.98)})).state;
  assert.equal(state.pending,null);assert.equal(state.pairedPulses,0);
});

test('a B interruption or a real load cannot recycle an unqualified reward window',async()=>{
  const {createCoopPairing,restoreCoopPairing}=await api();
  for(const operation of ['B','load']){
    let state=createCoopPairing({simSeconds:0,weights:weights()});
    state=(await tick(state,{consumedDelta:.001,rewardPulseDelta:1,rewardWindowRemainingMs:230})).state;
    if(operation==='load')state=restoreCoopPairing(state);
    else state=(await tick(state,{rewardWindowRemainingMs:210,actualOdor:'B',cueSamples:[cue('B')]})).state;
    state=(await tick(state,{consumedDelta:.001,rewardWindowRemainingMs:operation==='load'?210:190,actualOdor:'A',cueSamples:[cue()],weights:weights(.99)})).state;
    assert.equal(state.pending,null);assert.equal(state.counts.qualifiedPulses,0);
  }
});

test('existing 8.5 saves without a reward candidate remain readable',async()=>{
  const {createCoopPairing,restoreCoopPairing}=await api();const old=createCoopPairing({simSeconds:0,weights:weights()});
  delete old.rewardCandidate;const restored=restoreCoopPairing(old);assert.equal(restored.rewardCandidate,null);
});

test('two real A pairings, newly changed q,12 natural seconds and a closed reward window produce exactly one director receipt',async()=>{
  const {createCoopPairing}=await api();let state=createCoopPairing({simSeconds:40,weights:weights(.95)});
  state=await completePair(state);state=(await until(state,43)).state;state=await completePair(state,{q:.8});
  assert.equal(state.pairedPulses,2);assert.equal(state.pairedConsumption,.002);assert.equal(state.receipt,null);
  const result=await until(state,52.04);
  assert.equal(result.state.receipt.type,'pairedLearning');assert.equal(result.state.receipt.odor,'A');
  assert.equal(result.state.receipt.teachingEvents,2);assert.equal(result.state.receipt.consumedAmount,.002);
  assert.ok(result.state.receipt.elapsed>=12);assert.ok(result.state.receipt.changedSynapses>0);
  assert.equal((await tick(result.state)).receipt,null);
});

test('B, distant or boundary A, old q and consumption without a pulse cannot manufacture progress',async()=>{
  const {createCoopPairing}=await api();
  for(const [odor,intensity]of[['B',.9],['A',.49],['A',.5]]){
    const state=createCoopPairing({simSeconds:0,weights:weights(.8)}),r=await tick(state,{consumedDelta:.01,rewardPulseDelta:1,
      rewardWindowRemainingMs:230,actualOdor:odor,cueSamples:[cue(odor,intensity)],weights:weights(.7)});
    assert.equal(r.state.pairedPulses,0);assert.equal(r.state.pending,null);
  }
  let state=createCoopPairing({simSeconds:0,weights:weights(.8)});
  state=(await tick(state,{consumedDelta:.01,actualOdor:'A',cueSamples:[cue()]})).state;assert.equal(state.pending,null);
  state=await completePair(state,{q:.8});state=await completePair(state,{q:.8});state=(await until(state,13)).state;
  assert.equal(state.changedSynapses,0);assert.equal(state.receipt,null);
});

test('near B, frozen plasticity or disabled rewards invalidate an unfinished A window; normal off gaps remain eligible',async()=>{
  const {createCoopPairing}=await api();
  for(const interruption of [{actualOdor:'B',cueSamples:[cue('B')]},{frozen:true},{rewardEnabled:false}]){
    let state=createCoopPairing({simSeconds:0,weights:weights()});
    state=(await tick(state,{consumedDelta:.001,rewardPulseDelta:1,rewardWindowRemainingMs:230,actualOdor:'A',cueSamples:[cue()],weights:weights(.9)})).state;
    state=(await tick(state,{rewardWindowRemainingMs:210,...interruption,weights:weights(.8)})).state;
    assert.equal(state.pending,null);assert.equal(state.counts.interruptedPairs,1);assert.equal(state.pairedPulses,0);
  }
  const clean=await completePair(createCoopPairing({simSeconds:0,weights:weights()}));
  assert.equal(clean.pairedPulses,1);assert.equal(clean.counts.interruptedPairs,0);
});

test('load discards only unfinished pairing, never treats reset runtime clocks as natural completion, and preserves confirmed history',async()=>{
  const {createCoopPairing,restoreCoopPairing}=await api();
  let state=await completePair(createCoopPairing({simSeconds:0,weights:weights()}));
  state=(await tick(state,{consumedDelta:.001,rewardPulseDelta:1,rewardWindowRemainingMs:230,actualOdor:'A',cueSamples:[cue()],weights:weights(.8)})).state;
  const saved=JSON.stringify(state),restored=restoreCoopPairing(JSON.parse(saved));
  assert.equal(JSON.stringify(state),saved);assert.equal(restored.pairedPulses,1);assert.equal(restored.pending,null);
  assert.equal(restored.counts.interruptedOnLoad,1);assert.equal(restored.reloadNeedsFreshWindow,true);
  state=(await until(restored,13)).state;assert.equal(state.receipt,null);
  state=await completePair(state,{q:.7});assert.equal(state.pairedPulses,2);assert.equal(state.reloadNeedsFreshWindow,false);
  assert.equal(state.receipt.type,'pairedLearning');
});

test('B-only q changes in the current segment cannot satisfy A learning evidence',async()=>{
  const {createCoopPairing}=await api();let state=createCoopPairing({simSeconds:0,weights:weights()});
  state=(await tick(state,{actualOdor:'B',cueSamples:[cue('B')],weights:weights(.8)})).state;
  state=await completePair(state,{q:.8});state=await completePair(state,{q:.8});state=(await until(state,13)).state;
  assert.equal(state.pairedPulses,2);assert.equal(state.changedSynapses,0);assert.equal(state.receipt,null);
});

test('save/input validation rejects holes, forged counts, backwards time and unsupported absolute runtime counters without mutating input',async()=>{
  const {createCoopPairing,restoreCoopPairing,advanceCoopPairing}=await api(),state=createCoopPairing({simSeconds:0,weights:weights()});
  const raw=JSON.stringify(state);
  for(const mutation of [s=>s.pairedPulses++,s=>s.baselineWeights.efficacy.pop(),s=>s.counts.interruptedPairs++,s=>s.elapsed=12]){
    const bad=structuredClone(state);mutation(bad);assert.throws(()=>restoreCoopPairing(bad));
  }
  assert.throws(()=>advanceCoopPairing(state,sample(state,{simSeconds:-1})));
  assert.throws(()=>advanceCoopPairing(state,{...sample(state),rewardPulses:100}));
  assert.equal(JSON.stringify(state),raw);
});

test('a floating point value just below12 seconds cannot emit a director receipt claiming12 seconds',async()=>{
  const {createCoopPairing}=await api();let state=await completePair(createCoopPairing({simSeconds:0,weights:weights()}));
  state=await completePair(state,{q:.8});state=(await until(state,12)).state;
  const endpoint=state.firstPairedAt+12-1e-9,result=await tick(state,{simSeconds:endpoint,seconds:endpoint-state.lastSimSeconds});
  assert.ok(result.state.elapsed<12);assert.equal(result.receipt,null);
  assert.ok((await tick(result.state)).receipt.elapsed>=12);
});

test('pending save time must match the measured remaining reward window and runtime reset requires an explicit load',async()=>{
  const {createCoopPairing,restoreCoopPairing,advanceCoopPairing}=await api();
  const fresh=createCoopPairing({simSeconds:0,weights:weights()}),state=(await tick(fresh,{consumedDelta:.001,rewardPulseDelta:1,
    rewardWindowRemainingMs:230,actualOdor:'A',cueSamples:[cue()],weights:weights(.9)})).state;
  const bad=structuredClone(state);bad.pending.expectedEndSimSeconds+=.001;
  assert.throws(()=>restoreCoopPairing(bad));
  assert.throws(()=>advanceCoopPairing(state,sample(state)));
  assert.equal(state.pending.changedIndices.length,SYNAPTIC_WEIGHT_COUNT);
});
