import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';

test('v8.3 full saves retain body and neutral weights when the training-room release opens them',()=>{
  const original=new EmbodiedLife();
  original.state.needs.satiety=37;
  const memory=original.neural.learning.serializeWeights();memory.efficacy[123]=.41;
  original.neural.learning.restoreWeights(memory);
  const saved=original.serialize();saved.version='8.3.0';
  const restored=new EmbodiedLife(saved);
  assert.equal(restored.state.needs.satiety,37);
  assert.equal(restored.neural.learningMode,'neutral');
  assert.deepEqual(restored.neural.learning.serializeWeights(),memory);
  assert.deepEqual(restored.state.actor.position,saved.actor.position);
});
