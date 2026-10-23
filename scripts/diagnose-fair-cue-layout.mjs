import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CueTrainingSession} from '../src/cue-training-session.mjs';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {cloneCounterfactual,counterfactualIdentity} from './diagnose-learned-behavior.mjs';
import {senseEnvironment} from '../src/neural-controller.mjs';
import {motorFeedbackInterval} from '../public/neural-cadence.mjs';
import {segmentOccluded} from '../public/collision-world.mjs';
import {FOOD_IDS,foodStock,withFoodStock} from '../public/food-stock.mjs';
import {MushroomCircuit,KC} from '../src/mushroom-circuit.mjs';
import {NEUTRAL_ODOR_READOUT} from '../src/neutral-odor-learning.mjs';

const STEP=.02,EPS=1e-10;
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const distance=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const vectorDifference=(a,b)=>a.map((x,i)=>x-b[i]);

export function validateFairOptions(options={}){
  const expected={seed:8401,odor:'A',axis:'x',offset:.65,trainingSeconds:12,probeSeconds:8};
  for(const [key,value] of Object.entries(expected))if(options[key]!==undefined&&options[key]!==value)throw Error(`Fixed fair protocol ${key} is ${value}`);
  if(Object.keys(options).some(key=>!Object.hasOwn(expected,key)&&key!=='outputDirectory'))throw Error('Unknown fair protocol option');
  return {...expected,outputDirectory:options.outputDirectory??null};
}

export function declareFairLayout(position){
  if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))throw Error('Invalid actual body position');
  return {axis:'x',offset:.65,center:[...position],left:[position[0]-.65,position[1],position[2]],
    right:[position[0]+.65,position[1],position[2]]};
}

export function auditPNPatterns(patterns,pnIndices){
  const sets=Object.fromEntries(['A','B'].map(odor=>[odor,new Set(Array.from(pnIndices).filter(i=>patterns[odor][i]>0))]));
  const intersection=[...sets.A].filter(i=>sets.B.has(i)).length,union=sets.A.size+sets.B.size-intersection;
  return {activeA:sets.A.size,activeB:sets.B.size,intersection,jaccard:union?intersection/union:0,
    sharedFractionA:sets.A.size?intersection/sets.A.size:0,sharedFractionB:sets.B.size?intersection/sets.B.size:0};
}

/** Matched-seed frozen neural probes, not a new animal training experiment. */
export function auditKCGeneralization(learning,efficacy){
  const saved=learning.serializeWeights();
  if(!Array.isArray(efficacy)||efficacy.length!==saved.efficacy.length||!efficacy.every(q=>Number.isFinite(q)&&q>=.05&&q<=1))throw Error('Invalid retained q for overlap audit');
  const seed=NEUTRAL_ODOR_READOUT.seed,milliseconds=NEUTRAL_ODOR_READOUT.probeMs;
  const circuit=new MushroomCircuit({seed,frozen:true}),untrained=efficacy.map(()=>1);
  const run=(pattern,q)=>{circuit.restoreWeights({...saved,efficacy:q});
    return circuit.advance(milliseconds,{odor:pattern,reward:false,learn:false,seed});};
  const blank=run(new Float64Array(circuit.n),untrained),raw={},trained={},sets={};
  const kcIndices=Array.from(circuit.roles.keys()).filter(i=>circuit.roles[i]===KC);
  for(const odor of ['A','B']){raw[odor]=run(learning.patterns[odor],untrained);trained[odor]=run(learning.patterns[odor],efficacy);
    sets[odor]=new Set(kcIndices.filter(i=>raw[odor].counts[i]>blank.counts[i]));}
  const depressed=new Set();let changedSynapses=0;
  for(let i=0;i<efficacy.length;i++)if(efficacy[i]<1-EPS){changedSynapses++;depressed.add(circuit.pre[circuit.plasticEdges[i]]);}
  const common=new Set([...sets.A].filter(i=>sets.B.has(i))),readouts={};
  for(const odor of ['A','B']){
    let predictedInputReduction=0,sharedKCInputReduction=0;
    for(let i=0;i<efficacy.length;i++){const edge=circuit.plasticEdges[i],pre=circuit.pre[edge];
      const amount=(1-efficacy[i])*circuit.weights[edge]*circuit.plasticFraction[edge]*raw[odor].counts[pre];
      predictedInputReduction+=amount;if(common.has(pre))sharedKCInputReduction+=amount;}
    readouts[odor]={untrainedRateMBON:raw[odor].rateMBON,trainedRateMBON:trained[odor].rateMBON,
      suppressionHz:raw[odor].rateMBON-trained[odor].rateMBON,
      odorIncreasedKCs:sets[odor].size,depressedOdorIncreasedKCs:[...sets[odor]].filter(i=>depressed.has(i)).length,
      depressedKCsWithAnySpikes:[...depressed].filter(i=>raw[odor].counts[i]>0).length,
      predictedExcitatoryInputReduction:predictedInputReduction,sharedKCInputReduction,
      sharedKCInputReductionFraction:predictedInputReduction?sharedKCInputReduction/predictedInputReduction:0};
  }
  return {seed,probeMilliseconds:milliseconds,frozen:true,reward:false,
    pn:auditPNPatterns(learning.patterns,circuit.pnIndices),kcCount:kcIndices.length,
    kcIncreasedA:sets.A.size,kcIncreasedB:sets.B.size,kcIncreasedIntersection:common.size,
    kcIncreasedJaccard:common.size/(sets.A.size+sets.B.size-common.size),
    baselineActiveKCs:kcIndices.filter(i=>blank.counts[i]>0).length,changedSynapses,depressedPlasticKCs:depressed.size,
    readouts,interpretation:'KC response is above a same-seed no-PN-input neural baseline. Input-reduction sums are mechanistic approximations, not additive causal MBON rate decompositions.'};
}

