import test from 'node:test';
import assert from 'node:assert/strict';
import {VERSION} from '../public/world-spec.mjs';
import {NeutralOdorLearning} from '../src/neutral-odor-learning.mjs';

test('learning telemetry reports the current product release without changing the model version',()=>{
  const snapshot=new NeutralOdorLearning().snapshot();
  assert.equal(snapshot.productVersion,VERSION);
  assert.equal(snapshot.modelVersion,'0.0.1a');
});
