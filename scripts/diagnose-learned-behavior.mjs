import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {CueTrainingSession} from '../src/cue-training-session.mjs';
import {senseEnvironment} from '../src/neural-controller.mjs';
import {motorFeedbackInterval} from '../public/neural-cadence.mjs';
import {foodStock,FOOD_IDS,syncFoodTotal} from '../public/food-stock.mjs';

const STEP=.02,EPS=1e-10;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const circuitFields=['v','g','refractory','eligibility','dopamine','queue','step','seed','frozen'];
const circuitActivity=circuit=>Object.fromEntries(circuitFields.map(key=>[key,structuredClone(circuit[key])]));
const vectorDifference=(a,b)=>Math.hypot(...a.map((value,i)=>value-b[i]));

export function validateDiagnosticOptions(options={}){
  const {seed=8401,odor='A',trainingSeconds=20,probeSeconds=4,outputDirectory=null}=options;
  if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw Error('Invalid development seed');
  if(seed>=6100&&seed<=6107)throw Error('Heldout seed is forbidden in development diagnostics');
  const grid=value=>Number.isFinite(value)&&Math.abs(value/STEP-Math.round(value/STEP))<1e-7;
  if(!grid(trainingSeconds)||trainingSeconds<12||trainingSeconds>60)throw Error('Training must be 12 to 60 seconds on the 20ms grid');
  if(!grid(probeSeconds)||probeSeconds<.1||probeSeconds>8)throw Error('Probe must be .1 to 8 seconds on the 20ms grid');
  if(!['A','B'].includes(odor))throw Error('Invalid training odor');
  return {seed,odor,trainingSeconds,probeSeconds,outputDirectory};
}

export function counterfactualIdentity(sim){
  const body=structuredClone(sim.state),brain=sim.neural.serialize();
  delete body.synapticMemory;delete brain.synapticMemory;
  return {body:hash(body),originalBrain:hash(brain),associationActivity:hash(circuitActivity(sim.neural.learning.circuit))};
}

/** Copy live MB activity too: normal save/restore deliberately resets it. */
export function cloneCounterfactual(source,{seed=8401,efficacy}={}){
  validateDiagnosticOptions({seed});
  const learning=source.neural.learning,weights=learning.serializeWeights();
  if(!Array.isArray(efficacy)||efficacy.length!==weights.efficacy.length||!efficacy.every(q=>Number.isFinite(q)&&q>=.05&&q<=1))throw Error('Invalid counterfactual efficacy');
  const branch=new EmbodiedLife(source.serialize(),{seed,learningMode:'neutral'});
  // Constructor migrations are irrelevant here; preserve the exact current body.
  branch.state=structuredClone(source.state);
  branch.neural.landingSearchCache=structuredClone(source.neural.landingSearchCache);
  branch.neural.frame=structuredClone(source.neural.frame);
  for(const [key,value] of Object.entries(learning)){
    if(!['circuit','probe','patterns','kcIndices','danIndices','cues'].includes(key))branch.neural.learning[key]=structuredClone(value);
  }
  for(const name of ['circuit','probe']){
    Object.assign(branch.neural.learning[name],circuitActivity(learning[name]));
    branch.neural.learning[name].q=new Float64Array(learning[name].q);
  }
  branch.neural.learning.setCues(learning.cues);
  for(let i=0;i<efficacy.length;i++)branch.neural.learning.circuit.q[learning.circuit.plasticEdges[i]]=efficacy[i];
  // This cache is derived from q, not an independent neural intervention.
  branch.neural.learning.readoutWeights=null;branch.neural.learning.lastReadoutMs=-Infinity;
  branch.state.synapticMemory=branch.neural.learning.serializeWeights();
  return branch;
}

function sensoryProjection(sim,learning=sim.neural.learning){
  const s=sim.state,n=sim.neural;
  const cues=learning.sense(s),sense=senseEnvironment(s,n.pulses,undefined,{feedbackSeconds:motorFeedbackInterval(s),
    neutralOdors:cues,landingCandidateBudget:s.companion?.identity.adoptedAt&&s.actor.bodyScale<.15?2:Infinity,
    landingSearchCache:structuredClone(n.landingSearchCache)});
  return {sense,cues};
}

function observe(sim,weightsBefore){
  const s=sim.state,n=sim.neural,learning=n.learning,{cues,sense}=sensoryProjection(sim);
  const rawNeutralForce=[0,0,0];
  for(const cue of cues)for(let i=0;i<3;i++)rawNeutralForce[i]+=3*cue.neuralValence*cue.intensity*(cue.position[i]-s.actor.position[i])/Math.max(.32,cue.distance);
  return {position:[...s.actor.position],velocity:[...s.actor.velocity],heading:s.actor.heading,
    inputs:[...sense.inputs],activeFrameInputs:[...(n.pending?.inputs??n.sensory.inputs)],
    motor:structuredClone(n.motor),rawNeutralForce,focus:sense.context.focus,
    targetId:s.living.navigation.targetId,routeStatus:s.living.navigation.route?.status??null,
    routeTargetId:s.living.navigation.route?.targetId??null,route:structuredClone(s.living.navigation.route),
    holdReason:sense.context.holdReason,neutralCueProjected:sense.context.neutralCueProjected,
    needs:structuredClone(s.needs),physiology:structuredClone(s.living.physiology),
    neutralValences:Object.fromEntries(cues.map(cue=>[cue.odor,cue.neuralValence])),
    cueDistances:Object.fromEntries(cues.map(cue=>[cue.odor,cue.distance])),
    neuralSteps:n.brain.step,pendingSteps:n.pending?.steps??0,feedbackSeconds:motorFeedbackInterval(s),
    inventory:FOOD_IDS.reduce((sum,id)=>sum+foodStock(s)[id],0),rewardPulses:learning.rewardPulses,
    weightsUnchanged:equal(learning.serializeWeights().efficacy,weightsBefore),neuralError:n.error??null};
}

