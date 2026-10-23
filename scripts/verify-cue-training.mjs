import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const FOOD_IDS=['apple','banana','burger','pizza','fries','sandwich','fig'];
const EPSILON=1e-8;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hash=value=>createHash('sha256').update(JSON.stringify(value)??'undefined').digest('hex');
const validWeights=value=>Array.isArray(value)&&value.length===946&&value.every(q=>Number.isFinite(q)&&q>=.05&&q<=1);
const finiteVector=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
function validSample(sample){return sample&&Number.isFinite(sample.time)&&finiteVector(sample.position)
  &&Number.isFinite(sample.heading)&&Number.isFinite(sample.homeFood)&&typeof sample.frozen==='boolean'
  &&typeof sample.rewardEnabled==='boolean'&&Number.isFinite(sample.consumedAmount)&&sample.consumedAmount>=0
  &&Number.isSafeInteger(sample.rewardPulses)&&sample.rewardPulses>=0&&Number.isFinite(sample.ateSeconds)&&sample.ateSeconds>=0
  &&FOOD_IDS.every(id=>Number.isFinite(sample.foods?.[id])&&sample.foods[id]>=0&&sample.foods[id]<=100)
  &&typeof sample.qHash==='string'&&/^[0-9a-f]{64}$/.test(sample.qHash);}

