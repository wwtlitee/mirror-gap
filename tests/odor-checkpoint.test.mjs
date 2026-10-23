import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createCompanion} from '../public/companion-identity.mjs';
import {
  companionCheckpoint,restoreCompanion,validateCompanionCheckpoint,
  parseCompanionCheckpoint,writeCompanionStorage,COMPANION_STORAGE_KEY,
  MAX_CHECKPOINT_BYTES,
} from '../public/companion-checkpoint.mjs';

// v8.2.0: durable association memory contains synaptic efficacy only.
const GRAPH_HASH='0b5de2a6c6b6d6265830ec91a65c8a5d11688ef01ba96c63bf75d239d4d89e3f';
const template=new EmbodiedLife().state;
template.companion=createCompanion({seed:'0123456789abcdef0123456789abcdef',now:1000});
const fresh=()=>structuredClone(template);
const memory=()=>({format:1,modelVersion:'0.0.1a',graphHash:GRAPH_HASH,
  efficacy:Array.from({length:946},(_,i)=>i===0?.05:i===945?1:.5)});
const checkpoint=()=>({...companionCheckpoint(fresh()),synapticMemory:memory()});

test('a backup contains an independent copy of the 946 learned efficacies',()=>{
  const state=fresh();state.synapticMemory=memory();
  const saved=companionCheckpoint(state);
  assert.ok(saved.synapticMemory,'backup must include learned weights');
  assert.deepEqual(saved.synapticMemory,state.synapticMemory);
  assert.notEqual(saved.synapticMemory,state.synapticMemory);
  assert.notEqual(saved.synapticMemory.efficacy,state.synapticMemory.efficacy);
  state.synapticMemory.efficacy[1]=.9;
  assert.equal(saved.synapticMemory.efficacy[1],.5);
  assert.equal(Object.hasOwn(saved.synapticMemory,'v'),false);
});

test('JSON backup restore retains learned weights without restoring membrane state',()=>{
  const saved=JSON.parse(JSON.stringify(checkpoint())),state=fresh();
  restoreCompanion(state,saved);
  assert.ok(state.synapticMemory,'restore must expose learned weights');
  assert.deepEqual(state.synapticMemory,saved.synapticMemory);
  assert.notEqual(state.synapticMemory,saved.synapticMemory);
  assert.notEqual(state.synapticMemory.efficacy,saved.synapticMemory.efficacy);
  saved.synapticMemory.efficacy[1]=.8;
  assert.equal(state.synapticMemory.efficacy[1],.5);
  assert.equal(Object.hasOwn(state,'neural'),false);
});

test('old backups without neural learning remain valid and clear a stale learned state',()=>{
  const legacy=fresh();delete legacy.synapticMemory;
  const saved=companionCheckpoint(legacy),state=fresh();state.synapticMemory=memory();
  assert.equal(Object.hasOwn(saved,'synapticMemory'),false);
  assert.doesNotThrow(()=>validateCompanionCheckpoint(saved));
  restoreCompanion(state,saved);
  assert.equal(Object.hasOwn(state,'synapticMemory'),false);
});

const invalidMemories=[
  ['null',()=>null],['undefined',()=>undefined],['array',()=>[]],
  ['format',value=>({...value,format:2})],
  ['model version',value=>({...value,modelVersion:'0.0.1'})],
  ['graph hash',value=>({...value,graphHash:'a'.repeat(64)})],
  ['weight count',value=>({...value,efficacy:value.efficacy.slice(1)})],
  ['sparse weight array',value=>{delete value.efficacy[2];return value;}],
  ['below floor',value=>{value.efficacy[2]=.049;return value;}],
  ['above ceiling',value=>{value.efficacy[2]=1.001;return value;}],
  ['nonfinite weight',value=>{value.efficacy[2]=NaN;return value;}],
  ['string weight',value=>{value.efficacy[2]='.5';return value;}],
  ['extra transient state',value=>({...value,v:[-52]})],
];
for(const [label,change] of invalidMemories)test(`present synaptic memory rejects ${label} before restoring any body state`,()=>{
  const saved=companionCheckpoint(fresh());saved.synapticMemory=change(memory());
  const state=fresh();state.synapticMemory=memory();const before=structuredClone(state);
  assert.throws(()=>validateCompanionCheckpoint(saved),/突触/);
  assert.throws(()=>restoreCompanion(state,saved),/突触/);
  assert.deepEqual(state,before);
});

test('creating a backup rejects a present but invalid runtime memory',()=>{
  const state=fresh();state.synapticMemory=memory();state.synapticMemory.efficacy[8]=Infinity;
  assert.throws(()=>companionCheckpoint(state),/突触/);
});

test('the existing byte limit includes learned weights and still rejects oversized imports',()=>{
  const saved=checkpoint(),text=JSON.stringify(saved);
  assert.ok(new TextEncoder().encode(text).length<MAX_CHECKPOINT_BYTES);
  assert.deepEqual(parseCompanionCheckpoint(text).synapticMemory,memory());
  const oversized={...saved,padding:'x'.repeat(MAX_CHECKPOINT_BYTES)};
  assert.throws(()=>validateCompanionCheckpoint(oversized),/过大/);
});

test('an invalid learned backup cannot overwrite the preceding local save',()=>{
  const map=new Map(),storage={getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};
  const saved=checkpoint();writeCompanionStorage(storage,saved);
  const previous=storage.getItem(COMPANION_STORAGE_KEY),invalid=structuredClone(saved);
  invalid.synapticMemory.efficacy[8]=-1;
  assert.throws(()=>writeCompanionStorage(storage,invalid,{backup:true}),/突触/);
  assert.equal(storage.getItem(COMPANION_STORAGE_KEY),previous);
});
