import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const loadVerifier=async()=>{
  let module;
  try{module=await import('../scripts/verify-cue-training.mjs');}catch{}
  assert.equal(typeof module?.auditCueTrainingTrace,'function','A raw-trace verifier must exist before using a player-training result');
  return module;
};
const qHash=q=>createHash('sha256').update(JSON.stringify(q)).digest('hex');
const food={apple:100,banana:100,burger:100,pizza:99,fries:100,sandwich:100,fig:100};
function fixture(){
  const initial=Array(946).fill(1),learned=initial.with(0,.9);
  const sample=(time,phase,overrides={})=>({time,phase,position:[-3.6,1.04,1.5],heading:0,
    foods:{...food},homeFood:699/7,frozen:false,rewardEnabled:true,
    consumedAmount:0,rewardPulses:0,ateSeconds:0,qHash:qHash(initial),...overrides});
  const start=sample(1,'probing',{foods:Object.fromEntries(Object.keys(food).map(id=>[id,0])),homeFood:0,
    frozen:true,rewardEnabled:false,consumedAmount:.001,rewardPulses:1,ateSeconds:.02,qHash:qHash(learned)});
  const sourcePositions={left:[-4.25,1.10,1.33],right:[-2.61,1.10,1.33]};
  start.probe={mapping:{left:'A',right:'B'},sourcePositions};
  const dA=Math.hypot(...start.position.map((v,i)=>v-sourcePositions.left[i])),
    dB=Math.hypot(...start.position.map((v,i)=>v-sourcePositions.right[i]));
  const trained=sample(1,'training',{consumedAmount:.001,rewardPulses:1,ateSeconds:.02,qHash:qHash(learned)});
  const record={format:1,productVersion:'8.4.0',seed:8401,stepSeconds:.02,
    claims:{scientificLearningSuccess:null,description:'Interactive approach observation; no baseline comparison.'},
    commands:[{action:'emit',before:sample(0,'training'),after:sample(0,'training')}],
    initialWeights:initial,trainedWeights:learned,
    training:{samples:[sample(0,'training',{foods:{...food,pizza:99.007}}),...Array.from({length:50},(_,i)=>
      ({...trained,time:(i+1)*.02,qHash:i===0?qHash(initial):qHash(learned)}))]},
    probes:[{kind:'native',termination:'automatic',durationSeconds:20,inventoryBefore:{...food},
      flagsBefore:{frozen:false,rewardEnabled:true},weightsBefore:learned,weightsAfter:learned,
      samples:[start,...Array.from({length:999},(_,i)=>({...start,time:1+(i+1)*.02})),
        sample(21,'result',{consumedAmount:.001,rewardPulses:1,ateSeconds:.02,qHash:qHash(learned)})],
      beforeFinish:sample(21,'probing',{...start,time:21}),
      result:{completed:true,aborted:false,elapsed:20,meanDistanceA:dA,meanDistanceB:dB,
        preferenceIndex:(dB-dA)/(dB+dA),trace:[{t:0,position:[...start.position],distanceA:dA,distanceB:dB,preferenceIndex:(dB-dA)/(dB+dA)}]},
      afterFinish:sample(21,'result',{consumedAmount:.001,rewardPulses:1,ateSeconds:.02,qHash:qHash(learned)})}]};
  const swapped=structuredClone(record.probes[0]);swapped.kind='swapped';
  for(const s of swapped.samples){s.time+=20;if(s.probe)s.probe.mapping={left:'B',right:'A'};}
  swapped.beforeFinish.time+=20;swapped.afterFinish.time+=20;
  Object.assign(swapped.result,{meanDistanceA:dB,meanDistanceB:dA,preferenceIndex:(dA-dB)/(dA+dB)});
  Object.assign(swapped.result.trace[0],{distanceA:dB,distanceB:dA,preferenceIndex:(dA-dB)/(dA+dB)});
  const aborted=structuredClone(record.probes[0]);aborted.kind='manual-abort';aborted.termination='abort';
  aborted.samples=aborted.samples.slice(0,101);for(const s of aborted.samples)s.time+=40;
  aborted.beforeFinish={...aborted.samples.at(-1)};aborted.afterFinish.time=43;
  Object.assign(aborted.result,{elapsed:2,completed:false,aborted:true});
  record.probes.push(swapped,aborted);return record;
}

test('raw audit accepts actual intake teaching and a fully frozen food-free timed probe without claiming experimental success',async()=>{
  const {auditCueTrainingTrace}=await loadVerifier(),result=auditCueTrainingTrace(fixture());
  assert.equal(result.pass,true);assert.deepEqual(result.issues,[]);
  assert.equal(result.scientificLearningSuccess,null);
});

test('raw audit rejects reward without same-tick real consumption and premature weight changes',async()=>{
  const {auditCueTrainingTrace}=await loadVerifier(),record=fixture();
  record.training.samples[1].consumedAmount=0;record.training.samples[1].ateSeconds=0;
  record.training.samples[0].qHash=qHash(record.trainedWeights);
  const result=auditCueTrainingTrace(record);
  assert.equal(result.pass,false);assert.match(result.issues.join('\n'),/reward.*consumption/i);
  assert.match(result.issues.join('\n'),/before.*consumption|initial.*weights/i);
});

test('raw audit rejects probe food, PAM, plasticity or weight drift even when final weights are restored',async()=>{
  const {auditCueTrainingTrace}=await loadVerifier(),record=fixture(),probe=record.probes[0];
  probe.samples.splice(1,0,{...probe.samples[0],time:5,foods:{...probe.samples[0].foods,fig:.1},
    rewardPulses:2,frozen:false,qHash:'f'.repeat(64)});
  const result=auditCueTrainingTrace(record);
  assert.equal(result.pass,false);for(const pattern of [/food/i,/reward/i,/frozen/i,/weight/i])assert.match(result.issues.join('\n'),pattern);
});