/** Recompute safety checks from captured per-physics-tick values, never a UI pass flag. */
export function auditCueTrainingTrace(record){
  const issues=[],fail=message=>issues.push(message),training=record?.training?.samples??[];
  if(record?.format!==1||record.productVersion!=='8.4.0')fail('Unknown cue-training receipt format or version');
  if(record?.claims?.scientificLearningSuccess!==null)fail('Scientific learning success cannot be inferred from this interactive run');
  if(!validWeights(record?.initialWeights)||!validWeights(record?.trainedWeights))fail('Invalid initial or trained weights');
  const initialHash=hash(record?.initialWeights),trainedHash=hash(record?.trainedWeights);
  if(!training.length)fail('Missing raw training samples');
  if(training[0]?.qHash!==initialHash)fail('Initial weights differ from initial raw sample');
  let firstConsumption=null,firstReward=null;
  for(let i=0;i<training.length;i++){
    const sample=training[i],previous=training[i-1];
    if(!validSample(sample)){fail(`Invalid or nonfinite training sample ${i}`);continue;}
    if(sample.consumedAmount>0&&firstConsumption===null)firstConsumption=sample.time;
    if(sample.rewardPulses>0&&firstReward===null)firstReward=sample.time;
    if(sample.qHash!==initialHash&&firstConsumption===null)fail(`Weight change before real consumption at training sample ${i}`);
    if(previous){
      if(sample.time<previous.time||sample.consumedAmount<previous.consumedAmount||sample.rewardPulses<previous.rewardPulses||sample.ateSeconds<previous.ateSeconds)fail(`Nonmonotonic training counters at sample ${i}`);
      if(Math.abs(sample.time-previous.time-.02)>EPSILON)fail(`Missing or repeated 20ms physics tick in training sample ${i}`);
      const stockLoss=FOOD_IDS.reduce((sum,id)=>sum+(previous.foods?.[id]??NaN)-(sample.foods?.[id]??NaN),0);
      if(!Number.isFinite(stockLoss)||Math.abs(stockLoss/FOOD_IDS.length-(sample.consumedAmount-previous.consumedAmount))>EPSILON)fail(`Food stock loss does not match actual consumption at training sample ${i}`);
      if(sample.rewardPulses>previous.rewardPulses&&!(sample.consumedAmount>previous.consumedAmount&&sample.ateSeconds>previous.ateSeconds))fail(`Reward without same-tick real consumption at training sample ${i}`);
    }
  }
  if(training.length&&training.at(-1).qHash!==trainedHash)fail('Trained weights differ from last raw training sample');
  for(const [i,command] of (record?.commands??[]).entries()){
    if(command.action!=='emit')continue;
    for(const key of ['position','heading','qHash','consumedAmount','rewardPulses','ateSeconds']){
      if(!equal(command.before?.[key],command.after?.[key]))fail(`Emit command changed body, weights or reward directly (${i}:${key})`);
    }
  }
  const probeObservations=[];
  const kinds=(record?.probes??[]).map(probe=>probe.kind).sort();
  if(!equal(kinds,['manual-abort','native','swapped']))fail('Complete workflow requires exactly one native, swapped and manual-abort probe');
  for(const [i,probe] of (record?.probes??[]).entries()){
    const samples=probe.samples??[],start=samples[0],last=samples.at(-1),expectedHash=hash(probe.weightsBefore);
    if(!validWeights(probe.weightsBefore)||!validWeights(probe.weightsAfter)||!equal(probe.weightsBefore,probe.weightsAfter))fail(`Probe ${i} changed weights`);
    if(!start||!last){fail(`Probe ${i} missing raw samples`);continue;}
    const duration=last.time-start.time;
    if(!Number.isFinite(duration)||duration<0)fail(`Probe ${i} has invalid or nonfinite duration`);
    if(probe.termination==='automatic'&&Math.abs(duration-20)>EPSILON)fail(`Probe ${i} automatic duration is not 20 seconds`);
    if(probe.termination==='abort'&&!(duration>=0&&duration<20))fail(`Probe ${i} abort duration invalid`);
    const mapping=start.probe?.mapping,sources=start.probe?.sourcePositions;
    const expectedMapping=probe.kind==='swapped'?{left:'B',right:'A'}:{left:'A',right:'B'};
    const validSources=finiteVector(sources?.left)&&finiteVector(sources?.right);
    if(!equal(mapping,expectedMapping)||!validSources)fail(`Probe ${i} invalid chemical mapping or nonfinite source positions`);
    let metricA=0,metricB=0,metricPI=0;
    for(const [j,sample] of samples.entries()){
      if(!validSample(sample)){fail(`Probe ${i} invalid or nonfinite sample ${j}`);continue;}
      if(j&&Math.abs(sample.time-samples[j-1].time-.02)>EPSILON)fail(`Missing or repeated 20ms physics tick in probe ${i} sample ${j}`);
      const completedTick=probe.termination==='automatic'&&j===samples.length-1;
      if(sample.phase!==(completedTick?'result':'probing'))fail(`Probe ${i} invalid phase boundary at sample ${j}`);
      if(sample.qHash!==expectedHash)fail(`Probe ${i} weight drift at sample ${j}`);
      if(sample.rewardPulses!==start.rewardPulses||sample.consumedAmount!==start.consumedAmount||sample.ateSeconds!==start.ateSeconds)fail(`Probe ${i} reward or actual consumption occurred at sample ${j}`);
      if(j&&equal(mapping,expectedMapping)&&validSources&&Number.isFinite(samples[j-1].time)){
        const a=sources[mapping.left==='A'?'left':'right'],b=sources[mapping.left==='B'?'left':'right'];
        const da=Math.hypot(...sample.position.map((v,k)=>v-a[k])),db=Math.hypot(...sample.position.map((v,k)=>v-b[k])),dt=sample.time-samples[j-1].time;
        metricA+=da*dt;metricB+=db*dt;metricPI+=(db-da)/Math.max(1e-9,da+db)*dt;
      }
      if(completedTick&&sample.phase==='result')continue;
      if(sample.frozen!==true||sample.rewardEnabled!==false)fail(`Probe ${i} is not frozen with reward disabled at sample ${j}`);
      if(sample.homeFood!==0||FOOD_IDS.some(id=>sample.foods?.[id]!==0))fail(`Probe ${i} contains food at sample ${j}`);
    }
    if(!equal(probe.afterFinish?.foods,probe.inventoryBefore))fail(`Probe ${i} inventory not exactly restored`);
    for(const key of ['frozen','rewardEnabled'])if(probe.afterFinish?.[key]!==probe.flagsBefore?.[key])fail(`Probe ${i} did not restore ${key}`);
    if(probe.termination==='automatic'){
      const before=probe.beforeFinish,after=probe.afterFinish;
      if(!before?.position||!after?.position||Math.hypot(...after.position.map((v,j)=>v-before.position[j]))>.1)fail(`Probe ${i} finishing made an implausible body jump`);
      if(before?.qHash!==after?.qHash)fail(`Probe ${i} finishing changed weights`);
    }else for(const key of ['position','heading','qHash'])if(!equal(probe.beforeFinish?.[key],probe.afterFinish?.[key]))fail(`Probe ${i} finishing rewound body or weights (${key})`);
    const recomputed=Number.isFinite(duration)&&duration>0&&equal(mapping,expectedMapping)&&validSources?{meanDistanceA:metricA/duration,meanDistanceB:metricB/duration,preferenceIndex:metricPI/duration}:null;
    if(recomputed){
      for(const key of Object.keys(recomputed))if(!Number.isFinite(probe.result?.[key])||Math.abs(probe.result[key]-recomputed[key])>EPSILON)fail(`Probe ${i} displayed ${key} metric does not match raw positions`);
      if(Math.abs((probe.result?.elapsed??NaN)-duration)>EPSILON)fail(`Probe ${i} displayed duration does not match physics ticks`);
      for(const point of probe.result?.trace??[]){
        const raw=samples[Math.round(point.t/.02)];
        if(!raw||Math.abs(raw.time-start.time-point.t)>EPSILON||!equal(point.position,raw.position))fail(`Probe ${i} result trace does not match raw body trajectory`);
      }
    }
    probeObservations.push({kind:probe.kind,termination:probe.termination,durationSeconds:duration,samples:samples.length,
      displacementMeters:Math.hypot(...last.position.map((value,j)=>value-start.position[j])),...recomputed});
  }
  return {pass:issues.length===0,issues,scientificLearningSuccess:null,trainingSamples:training.length,
    firstConsumptionSeconds:firstConsumption,firstRewardSeconds:firstReward,
    consumedAmount:training.at(-1)?.consumedAmount??0,rewardPulses:training.at(-1)?.rewardPulses??0,
    changedSynapses:validWeights(record?.initialWeights)&&validWeights(record?.trainedWeights)?record.trainedWeights.filter((q,i)=>q!==record.initialWeights[i]).length:null,
    probes:probeObservations};
}

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const LOCKED_SOURCES=['src/cue-training-session.mjs','public/cue-training-worker.mjs','public/cue-training-client.mjs',
  'src/embodied-life.mjs','src/functional-controller.mjs','src/neural-controller.mjs','src/neural-core.mjs',
  'src/functional-connectome.json','src/functional-calibration.json','src/neutral-odor-learning.mjs',
  'src/mushroom-circuit.mjs','src/mushroom-connectome.json','public/food-stock.mjs',
  'public/navigation-attention.mjs','public/resource-contact.mjs','public/collision-world.mjs',
  'public/environment-spec.mjs','public/synaptic-memory-schema.mjs','public/world-spec.mjs','package.json','scripts/verify-cue-training.mjs'];