const cosHorizontal=(a,b)=>{const size=Math.hypot(a[0],a[2])*Math.hypot(b[0],b[2]);
  return size>EPS?(a[0]*b[0]+a[2]*b[2])/size:null;};
const mean=values=>values.length?values.reduce((sum,x)=>sum+x,0)/values.length:null;
const preference=sample=>(sample.distanceB-sample.distanceA)/Math.max(EPS,sample.distanceA+sample.distanceB);

export function summarizeFairProbe(rows){
  const tail=rows.filter(row=>row.t>4+1e-8&&row.t<=8+1e-8),summary={};
  for(const kind of ['learned','erased']){
    const values=rows.map(row=>row[kind]),last=values.at(-1),tailValues=tail.map(row=>row[kind]);
    const alignment=values.map(x=>cosHorizontal(x.rawNeutralForce,x.motorWorld)).filter(x=>x!==null);
    const activeAlignment=values.filter(x=>x.frameNeutralForce).map(x=>cosHorizontal(x.frameNeutralForce,x.motorWorld)).filter(x=>x!==null);
    summary[kind]={tailPreferenceA:mean(tailValues.map(preference)),tailMeanDistanceA:mean(tailValues.map(x=>x.distanceA)),
      tailMeanDistanceB:mean(tailValues.map(x=>x.distanceB)),tailPrefersA:mean(tailValues.map(preference))>0,
      initialDistanceA:values[0]?.distanceA??null,initialDistanceB:values[0]?.distanceB??null,
      finalDistanceA:last?.distanceA??null,finalDistanceB:last?.distanceB??null,
      motorForceAlignment:mean(alignment),motorForceAlignmentSamples:alignment.length,
      inputFrameMotorAlignment:mean(activeAlignment),inputFrameMotorAlignmentSamples:activeAlignment.length,
      projectedSamples:values.filter(x=>x.neutralProjected).length};
  }
  return {tailStartExclusive:4,tailEndInclusive:8,tailSamples:tail.length,...summary,
    tailQDifference:summary.learned.tailPreferenceA-summary.erased.tailPreferenceA,
    scientificLearningSuccess:null};
}

function neutralForce(state,cues){
  const force=[0,0,0];
  for(const cue of cues)for(let i=0;i<3;i++)force[i]+=3*cue.neuralValence*cue.intensity*(cue.position[i]-state.actor.position[i])/Math.max(.32,cue.distance);
  return force;
}
function motorWorld(sim){const {local,referenceHeading}=sim.neural.motor,h=referenceHeading??sim.state.actor.heading;
  return [local[0]*Math.cos(h)+local[2]*Math.sin(h),local[1],-local[0]*Math.sin(h)+local[2]*Math.cos(h)];}