export function summarizeDiagnostic(rows,initialIdentity){
  const issues=[],behaviorFailures=[];
  for(const [name,matched] of Object.entries(initialIdentity??{}))if(!matched)issues.push(`Initial ${name} mismatch; q-only inference is invalid`);
  if(!rows.length)issues.push('Missing diagnostic samples');
  const counters={sensationDifferentTicks:0,motorDifferentTicks:0,positionDifferentTicks:0,
    sameBodySensationDifferentTicks:0,sameBodySamples:0,
    projectedLearnedTicks:0,projectedErasedTicks:0,blockedLearnedTicks:0};
  let firstMotorDifferenceSeconds=null,firstPositionDifferenceSeconds=null,maxPositionDifference=0,maxInputDifference=0;
  for(let index=0;index<rows.length;index++){
    const {t,learned,erased}=rows[index];
    if(rows[index].sameBodyInputs){counters.sameBodySamples++;
      if(vectorDifference(rows[index].sameBodyInputs.learned,rows[index].sameBodyInputs.erased)>EPS)counters.sameBodySensationDifferentTicks++;}
    if(!Number.isFinite(t)||(index&&Math.abs(t-rows[index-1].t-STEP)>1e-8))issues.push(`Invalid 20ms grid at ${index}`);
    for(const [name,sample] of Object.entries({learned,erased})){
      if(sample.inventory!==0)issues.push(`${name} food contamination at ${t}`);
      if(sample.rewardPulses!==0)issues.push(`${name} external reward at ${t}`);
      if(!sample.weightsUnchanged)issues.push(`${name} weights changed at ${t}`);
      if(sample.neuralError)issues.push(`${name} neural failure at ${t}: ${sample.neuralError}`);
    }
    const inputDelta=vectorDifference(learned.inputs,erased.inputs),positionDelta=vectorDifference(learned.position,erased.position);
    const motorDelta=vectorDifference(learned.motor.local,erased.motor.local)+Math.abs(learned.motor.drive-erased.motor.drive);
    maxInputDifference=Math.max(maxInputDifference,inputDelta);maxPositionDifference=Math.max(maxPositionDifference,positionDelta);
    if(inputDelta>EPS)counters.sensationDifferentTicks++;
    if(motorDelta>EPS){counters.motorDifferentTicks++;firstMotorDifferenceSeconds??=t;}
    if(positionDelta>EPS){counters.positionDifferentTicks++;firstPositionDifferenceSeconds??=t;}
    if(learned.neutralCueProjected)counters.projectedLearnedTicks++;else counters.blockedLearnedTicks++;
    if(erased.neutralCueProjected)counters.projectedErasedTicks++;
  }
  if(!counters.sensationDifferentTicks)behaviorFailures.push('No q-dependent sensation difference within this bounded probe');
  if(!counters.motorDifferentTicks)behaviorFailures.push('No q-dependent motor difference within this bounded probe');
  if(!counters.positionDifferentTicks)behaviorFailures.push('No q-dependent physical displacement within this bounded probe');
  return {pass:issues.length===0,issues,behaviorFailures,samples:rows.length,...counters,
    firstMotorDifferenceSeconds,firstPositionDifferenceSeconds,maxInputDifference,maxPositionDifference,
    scientificLearningSuccess:null,interpretation:'A bounded within-seed mechanism diagnostic; direction, transfer, stability and independent replication remain unproven.'};
}

/** Intercept once to inspect the private session runtime; always restore the method. */
function captureRuntime(session){
  const original=EmbodiedLife.prototype.tick;let runtime;
  try{EmbodiedLife.prototype.tick=function(seconds){runtime=this;return original.call(this,seconds);};session.tick(0.02);}
  finally{EmbodiedLife.prototype.tick=original;}
  if(!runtime)throw Error('Unable to capture actual training runtime');
  return runtime;
}

const sourceFiles=['src/cue-training-session.mjs','src/embodied-life.mjs','src/functional-controller.mjs',
  'src/neural-controller.mjs','src/neutral-odor-learning.mjs','src/mushroom-circuit.mjs',
  'public/behavior-focus.mjs','public/navigation-attention.mjs','public/learned-foraging.mjs'];