test('raw audit rejects wrong timeout, stock restoration, body rewind or unsupported learning score',async()=>{
  const {auditCueTrainingTrace}=await loadVerifier(),record=fixture(),probe=record.probes[0];
  probe.samples.at(-1).time=20;probe.afterFinish.foods.pizza=100;probe.afterFinish.position=[0,0,0];
  record.claims.scientificLearningSuccess=true;
  const result=auditCueTrainingTrace(record);
  assert.equal(result.pass,false);for(const pattern of [/20.*second|duration/i,/inventory/i,/body/i,/scientific/i])assert.match(result.issues.join('\n'),pattern);
});

test('the verifier exposes a natural-session runner with bounded pilot options',async()=>{
  const module=await loadVerifier();assert.equal(typeof module.runCueTrainingVerification,'function');
  await assert.rejects(module.runCueTrainingVerification({seed:6100,trainingSeconds:60}),/pilot|held.?out/i);
  await assert.rejects(module.runCueTrainingVerification({seed:8401,trainingSeconds:61}),/20.*60|duration/i);
});

test('raw audit rejects a missing physical tick and consumption counters unsupported by real food-stock loss',async()=>{
  const {auditCueTrainingTrace}=await loadVerifier(),record=fixture();
  record.training.samples[0].foods={...food};record.probes[0].samples.splice(5,1);
  const result=auditCueTrainingTrace(record);assert.equal(result.pass,false);
  assert.match(result.issues.join('\n'),/stock.*consumption|consumption.*stock/i);
  assert.match(result.issues.join('\n'),/20ms|physics.*tick/i);
});

test('raw audit preserves a malformed-run failure instead of throwing away its receipt',async()=>{
  const {auditCueTrainingTrace}=await loadVerifier();
  const result=auditCueTrainingTrace({});assert.equal(result.pass,false);assert.ok(result.issues.length>0);
});

test('raw audit uses seven per-food stock units for one aggregate consumption unit',async()=>{
  const {auditCueTrainingTrace}=await loadVerifier(),record=fixture();
  assert.equal(auditCueTrainingTrace(record).pass,true,'consumeFood subtracts used * FOOD_IDS.length from the selected stock');
});

test('raw audit recomputes the displayed approach metric from body positions and chemical mapping',async()=>{
  const {auditCueTrainingTrace}=await loadVerifier(),record=fixture();record.probes[0].result.preferenceIndex=.99;
  const result=auditCueTrainingTrace(record);assert.equal(result.pass,false);assert.match(result.issues.join('\n'),/preference.*metric|metric.*preference/i);
});

test('real independent session emits both cues without touching daily storage, body, reward or memory directly',async()=>{
  const {CueTrainingSession}=await import('../src/cue-training-session.mjs');
  const previousStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('Daily storage is forbidden in the training lab');}});
  let session;
  try{
    session=new CueTrainingSession({seed:8401});const initial=session.exportMemory();
    for(const odor of ['A','B','off']){
      const before=session.snapshot(),after=session.command('emit',odor);
      assert.deepEqual(after.actor,before.actor);assert.deepEqual(session.exportMemory(),initial);
      assert.equal(after.experiment.learning.rewardPulses,0);assert.equal(after.experiment.canProbe,false);
    }
    session.tick(.02);const s=session.snapshot();
    assert.equal(s.stats.ateSeconds,0);assert.equal(s.experiment.learning.consumedAmount,0);
    assert.equal(s.experiment.learning.rewardPulses,0);assert.deepEqual(session.exportMemory(),initial);
    assert.throws(()=>session.command('probe'));
  }finally{
    session?.dispose();if(previousStorage)Object.defineProperty(globalThis,'localStorage',previousStorage);else delete globalThis.localStorage;
  }
});

test('raw audit rejects a missing probe lifecycle, an early result phase, and nonfinite raw numbers',async()=>{
  const {auditCueTrainingTrace}=await loadVerifier();
  const missing=fixture();missing.probes=[];assert.equal(auditCueTrainingTrace(missing).pass,false);
  const phase=fixture();Object.assign(phase.probes[0].samples[5],{phase:'result',foods:{...food},frozen:false});
  assert.equal(auditCueTrainingTrace(phase).pass,false);
  const invalid=fixture();invalid.probes[0].samples[5].time=NaN;
  const result=auditCueTrainingTrace(invalid);assert.equal(result.pass,false);assert.match(result.issues.join('\n'),/finite|invalid.*sample/i);
});

test('constructor failure writes a failed receipt instead of leaving an unexplained lock',()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const parent=join(root,'output/cue-training-v8.4.0/verification-tests');mkdirSync(parent,{recursive:true});
  const directory=mkdtempSync(join(parent,'startup-failure-')),loader=join(directory,'loader.mjs'),out=join(directory,'receipt');
  writeFileSync(loader,"import {registerHooks} from 'node:module';registerHooks({load(url,context,next){if(url.endsWith('/src/cue-training-session.mjs'))return {format:'module',source:\"export class CueTrainingSession {constructor(){throw Error('injected constructor failure')}}\",shortCircuit:true};return next(url,context);}});\n");
  const result=spawnSync(process.execPath,['--import',pathToFileURL(loader).href,'scripts/verify-cue-training.mjs','--out',out,'--seed','8401','--training','20'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,1);assert.equal(existsSync(join(out,'summary.json')),true,'Every initialized run-lock needs a failed summary when initialization throws: '+result.stderr);
  const receipt=JSON.parse(readFileSync(join(out,'summary.json'),'utf8'));
  assert.equal(receipt.pass,false);assert.match(receipt.issues.join('\n'),/injected constructor failure/);
});