function installFrameRecorder(sim){
  const original=sim.neural.advanceSlice,frames=[];
  sim.neural.advanceSlice=function(state,steps,dt){
    const starts=!this.pending,force=starts?neutralForce(state,this.learning.sense(state)):null;
    const pose=starts?{position:[...state.actor.position],heading:state.actor.heading}:null;
    const result=original.call(this,state,steps,dt);
    if(starts)frames.push({t:state.simSeconds,brainStep:this.brain.step,...pose,rawNeutralForce:force,
      neutralProjected:this.sensory.context?.neutralCueProjected??false,inputs:[...this.sensory.inputs]});
    return result;
  };
  return {frames,restore(){delete sim.neural.advanceSlice;}};
}
function sample(sim,positions,weightsHash,frameRecorder,originTime){
  const s=sim.state,n=sim.neural,learning=n.learning,cues=learning.sense(s);
  const sensory=senseEnvironment(s,n.pulses,undefined,{neutralOdors:cues,feedbackSeconds:motorFeedbackInterval(s),
    landingCandidateBudget:s.companion?.identity.adoptedAt&&s.actor.bodyScale<.15?2:Infinity,
    landingSearchCache:structuredClone(n.landingSearchCache)});
  const latest=frameRecorder.frames.at(-1),weights=learning.serializeWeights().efficacy;
  return {position:[...s.actor.position],velocity:[...s.actor.velocity],heading:s.actor.heading,
    distanceA:distance(s.actor.position,positions.A),distanceB:distance(s.actor.position,positions.B),
    motor:structuredClone(n.motor),motorWorld:motorWorld(sim),rawNeutralForce:neutralForce(s,cues),
    frameNeutralForce:latest?.rawNeutralForce??null,frameSampleTime:latest?latest.t-originTime:null,
    inputs:[...sensory.inputs],activeFrameInputs:[...(n.pending?.inputs??n.sensory.inputs)],
    neutralProjected:sensory.context.neutralCueProjected,holdReason:sensory.context.holdReason,
    obstacle:sensory.context.obstacle,surfaceApproach:sensory.context.surfaceApproach,
    focus:s.living.focus.action,targetId:s.living.navigation.targetId,routeTarget:s.living.navigation.route?.targetId??null,
    physiology:structuredClone(s.living.physiology),needs:structuredClone(s.needs),
    brainSteps:n.brain.step,pendingSteps:n.pending?.steps??0,
    weightsUnchanged:sha(weights)===weightsHash,rewardEnabled:learning.rewardEnabled,frozen:learning.frozen,
    rewardedMilliseconds:learning.rewardedMilliseconds,rewardPulses:learning.rewardPulses,
    foodTotal:FOOD_IDS.reduce((sum,id)=>sum+foodStock(s)[id],0),neuralError:n.error??null};
}

function captureRuntime(session){const original=EmbodiedLife.prototype.tick;let runtime;
  try{EmbodiedLife.prototype.tick=function(seconds){runtime=this;return original.call(this,seconds);};session.tick(STEP);}
  finally{EmbodiedLife.prototype.tick=original;}if(!runtime)throw Error('Actual training runtime not captured');return runtime;}

const sourceFiles=['src/cue-training-session.mjs','src/embodied-life.mjs','src/functional-controller.mjs',
  'src/neural-controller.mjs','src/neutral-odor-learning.mjs','src/mushroom-circuit.mjs',
  'public/behavior-focus.mjs','public/navigation-attention.mjs','public/learned-foraging.mjs'];
const hashes=()=>Object.fromEntries(sourceFiles.map(name=>[name,createHash('sha256').update(readFileSync(new URL('../'+name,import.meta.url))).digest('hex')]));

