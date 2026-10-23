import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {cloneCounterfactual,counterfactualIdentity} from './diagnose-learned-behavior.mjs';
import {guidanceHash,collectGuidanceClosure,verifyGuidanceHashes,guidanceRuntimeHashes} from './validate-learned-guidance.mjs';
import {FOOD_IDS,foodStock,syncFoodTotal,withFoodStock} from '../public/food-stock.mjs';
import {segmentOccluded} from '../public/collision-world.mjs';

const [startFile,baselineFile,out]=process.argv.slice(2),STEP=.02,SECONDS=20;
if(!startFile||!baselineFile||!out||process.argv.length!==5)throw Error('Usage: node scripts/audit-native-coop-learning.mjs <stage10 before checkpoint> <stage8 before checkpoint> <new output directory>');
const startBytes=await fs.readFile(startFile),baselineBytes=await fs.readFile(baselineFile);
const start=JSON.parse(startBytes),baseline=JSON.parse(baselineBytes);
if(start.coop?.campaign?.stage!==10||baseline.coop?.campaign?.stage!==8||start.coop.seed!==baseline.coop.seed)throw Error('Use the same native individual at stage10 and its stage8 baseline');
await fs.mkdir(out);
const closure=collectGuidanceClosure({entrypoints:['src/embodied-life.mjs','scripts/audit-native-coop-learning.mjs']});
const learned=start.body.synapticMemory.efficacy,erased=baseline.body.synapticMemory.efficacy;
if(learned.length!==erased.length||learned.every((q,i)=>q===erased[i]))throw Error('Actual training must have changed q');
const report={productVersion:'8.5.0',kind:'existing-native-individual-q-only-audit',freshSample:false,
 seed:start.coop.seed,seconds:SECONDS,createdAt:new Date().toISOString(),
 inputs:{start:{path:path.resolve(startFile),sha256:createHash('sha256').update(startBytes).digest('hex')},baseline:{path:path.resolve(baselineFile),sha256:createHash('sha256').update(baselineBytes).digest('hex')}},
 sourceHashes:closure.sourceHashes,mappings:[],claims:{sameAsOriginalNativeProbe:false,newTeaching:false,independentPopulationEvidence:false},error:null};
await fs.writeFile(path.join(out,'run.json'),JSON.stringify(report,null,2));
try{
 for(const swapped of [false,true]){
  const source=new EmbodiedLife(start.body,{seed:start.coop.seed,learningMode:'neutral'});source.setPaused(false);
  for(const id of FOOD_IDS)foodStock(source.state)[id]=0;syncFoodTotal(source.state);
  const center=[...source.state.actor.position],left=[center[0]-.65,center[1],center[2]],right=[center[0]+.65,center[1],center[2]],
   positions={A:swapped?right:left,B:swapped?left:right};
  const occluded=withFoodStock(source.state,()=>Object.fromEntries(['A','B'].map(odor=>[odor,Boolean(segmentOccluded(center,positions[odor],source.state.actor))])));
  if(occluded.A||occluded.B)throw Error('The fixed native cue positions are occluded');
  source.neural.learning.frozen=true;source.neural.learning.rewardEnabled=false;
  source.neural.learning.setCues(['A','B'].map(odor=>({id:'cue-audit-'+odor,odor,position:positions[odor],strength:1,range:1.2,enabled:true})));
  const conditions=['learned','erased','restored'].map(condition=>{
   const sim=cloneCounterfactual(source,{seed:start.coop.seed,efficacy:condition==='erased'?erased:learned});
   return {condition,sim,initial:counterfactualIdentity(sim),qHash:guidanceHash(sim.neural.learning.serializeWeights()),
    initialRewards:sim.neural.learning.rewardPulses,initialConsumed:sim.neural.learning.consumedAmount,initialBrainStep:sim.neural.serialize().step,rows:[],tail:0};
  });
  if(conditions.some(c=>guidanceHash(c.initial)!==guidanceHash(conditions[0].initial)))throw Error('Counterfactual starting states differ beyond q');
  let firstRestoreMismatch=null;
  for(let tick=0;tick<=SECONDS/STEP;tick++){
   for(const c of conditions){
    const s=c.sim.state,l=c.sim.neural.learning;
    if(guidanceHash(l.serializeWeights())!==c.qHash||l.rewardPulses!==c.initialRewards||l.consumedAmount!==c.initialConsumed
     ||Object.values(foodStock(s)).some(n=>n!==0)||!l.frozen||l.rewardEnabled)throw Error('A supposedly frozen food-free probe changed memory or received reward');
    const distance=odor=>Math.hypot(...s.actor.position.map((v,i)=>v-positions[odor][i])),a=distance('A'),b=distance('B'),pi=(b-a)/Math.max(1e-12,a+b);
    c.rows.push({t:tick*STEP,position:[...s.actor.position],preferenceA:pi,hashes:guidanceRuntimeHashes(c.sim)});
    if(tick>=500)c.tail+=pi;
   }
   if(firstRestoreMismatch===null&&guidanceHash(conditions[0].rows.at(-1))!==guidanceHash(conditions[2].rows.at(-1)))firstRestoreMismatch=tick*STEP;
   if(tick===SECONDS/STEP)break;
   for(const c of conditions){withFoodStock(c.sim.state,()=>c.sim.tick(STEP));if(c.sim.neural.error)throw Error(c.sim.neural.error);}
   await new Promise(resolve=>setImmediate(resolve));
  }
  if(conditions.some(c=>!(c.sim.neural.serialize().step>c.initialBrainStep)))throw Error('The original brain did not advance in a counterfactual branch');
  const mapping={swapped,positions,commonCheckpointMatched:true,firstRestoreMismatch,
   conditions:conditions.map(c=>({condition:c.condition,tailPreferenceA:c.tail/501,qHash:c.qHash,brainStepDelta:c.sim.neural.serialize().step-c.initialBrainStep,rows:c.rows.length})),
   deltaPreferenceA:(conditions[0].tail-conditions[1].tail)/501};
  report.mappings.push(mapping);
  for(const c of conditions)await fs.writeFile(path.join(out,`${swapped?'swapped':'native'}-${c.condition}.jsonl`),c.rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
  await fs.writeFile(path.join(out,'live-status.json'),JSON.stringify({pid:process.pid,status:'running',mapping},null,2));
  console.log(JSON.stringify({swapped,deltaPreferenceA:mapping.deltaPreferenceA,firstRestoreMismatch,preferences:mapping.conditions.map(c=>({condition:c.condition,pi:c.tailPreferenceA}))}));
 }
}catch(error){report.error=error.stack??String(error);}
report.sourceVerification=verifyGuidanceHashes(closure);report.finishedAt=new Date().toISOString();
await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({out,error:report.error,sourceUnchanged:report.sourceVerification.pass,mappings:report.mappings.length}));
process.exitCode=report.error||!report.sourceVerification.pass?1:0;