function sourceHashes(){return Object.fromEntries(LOCKED_SOURCES.map(path=>[path,
  createHash('sha256').update(readFileSync(resolve(ROOT,path))).digest('hex')]));}
function saveJSON(directory,name,value){if(directory)writeFileSync(resolve(directory,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',encoding:'utf8'});}
function capture(session){
  const scene=session.snapshot(),experiment=scene.experiment,learning=experiment?.learning,
    memory=session.exportMemory(),weights=memory.synapticMemory?.efficacy;
  if(!experiment||!learning||!validWeights(weights))throw Error('Session snapshot or memory export cannot be independently audited');
  return {sample:{time:scene.simSeconds,phase:experiment.phase,position:[...scene.actor.position],heading:scene.actor.heading,
    velocity:[...scene.actor.velocity],foods:structuredClone(scene.living.care.foods),homeFood:scene.home.food,
    frozen:learning.frozen,rewardEnabled:learning.rewardEnabled,consumedAmount:learning.consumedAmount,
    rewardPulses:learning.rewardPulses,rewardedMilliseconds:learning.rewardedMilliseconds,
    ateSeconds:scene.stats.ateSeconds,qHash:hash(weights),consumingResource:scene.actor.consumingResource??null,
    motor:structuredClone(scene.neural?.motor??null),neuralError:scene.neural?.error??null,
    route:structuredClone(scene.actor.route??[]),canProbe:experiment.canProbe,
    cue:experiment.emission??null,probe:experiment.probe?{duration:experiment.probe.duration,elapsed:experiment.probe.elapsed,
      remaining:experiment.probe.remaining,mapping:{...experiment.probe.mapping},sourcePositions:structuredClone(experiment.probe.sourcePositions)}:null},
    weights,scene};
}

/** Fixed, disclosed UX pilot. After construction every change uses player commands or physical ticks. */
export async function runCueTrainingVerification({seed=8401,trainingSeconds=60,odor='A',outputDirectory=null}={}){
  if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw Error('Invalid pilot seed');
  if(seed>=6100&&seed<=6107)throw Error('Use a new pilot seed, not the previous heldout cohort');
  if(!Number.isFinite(trainingSeconds)||trainingSeconds<20||trainingSeconds>60||Math.abs(trainingSeconds/.02-Math.round(trainingSeconds/.02))>EPSILON)throw Error('Training duration must be 20 to 60 seconds on the 20ms grid');
  if(!['A','B'].includes(odor))throw Error('Pilot odor must be A or B');
  const started=performance.now(),beforeHashes=sourceHashes();
  const directory=outputDirectory?resolve(outputDirectory):null;
  if(directory){if(existsSync(directory))throw Error('Output directory already exists; pilot results must not be overwritten');mkdirSync(directory,{recursive:true});}
  const lock={format:1,productVersion:'8.4.0',seed,odor,trainingSeconds,physicsStepSeconds:.02,
    probeDurationSeconds:20,abortAfterSeconds:2,createdAt:new Date().toISOString(),sourceHashes:beforeHashes,
    purpose:'Player workflow pilot; no baseline/timing control and no scientific learning-success score.',
    initialScene:'Session constructor newborn center-north; no body/needs/stock writes by this verifier after construction.'};
  saveJSON(directory,'run-lock.json',lock);
  let session=null;
  const record={format:1,productVersion:'8.4.0',seed,odor,stepSeconds:.02,claims:{scientificLearningSuccess:null,
    description:'Interactive approach observations without baseline comparison; reward counts are not memory strength.'},
    initialWeights:null,trainedWeights:null,commands:[],training:{samples:[]},probes:[],initialScene:null,
    sourceHashes:beforeHashes,sourceHashesAfter:null,executionError:null};
  function command(action,payload){
    const before=capture(session);session.command(action,payload);const after=capture(session);
    record.commands.push({action,payload:payload??null,before:before.sample,after:after.sample});return after;
  }
  function probe(action,kind,termination){
    const before=capture(session),entry=command(action),weightsBefore=entry.weights,
      item={kind,termination,durationSeconds:20,inventoryBefore:before.sample.foods,
        flagsBefore:{frozen:before.sample.frozen,rewardEnabled:before.sample.rewardEnabled},
        weightsBefore,weightsAfter:null,samples:[entry.sample],beforeFinish:null,afterFinish:null,result:null};
    if(entry.sample.phase!=='probing')throw Error(`Probe did not start (${kind})`);
    const steps=termination==='automatic'?1000:100;
    for(let i=0;i<steps;i++){
      const previous=item.samples.at(-1);session.tick(.02);const next=capture(session);item.samples.push(next.sample);
      if(next.sample.phase!=='probing'){item.beforeFinish=previous;break;}
    }
    if(termination==='abort'){
      item.beforeFinish=capture(session).sample;session.command('endProbe');
    }
    const after=capture(session);item.afterFinish=after.sample;item.weightsAfter=after.weights;
    item.result=structuredClone(after.scene.experiment.result??after.scene.experiment.probe?.result??null);
    if(!item.beforeFinish)item.beforeFinish=item.samples.at(-2)??entry.sample;
    record.probes.push(item);saveJSON(directory,`${kind}.json`,item);
  }
  try{
    const {CueTrainingSession}=await import('../src/cue-training-session.mjs');
    session=new CueTrainingSession({seed});
    const initial=capture(session);record.initialWeights=initial.weights;record.initialScene=initial.scene;
    record.training.samples.push(initial.sample);command('emit',odor);
    const steps=Math.round(trainingSeconds/.02);
    for(let i=0;i<steps;i++){session.tick(.02);record.training.samples.push(capture(session).sample);}
    const trained=capture(session);record.trainedWeights=trained.weights;record.training.finalExperiment=trained.scene.experiment;
    saveJSON(directory,'training.json',record.training);
    command('emit','off');
    if(trained.scene.experiment.canProbe){
      probe('probe','native','automatic');probe('swap','swapped','automatic');probe('probe','manual-abort','abort');
    }else record.executionError='The fixed pilot did not produce actual cue-associated teaching within the predeclared training window; no result was forced.';
  }catch(error){record.executionError=error instanceof Error?error.stack:String(error);}
  finally{
    try{if(session){record.beforeDispose=capture(session).sample;session.dispose();record.afterDispose=capture(session).sample;}}
    catch(error){record.disposalError=String(error);}
    record.sourceHashesAfter=sourceHashes();record.wallSeconds=(performance.now()-started)/1000;
    record.audit=auditCueTrainingTrace(record);
    if(record.executionError)record.audit.issues.push(record.executionError);
    if(record.disposalError)record.audit.issues.push(record.disposalError);
    if(!equal(record.sourceHashes,record.sourceHashesAfter))record.audit.issues.push('Locked source changed during the pilot');
    if(record.beforeDispose&&record.afterDispose){
      for(const key of ['position','heading','qHash'])if(!equal(record.beforeDispose[key],record.afterDispose[key]))record.audit.issues.push(`Disposal rewound body or weights (${key})`);
    }
    record.audit.pass=record.audit.issues.length===0;
    saveJSON(directory,'trace.json',record);saveJSON(directory,'summary.json',{...record.audit,seed,odor,wallSeconds:record.wallSeconds,
      sourceHashes:record.sourceHashes,sourceHashesAfter:record.sourceHashesAfter,initialCompanion:record.initialScene?.companion,
      trainingSeconds,interpretation:record.claims.description});
  }
  return record;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const options={};
  for(let i=2;i<process.argv.length;i+=2){const flag=process.argv[i],value=process.argv[i+1];
    if(value===undefined)throw Error(`Missing value for ${flag}`);
    if(flag==='--out')options.outputDirectory=value;
    else if(flag==='--seed')options.seed=Number(value);
    else if(flag==='--training')options.trainingSeconds=Number(value);
    else if(flag==='--odor')options.odor=value;
    else throw Error(`Unknown option ${flag}`);
  }
  if(!options.outputDirectory)throw Error('Supply a new --out directory to preserve every pilot result');
  const record=await runCueTrainingVerification(options);
  console.log(JSON.stringify({...record.audit,issues:record.audit.issues.slice(0,20),issueCount:record.audit.issues.length,wallSeconds:record.wallSeconds},null,2));
  process.exitCode=record.audit.pass?0:1;
}