export async function runFairCueDiagnostic(options={}){
  const config=validateFairOptions(options),started=performance.now(),sourceHashes=hashes();
  const directory=config.outputDirectory?resolve(config.outputDirectory):null;
  if(directory){if(existsSync(directory))throw Error('Preserve prior results; output already exists');mkdirSync(directory,{recursive:true});}
  const declaration={protocol:'R06-fair-X-065-A12-v1',diagnosticVersion:'0.0.1',declaredAt:new Date().toISOString(),config,
    geometry:'At probe start, take the actual body center; fixed X offsets -.65/+ .65m at unchanged body Y/Z; no axis search.',
    comparisons:'Native and swapped from the exact same checkpoint; learned and q=1; 8s at 20ms; final 4s A preference reported.',
    exclusions:'Occluded geometry is unusable. No alternate axis, neural/learning parameter changes, body pose, need reset or forced focus.',
    sourceHashes,diagnosticSHA256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex')};
  if(directory)writeFileSync(resolve(directory,'predeclaration.json'),JSON.stringify(declaration,null,2)+'\n',{flag:'wx'});
  const record={declaration,training:null,layout:null,layoutAvailability:null,rawLearnedWeights:null,
    erasedWeights:null,branches:[],issues:[],executionError:null,scientificLearningSuccess:null};let session;
  try{
    session=new CueTrainingSession({seed:config.seed});session.command('emit','A');const runtime=captureRuntime(session);
    for(let i=1;i<600;i++)session.tick(STEP);
    record.training=session.snapshot().experiment;record.rawLearnedWeights=runtime.neural.learning.serializeWeights().efficacy;
    record.erasedWeights=record.rawLearnedWeights.map(()=>1);
    if(!record.training.canProbe)throw Error('Fixed A12 training yielded no confirmed consumption-linked memory; no observation forced');
    session.command('emit','off');session.command('probe');
    record.layout=declareFairLayout(runtime.state.actor.position);
    const occlusion=withFoodStock(runtime.state,()=>Object.fromEntries(['left','right'].map(side=>
      [side,segmentOccluded(record.layout.center,record.layout[side],runtime.state.actor)])));
    record.layoutAvailability={available:!occlusion.left&&!occlusion.right,occlusion};
    if(!record.layoutAvailability.available){record.issues.push('Predeclared X geometry is occluded; no alternate axis selected');return record;}
    const baseIdentity=counterfactualIdentity(runtime),originTime=runtime.state.simSeconds;
    for(const mapping of ['native','swapped']){
      const learned=cloneCounterfactual(runtime,{seed:8401,efficacy:record.rawLearnedWeights}),
        erased=cloneCounterfactual(runtime,{seed:8401,efficacy:record.erasedWeights});
      const odors=mapping==='native'?{left:'A',right:'B'}:{left:'B',right:'A'},positions={};
      const cues=['left','right'].map(side=>{positions[odors[side]]=[...record.layout[side]];
        return {id:'cue-'+side,odor:odors[side],position:[...record.layout[side]],strength:1,range:1.2,enabled:true};});
      for(const sim of [learned,erased]){sim.neural.learning.setCues(cues);sim.neural.learning.frozen=true;sim.neural.learning.rewardEnabled=false;}
      const before={learned:counterfactualIdentity(learned),erased:counterfactualIdentity(erased)};
      const initialMatched=Object.fromEntries(Object.keys(baseIdentity).map(key=>[key,before.learned[key]===before.erased[key]&&before.learned[key]===baseIdentity[key]]));
      if(Object.values(initialMatched).some(x=>!x))throw Error('Initial q-only identity or common-checkpoint identity mismatch');
      const learnedFrames=installFrameRecorder(learned),erasedFrames=installFrameRecorder(erased),rows=[];
      const qHashes={learned:sha(record.rawLearnedWeights),erased:sha(record.erasedWeights)};
      const append=t=>rows.push({t,learned:sample(learned,positions,qHashes.learned,learnedFrames,originTime),
        erased:sample(erased,positions,qHashes.erased,erasedFrames,originTime)});
      append(0);for(let i=1;i<=400;i++){learned.tick(STEP);erased.tick(STEP);append(i*STEP);}
      learnedFrames.restore();erasedFrames.restore();
      for(const row of rows)for(const kind of ['learned','erased']){const x=row[kind];
        if(!x.weightsUnchanged||x.rewardEnabled||!x.frozen||x.foodTotal!==0||x.neuralError)record.issues.push(`${mapping}/${kind} contamination at ${row.t}`);}
      record.branches.push({mapping,positions,initialMatched,initialHashes:before,rows,
        neuralInputFrames:{learned:learnedFrames.frames,erased:erasedFrames.frames},summary:summarizeFairProbe(rows)});
    }
  }catch(error){record.executionError=error instanceof Error?error.stack:String(error);}
  finally{session?.dispose();record.sourceHashesAfter=hashes();record.sourcesUnchanged=equal(sourceHashes,record.sourceHashesAfter);
    record.wallSeconds=(performance.now()-started)/1000;
    record.pass=!record.executionError&&record.sourcesUnchanged&&record.issues.length===0&&record.branches.length===2;
    record.bothLayoutsTailPreferA=record.branches.length===2&&record.branches.every(x=>x.summary.learned.tailPrefersA);
    if(directory){writeFileSync(resolve(directory,'trace.json'),JSON.stringify(record)+'\n',{flag:'wx'});
      writeFileSync(resolve(directory,'summary.json'),JSON.stringify({...record,rawLearnedWeights:undefined,erasedWeights:undefined,
        training:record.training?{seed:record.training.seed,cueTraining:record.training.cueTraining,learning:record.training.learning}:null,
        branches:record.branches.map(({mapping,initialMatched,summary})=>({mapping,initialMatched,summary}))},null,2)+'\n',{flag:'wx'});}}
  return record;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--out')throw Error('Use --out <fresh directory>; scientific parameters are fixed');
  const record=await runFairCueDiagnostic({outputDirectory:args[1]});
  console.log(JSON.stringify({pass:record.pass,issues:record.issues,executionError:record.executionError,
    layoutAvailability:record.layoutAvailability,wallSeconds:record.wallSeconds,bothLayoutsTailPreferA:record.bothLayoutsTailPreferA,
    branches:record.branches.map(({mapping,summary})=>({mapping,...summary}))}));process.exitCode=record.pass?0:1;
}
