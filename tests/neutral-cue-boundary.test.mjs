import test from 'node:test';
import assert from 'node:assert/strict';
import {NeutralOdorLearning} from '../src/neutral-odor-learning.mjs';

const cue=id=>({id,odor:'A',position:[0,0,0],strength:1,range:1,enabled:true});
const state={actor:{position:[0,0,0]}};

for(const id of ['looming','screen','nest','resource-burger','water','training-cue','signal-A']){
  test(`neutral emitter rejects an unnamespaced id: ${id}`,()=>{
    const learning=new NeutralOdorLearning();
    assert.throws(()=>learning.setCues([cue(id)]),/气味/,
      'external neutral emitter IDs must start with cue-');
    assert.deepEqual(learning.cues,[]);
    assert.throws(()=>new NeutralOdorLearning({cues:[cue(id)]}),/气味/);
  });
}

test('cue- namespace admits independent emitters without resource or old signal identity',()=>{
  for(const id of ['cue-A','cue-B','cue-training','cue-browser-A','cue-looming','cue-screen']){
    const learning=new NeutralOdorLearning({cues:[cue(id)]}),signals=learning.sense(state);
    assert.equal(signals.length,1);assert.equal(signals[0].id,id);
    assert.equal(signals[0].kind,'neutral-odor');assert.equal(signals[0].neuralValence,0);
    assert.equal(Object.hasOwn(signals[0],'resourceId'),false);
    assert.equal(Object.hasOwn(signals[0],'resourceKind'),false);
  }
});

test('a rejected cue id replacement preserves valid emitters and learned circuit state',()=>{
  const learning=new NeutralOdorLearning({cues:[cue('cue-original')]});
  learning.advance(state,.02);
  const weights=learning.serializeWeights(),clock=learning.clockMs,signals=learning.sense(state);
  assert.throws(()=>learning.setCues([cue('cue-replacement'),cue('screen')]),/气味/);
  assert.deepEqual(learning.serializeWeights(),weights);assert.equal(learning.clockMs,clock);
  assert.deepEqual(learning.sense(state),signals);
});