function sources(){return Object.fromEntries(sourceFiles.map(name=>[name,createHash('sha256').update(readFileSync(new URL('../'+name,import.meta.url))).digest('hex')]));}

export async function runLearnedBehaviorDiagnostic(options={}){
  const config=validateDiagnosticOptions(options),started=performance.now(),sourceHashes=sources();
  const directory=config.outputDirectory?resolve(config.outputDirectory):null;
  if(directory){if(existsSync(directory))throw Error('Diagnostic output already exists; preserve every run');mkdirSync(directory,{recursive:true});}
  const record={format:1,diagnosticVersion:'0.0.1',diagnosticSHA256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),createdAt:new Date().toISOString(),config,sourceHashes,
    claims:{scientificLearningSuccess:null,qOnlyAtInitialCheckpoint:true,foodFree:true,externalReward:false},
    training:null,branches:[],executionError:null};
  let session;
  try{
    session=new CueTrainingSession({seed:config.seed});session.command('emit',config.odor);
    const runtime=captureRuntime(session);
    for(let i=1;i<Math.round(config.trainingSeconds/STEP);i++)session.tick(STEP);
    record.training=session.snapshot().experiment;
    const learnedWeights=runtime.neural.learning.serializeWeights().efficacy;
    if(!record.training.canProbe)throw Error('Fixed training produced no confirmed consumption-associated q change; no probe forced');
    session.command('emit','off');session.command('probe');
    // Start both mappings from the same physical checkpoint, not a sequential swap.
    for(const mapping of ['native','swapped']){
      const learned=cloneCounterfactual(runtime,{seed:config.seed,efficacy:learnedWeights});
      const erasedWeights=learnedWeights.map(()=>1),erased=cloneCounterfactual(runtime,{seed:config.seed,efficacy:erasedWeights});
      const cues=runtime.neural.learning.cues.map(cue=>({...cue,position:[...cue.position],
        odor:mapping==='swapped'?(cue.odor==='A'?'B':'A'):cue.odor}));
      for(const sim of [learned,erased]){sim.neural.learning.setCues(cues);sim.neural.learning.frozen=true;sim.neural.learning.rewardEnabled=false;
        // Retain MB neuronal activity, while external teaching is disabled symmetrically.
        sim.neural.learning.rewardPulses=0;for(const id of FOOD_IDS)foodStock(sim.state)[id]=0;syncFoodTotal(sim.state);}
      const a=counterfactualIdentity(learned),b=counterfactualIdentity(erased);
      const initialIdentity=Object.fromEntries(Object.keys(a).map(name=>[name,a[name]===b[name]]));
      const rows=[];
      const append=t=>{const row={t,learned:observe(learned,learnedWeights),erased:observe(erased,erasedWeights)};
        row.sameBodyInputs={learned:row.learned.inputs,erased:sensoryProjection(learned,erased.neural.learning).sense.inputs};rows.push(row);};
      append(0);
      for(let i=1;i<=Math.round(config.probeSeconds/STEP);i++){learned.tick(STEP);erased.tick(STEP);append(i*STEP);}
      record.branches.push({mapping,initialIdentity,initialHashes:{learned:a,erased:b},
        learnedWeightsHash:hash(learnedWeights),erasedWeightsHash:hash(erasedWeights),rows,summary:summarizeDiagnostic(rows,initialIdentity)});
    }
  }catch(error){record.executionError=error instanceof Error?error.stack:String(error);}
  finally{session?.dispose();record.sourceHashesAfter=sources();record.sourcesUnchanged=equal(sourceHashes,record.sourceHashesAfter);
    record.wallSeconds=(performance.now()-started)/1000;
    record.pass=!record.executionError&&record.sourcesUnchanged&&record.branches.length===2&&record.branches.every(branch=>branch.summary.pass);
    if(directory){writeFileSync(resolve(directory,'trace.json'),JSON.stringify(record)+'\n',{flag:'wx',encoding:'utf8'});
      writeFileSync(resolve(directory,'summary.json'),JSON.stringify({...record,training:record.training?{
        seed:record.training.seed,cueTraining:record.training.cueTraining,learning:record.training.learning}:null,
        branches:record.branches.map(({mapping,initialIdentity,summary})=>({mapping,initialIdentity,summary}))},null,2)+'\n',{flag:'wx',encoding:'utf8'});}}
  return record;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const options={},args=process.argv.slice(2);
  const names={'--seed':'seed','--odor':'odor','--training':'trainingSeconds','--probe':'probeSeconds','--out':'outputDirectory'};
  for(let i=0;i<args.length;i+=2){if(!names[args[i]]||args[i+1]===undefined)throw Error('Expected --seed/--odor/--training/--probe/--out value');
    options[names[args[i]]]=['--odor','--out'].includes(args[i])?args[i+1]:Number(args[i+1]);}
  const result=await runLearnedBehaviorDiagnostic(options);
  console.log(JSON.stringify({pass:result.pass,seed:result.config.seed,executionError:result.executionError,
    wallSeconds:result.wallSeconds,branches:result.branches.map(({mapping,summary})=>({mapping,...summary}))}));
  process.exitCode=result.pass?0:1;
}
