import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';

const moduleUrl=new URL('../src/mushroom-circuit.mjs',import.meta.url);
const graphUrl=new URL('../src/mushroom-connectome.json',import.meta.url);
const fixture=JSON.parse(readFileSync(new URL('./fixtures/mushroom-python-0.0.1a.json',import.meta.url),'utf8'));
const api=()=>import(moduleUrl);
const close=(actual,expected,tolerance=2e-11)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected}`);
const pattern=(circuit,index)=>{const values=new Float64Array(circuit.n);for(const i of fixture.patterns[index])values[i]=1;return values;};

test('mushroom learning module exists as a separate circuit preserving the original motor brain',()=>{
  assert.ok(existsSync(moduleUrl),'Independent mushroom learning circuit has not been implemented');
});

test('derived graph preserves source identities and exact audited data fingerprints',async()=>{
  const {MushroomCircuit}=await api(),c=new MushroomCircuit();
  const raw=readFileSync(graphUrl),graph=JSON.parse(raw);
  assert.equal(createHash('sha256').update(raw).digest('hex'),fixture.derivedFileSHA256);
  assert.equal(graph.sourceGraphHash,fixture.sourceGraphHash);
  assert.equal(c.n,1259);assert.equal(c.pnIndices.length,147);assert.equal(c.plasticEdges.length,946);
  assert.equal(c.weights.length,73304);
  assert.ok(graph.payload.roots.every(value=>typeof value==='string'&&/^\d{18}$/.test(value)));
});

test('two-word counter random numbers match independent Python uint64 fixtures exactly',async()=>{
  const {counterUniform}=await api();
  for(const item of fixture.uniform)assert.equal(counterUniform(item.seed,item.step,item.neuron),item.value);
});

test('actual graph LIF spikes, membrane, modulation and synaptic changes match Python segments',async()=>{
  const {MushroomCircuit}=await api(),c=new MushroomCircuit({seed:fixture.seed});
  for(const segment of fixture.segments){
    const r=c.advance(segment.milliseconds,{odor:segment.odor===null?null:pattern(c,segment.odor),reward:segment.reward});
    assert.deepEqual([...r.counts],segment.counts);close(r.rateMBON,segment.rateMBON);close(r.gate,segment.gate);
    segment.q.forEach((value,i)=>close(c.q[c.plasticEdges[i]],value));
    segment.v.forEach((value,i)=>close(c.v[i*79],value,1e-9));
    segment.g.forEach((value,i)=>close(c.g[i*79],value,1e-9));
  }
});

test('subdividing simulation preserves spike counts, dynamics and learning exactly',async()=>{
  const {MushroomCircuit}=await api(),whole=new MushroomCircuit({seed:17}),split=new MushroomCircuit({seed:17});
  const odor=pattern(whole,0),a=whole.advance(250,{odor,reward:true});
  const b=split.advance(50,{odor,reward:true}),d=split.advance(200,{odor,reward:true});
  assert.deepEqual([...a.counts],[...b.counts].map((n,i)=>n+d.counts[i]));
  assert.deepEqual([...whole.q],[...split.q]);assert.deepEqual([...whole.v],[...split.v]);
});

test('reward with odor changes only anatomically identified plastic connections',async()=>{
  const {MushroomCircuit}=await api(),c=new MushroomCircuit({seed:11000});
  c.advance(500,{odor:pattern(c,0),reward:true});
  const plastic=new Set(c.plasticEdges);let learned=0;
  for(let i=0;i<c.q.length;i++)if(plastic.has(i)){if(c.q[i]<1)learned++;}else assert.equal(c.q[i],1);
  assert.ok(learned>0);assert.ok(c.q.every(value=>value>=.05&&value<=1));
});

test('continuous odor without actual reward does not write synaptic memory',async()=>{
  const {MushroomCircuit}=await api(),c=new MushroomCircuit({seed:11000});
  for(let i=0;i<20;i++)c.advance(500,{odor:pattern(c,i%2)});
  assert.ok(c.q.every(value=>value===1));
});

test('frozen or explicitly disabled plasticity preserves every weight despite PAM reward',async()=>{
  const {MushroomCircuit}=await api();
  for(const frozen of [true,false]){
    const c=new MushroomCircuit({frozen});
    c.advance(500,{odor:pattern(c,0),reward:true,learn:frozen});
    assert.ok(c.q.every(value=>value===1));
  }
});

test('weight checkpoint has no activity, position, odor preference table or nonplastic weights',async()=>{
  const {MushroomCircuit}=await api(),c=new MushroomCircuit();
  const saved=c.serializeWeights();
  assert.deepEqual(Object.keys(saved).sort(),['efficacy','format','graphHash','modelVersion']);
  assert.equal(saved.format,1);assert.equal(saved.modelVersion,'0.0.1a');
  assert.equal(saved.graphHash,fixture.sourceGraphHash);assert.equal(saved.efficacy.length,946);
});

test('restoring weights clears all transient neural state and preserves the learned weights',async()=>{
  const {MushroomCircuit}=await api(),c=new MushroomCircuit({seed:11000});
  c.advance(500,{odor:pattern(c,0),reward:true});const saved=c.serializeWeights();
  c.restoreWeights(saved);
  assert.deepEqual(c.serializeWeights(),saved);assert.equal(c.step,0);
  assert.ok(c.v.every(value=>value===-52));assert.ok(c.g.every(value=>value===0));
  assert.ok(c.eligibility.every(value=>value===0));assert.ok(c.dopamine.every(value=>value===0));
  assert.ok(c.queue.every(values=>values.length===0));
});

test('invalid weight restore is atomic and rejects corruption or incompatible data',async()=>{
  const {MushroomCircuit}=await api(),c=new MushroomCircuit({seed:11000});
  c.advance(250,{odor:pattern(c,0),reward:true});const before=c.serializeWeights(),v=[...c.v],step=c.step;
  const invalid=[{...before,graphHash:'wrong'},{...before,efficacy:before.efficacy.slice(1)},
    {...before,efficacy:before.efficacy.map((n,i)=>i===2?NaN:n)},
    {...before,efficacy:before.efficacy.map((n,i)=>i===2?.049:n)},
    {...before,efficacy:before.efficacy.map((n,i)=>i===2?1.01:n)}, {...before,v:[]}];
  for(const saved of invalid){assert.throws(()=>c.restoreWeights(saved));assert.deepEqual(c.serializeWeights(),before);assert.deepEqual([...c.v],v);assert.equal(c.step,step);}
});

test('weight-only memory changes neural odor response and erasure restores baseline',async()=>{
  const {MushroomCircuit}=await api(),c=new MushroomCircuit();
  const probe=()=>[0,1].map(index=>{let sum=0;for(let repeat=0;repeat<3;repeat++){c.resetActivity();sum+=c.advance(500,{odor:pattern(c,index),seed:211000+repeat*3+index,learn:false}).rateMBON/3;}return sum;});
  const before=probe();
  const saved=c.serializeWeights();saved.efficacy=[...fixture.trainedSeed1000.q];c.restoreWeights(saved);
  const after=probe();assert.ok(after[0]<before[0]-10,'Training should suppress rewarded-odor MBON avoidance output');
  const fresh=new MushroomCircuit();fresh.restoreWeights(c.serializeWeights());
  c.restoreWeights({...saved,efficacy:Array(946).fill(1)});assert.deepEqual(probe(),before);
  c.restoreWeights(fresh.serializeWeights());assert.deepEqual(probe(),after);
});

test('six genuine neural pairing rounds reproduce the independently generated Python weights',async()=>{
  const {MushroomCircuit}=await api(),c=new MushroomCircuit({seed:11000});
  for(let trial=0;trial<6;trial++)for(const odorId of trial%2===0?[0,1]:[1,0]){
    for(const [phase,duration] of [250,250,1000,250,1250].entries()){
      c.advance(duration,{odor:phase<2?pattern(c,odorId):null,reward:odorId===0&&phase===1});
    }
  }
  c.serializeWeights().efficacy.forEach((value,index)=>close(value,fixture.trainedSeed1000.q[index]));
  assert.ok(c.serializeWeights().efficacy.some(value=>value<.9));
});

test('instances share audited anatomy while keeping weights and transient activity independent',async()=>{
  const {MushroomCircuit}=await api(),first=new MushroomCircuit(),second=new MushroomCircuit();
  assert.equal(first.weights,second.weights);assert.equal(first.offsets,second.offsets);
  first.advance(250,{odor:pattern(first,0),reward:true});
  assert.ok(first.q.some(value=>value<1));assert.ok(second.q.every(value=>value===1));
  assert.equal(second.step,0);assert.ok(second.v.every(value=>value===-52));
});

test('malformed stimulus, duration, seed and graph inputs fail before advancing the model',async()=>{
  const {MushroomCircuit}=await api(),c=new MushroomCircuit(),initial=c.serializeWeights();
  for(const duration of [0,-1,NaN,Infinity,.1])assert.throws(()=>c.advance(duration));
  for(const odor of [new Float64Array(147),Array(c.n).fill(NaN),Array(c.n).fill(2)])assert.throws(()=>c.advance(1,{odor}));
  const wrongRole=new Float64Array(c.n);wrongRole[c.roles.findIndex(role=>role===1)]=1;
  assert.throws(()=>c.advance(1,{odor:wrongRole}));assert.throws(()=>c.advance(1,{seed:-1}));
  assert.equal(c.step,0);assert.deepEqual(c.serializeWeights(),initial);
  const graph=JSON.parse(readFileSync(graphUrl));graph.payload.roots[0]=Number(graph.payload.roots[0]);
  assert.throws(()=>new MushroomCircuit({graph}));
});
