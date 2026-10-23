import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,mkdirSync,statSync,openSync,writeSync,closeSync,renameSync,unlinkSync,fsyncSync} from 'node:fs';
import {resolve,relative,dirname,extname,sep} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

const DEFAULT_PROTOCOL=new URL('../config/learned-guidance-validation-8.5.0.json',import.meta.url);
const expectedSeeds=Array.from({length:16},(_,i)=>9300+i);
const APPROVED_PROTOCOL_SHA='d37b4dd2a2863c2b3e182c4234aa96be541c6b365f1c610b8c370d338e0a2efa';
const APPROVED_RAW_SHA='e2a13b51ee03183b2e74e29467845c1c06bb14e8aa8406e03a0519a43a108194';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const guidanceHash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');

export function validateGuidanceProtocol(p){
  const fail=message=>{throw Error('Invalid learned-guidance protocol: '+message);};
  if(p?.format!==1||p.productVersion!=='8.5.0'||p.phase!=='fresh-development-validation')fail('format, product or phase');
  if(!equal(p.seeds,expectedSeeds)||p.targetRule!=='even-seed-A-odd-seed-B')fail('fixed fresh seeds and counterbalanced targets');
  if(p.workerConcurrency!==1||p.stepSeconds!==.02)fail('one worker and 20ms grid required');
  if(p.training?.minSeconds!==12||p.training?.maxSeconds!==30||p.training?.minActualTeachingEvents!==2)fail('fixed natural training window and teaching threshold');
  if(p.preTraining?.bodyOrNeedsResetAfterCheckpoint!==false||p.training?.paired?.frozen!==false||p.training?.paired?.rewardEnabled!==true
    ||p.training?.frozen?.frozen!==true||p.training?.frozen?.rewardEnabled!==true)fail('natural body and paired/frozen training flags');
  const q=p.probe;
  if(q?.seconds!==8||q.tailStartExclusive!==4||q.tailEndInclusive!==8||q.axis!=='x'||q.offsetMetres!==.65||q.cueStrength!==1||q.cueRange!==1.2)fail('fixed fair probe');
  if(!equal(q.mappings,['native','swapped'])||!equal(q.conditions,['learned','erased','frozen','restored']))fail('all mappings and controls required');
  if(q.frozen!==true||q.rewardEnabled!==false||q.foodTotal!==0||q.restoreInventoryAndFlags!==true)fail('food-free frozen no-reward observation');
  if(!equal(q.urgentActions,['drink','toilet','rest','clean']))fail('urgent demand policy');
  const m=p.primary;
  if(m?.perMappingRequiredPositiveSeeds!==12||m.denominator!==16||m.perMappingMeanImprovementGreaterThan!==.15
    ||m.failedOrMissingContribution!==0||m.bothMappingsRequired!==true||m.reportAllFailures!==true)fail('locked intent-to-treat criteria');
  if(!equal(p.sourceLock?.forbiddenSeeds,Array.from({length:8},(_,i)=>6100+i))||p.sourceLock?.noCoreChangesDuringRun!==true
    ||p.sourceLock?.executionRequiresRootMethodApproval!==true)fail('source and authorization lock');
  if(p.claims?.scientificLearningSuccess!==null||p.claims?.newHeldout6100Evidence!==false||p.claims?.fullCoopPlayerAcceptance!==false)fail('claim boundaries');
  return structuredClone(p);
}

export function planGuidanceValidation(protocol){
  const p=validateGuidanceProtocol(protocol);
  return {protocolId:p.protocolId,protocolSHA256:guidanceHash(p),animalsStarted:0,
    workerConcurrency:1,seeds:p.seeds.map(seed=>({seed,target:seed%2?'B':'A'})),
    expectedTrainingHistories:32,expectedProbeBranches:p.seeds.length*p.probe.mappings.length*p.probe.conditions.length,
    pairedCheckpointConditions:['learned','erased','restored'],frozenCheckpoint:'Own retained natural frozen-training history',
    requiresExplicitRootRunLock:true};
}

function observation(result,seed,mapping,p){
  const failures=[...(result?.failures??[])],item=result?.mappings?.[mapping],target=seed%2?'B':'A';
  if(!result)failures.push('missing-seed-result');
  if(result&&result.target!==target)failures.push('wrong-trained-target');
  if(result&&result.status!=='complete')failures.push('seed-not-complete');
  if(result?.sourcesUnchanged!==true)failures.push('source-lock-not-confirmed');
  if((result?.training?.paired?.actualTeachingEvents??0)<2||(result?.training?.paired?.changedSynapses??0)<=0)failures.push('insufficient-real-intake-or-memory');
  if(result?.training?.frozen?.teachingMatched!==true||result?.training?.frozen?.actualTeachingEvents!==result?.training?.paired?.actualTeachingEvents
    ||result?.training?.frozen?.changedSynapses!==0)failures.push('frozen-intake-or-plasticity-control-failed');
  if(item){failures.push(...(item.failures??[]));
    if(item.valid!==true)failures.push('mapping-invalid');
    if(item.commonCheckpointMatched!==true)failures.push('paired-q-only-checkpoint-mismatch');
    if(item.restoreExact!==true)failures.push('restore-replay-mismatch');
    if(item.restoreExact===true&&item.restored?.tailPreferenceTarget!==item.learned?.tailPreferenceTarget)failures.push('restore-metric-mismatch');
    if(item.frozenControlValid!==true)failures.push('frozen-observation-invalid');
  }else failures.push('missing-mapping');
  const learned=item?.learned?.tailPreferenceTarget,erased=item?.erased?.tailPreferenceTarget;
  const finite=x=>Number.isFinite(x)&&x>=-1&&x<=1;
  if(!finite(learned)||!finite(erased))failures.push('missing-or-invalid-preference');
  const delta=finite(learned)&&finite(erased)?learned-erased:null,unique=[...new Set(failures)],valid=unique.length===0;
  return {seed,target,valid,failures:unique,learnedPreference:finite(learned)?learned:null,erasedPreference:finite(erased)?erased:null,
    observedImprovement:delta,primaryContribution:valid?delta:p.primary.failedOrMissingContribution,
    qualifying:valid&&learned>0&&delta>0,
    frozenPreference:item?.frozen?.tailPreferenceTarget??null,restoredPreference:item?.restored?.tailPreferenceTarget??null,
    frozenPhysicalDifferences:result?.training?.frozen?.postStateDifference??null};
}

function groupSummary(rows){
  const valid=rows.filter(x=>x.valid),sum=rows.reduce((total,x)=>total+x.primaryContribution,0),invalid=rows.length-valid.length;
  return {assigned:rows.length,valid:valid.length,unavailableOrInvalid:invalid,positiveSeeds:rows.filter(x=>x.qualifying).length,
    positiveFraction:rows.filter(x=>x.qualifying).length/rows.length,meanImprovement:sum/rows.length,
    validOnlyMeanImprovement:valid.length?valid.reduce((total,x)=>total+x.observedImprovement,0)/valid.length:null,
    improvementIdentificationBounds:{lower:(sum-2*invalid)/rows.length,upper:(sum+2*invalid)/rows.length},
    meanLearnedPreferenceAmongValid:valid.length?valid.reduce((total,x)=>total+x.learnedPreference,0)/valid.length:null};
}

export function summarizeGuidanceValidation(results,protocol){
  const p=validateGuidanceProtocol(protocol),bySeed=new Map();
  if(!Array.isArray(results))throw Error('Guidance results must be an array');
  for(const result of results){if(!p.seeds.includes(result?.seed))throw Error('Out-of-protocol seed result');
    if(bySeed.has(result.seed))throw Error('Duplicate seed result; selective replacement is forbidden');bySeed.set(result.seed,result);}
  const mappings={};
  for(const mapping of p.probe.mappings){
    const rows=p.seeds.map(seed=>observation(bySeed.get(seed),seed,mapping,p)),group=groupSummary(rows);
    mappings[mapping]={...group,criteriaMet:group.positiveSeeds>=12&&group.meanImprovement>.15,
      targets:Object.fromEntries(['A','B'].map(target=>[target,groupSummary(rows.filter(row=>row.target===target))])),observations:rows};
  }
  const allFailures=p.seeds.map(seed=>({seed,target:seed%2?'B':'A',failures:[...new Set(p.probe.mappings.flatMap(mapping=>
    mappings[mapping].observations.find(row=>row.seed===seed).failures))]})).filter(row=>row.failures.length);
  return {protocolId:p.protocolId,protocolSHA256:guidanceHash(p),animalsAssigned:16,resultsReceived:bySeed.size,
    predeclaredCriteriaMet:p.probe.mappings.every(mapping=>mappings[mapping].criteriaMet),mappings,allFailures,
    scientificLearningSuccess:null,newHeldout6100Evidence:false,fullCoopPlayerAcceptance:false,
    meanPolicy:'Sum validated observed improvement / all16 assigned seeds; failed/missing contributes0 by prior decision. Raw missing values remain null and all failure rows are retained.'};
}

export function loadGuidanceProtocol(path=DEFAULT_PROTOCOL){return validateGuidanceProtocol(JSON.parse(readFileSync(path,'utf8')));}

export function requireGuidanceRunLock(lock,protocol){
  const p=validateGuidanceProtocol(protocol);
  if(lock?.rootApproved!==true||lock?.protocolSHA256!==guidanceHash(p)||typeof lock.approvedAt!=='string'
    ||!lock.sourceHashes||!Object.keys(lock.sourceHashes).length)throw Error('Explicit Root method approval and immutable protocol/source lock are required before any animal construction');
  return structuredClone(lock);
}

export function buildGuidanceBranches(protocol,target,pairedCenter,frozenCenter){
  const p=validateGuidanceProtocol(protocol);if(!['A','B'].includes(target))throw Error('Invalid trained target');
  const specs=[];
  for(const mapping of p.probe.mappings)for(const condition of p.probe.conditions){
    const anchor=condition==='frozen'?'frozen':'paired',center=anchor==='paired'?pairedCenter:frozenCenter;
    const left=[center[0]-.65,center[1],center[2]],right=[center[0]+.65,center[1],center[2]];
    specs.push({mapping,condition,anchor,target,positions:mapping==='native'?{A:left,B:right}:{A:right,B:left}});
  }
  return specs;
}

export function copyGuidanceAuxiliary(source,target){
  const a=source.neural,b=target.neural;
  b.landingSearchCache=structuredClone(a.landingSearchCache);b.frame=structuredClone(a.frame);
  b.paused=a.paused;b.error=a.error;
  if(a.metrics&&b.metrics){b.metrics.counts.set(a.metrics.counts);b.metrics.windowMs=a.metrics.windowMs;b.metrics.sequence=a.metrics.sequence;}
}

export function guidanceTrainingDecision(elapsed,events,targetEvents,{exact=false}={}){
  if(elapsed>=12-1e-8&&events>=targetEvents)return {done:true,failure:!exact||events===targetEvents?null:'teaching-yoke-overshoot'};
  if(elapsed>=30-1e-8)return {done:true,failure:'insufficient-real-intake'};
  return {done:false,failure:null};
}

export function guidanceResumePlan(seeds,completed,started){
  return {completed:seeds.filter(seed=>completed.has(seed)),interrupted:seeds.filter(seed=>!completed.has(seed)&&started.has(seed)),
    pending:seeds.filter(seed=>!completed.has(seed)&&!started.has(seed))};
}

export function collectGuidanceClosure({root=ROOT,entrypoints=['src/cue-training-session.mjs','scripts/validate-learned-guidance.mjs','scripts/diagnose-learned-behavior.mjs'],
  manifests=['package.json','package-lock.json']}={}){
  const workspace=resolve(root),seen=new Set(),queue=entrypoints.map(name=>resolve(workspace,name));
  for(const name of manifests){const path=resolve(workspace,name);if(existsSync(path))queue.push(path);}
  const add=path=>{if(!existsSync(path))throw Error('Missing runtime dependency: '+path);if(statSync(path).isFile()&&!seen.has(path))queue.push(path);};
  while(queue.length){
    const path=resolve(queue.pop());if(seen.has(path))continue;seen.add(path);
    if(!['.mjs','.js','.cjs'].includes(extname(path)))continue;
    const code=readFileSync(path,'utf8'),specifiers=[];
    const importPattern=/\b(?:import|export)\s+(?:(?:[^;'"]*?)\bfrom\s*)?['"]([^'"]+)['"]/g;
    const dynamicPattern=/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    const assetPattern=/\bnew\s+URL\s*\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;
    for(const regex of [importPattern,dynamicPattern,assetPattern])for(const match of code.matchAll(regex))specifiers.push(match[1]);
    for(const specifier of specifiers){
      if(specifier.startsWith('node:')||/^(https?:|data:)/.test(specifier))continue;
      if(specifier.startsWith('.')){add(fileURLToPath(new URL(specifier,pathToFileURL(path))));continue;}
      if(specifier.startsWith('file:')){add(fileURLToPath(specifier));continue;}
      const resolved=fileURLToPath(import.meta.resolve(specifier));add(resolved);
      const normalized=resolved.replaceAll('\\','/'),marker=normalized.lastIndexOf('/node_modules/');
      if(marker>=0){const tail=normalized.slice(marker+14).split('/'),name=tail[0].startsWith('@')?tail.slice(0,2).join('/'):tail[0];
        const manifest=normalized.slice(0,marker+14)+name+'/package.json';if(existsSync(manifest))add(manifest);}
    }
  }
  const files=[...seen].sort().map(path=>{const rel=relative(workspace,path),id=rel.startsWith('..'+sep)?pathToFileURL(path).href:rel.replaceAll('\\','/');
    const bytes=readFileSync(path);return {id,path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
  return {root:workspace,files,sourceHashes:Object.fromEntries(files.map(file=>[file.id,file.sha256])),
    totalBytes:files.reduce((sum,file)=>sum+file.bytes,0)};
}

export function verifyGuidanceHashes(closure){
  const changed=[];
  for(const file of closure.files){if(!existsSync(file.path)||createHash('sha256').update(readFileSync(file.path)).digest('hex')!==file.sha256)changed.push(file.id);}
  return {pass:changed.length===0,changed};
}

function normalized(value){
  if(value===undefined)return {$undefined:true};
  if(typeof value==='number'&&!Number.isFinite(value))return {$number:String(value)};
  if(ArrayBuffer.isView(value))return Array.from(value);
  if(value instanceof Map)return {$map:[...value].map(([key,item])=>[normalized(key),normalized(item)])};
  if(value instanceof Set)return {$set:[...value].map(normalized)};
  if(Array.isArray(value))return value.map(normalized);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,normalized(item)]));
  return value;
}
const stateHash=value=>guidanceHash(normalized(value));
const mbFields=['v','g','refractory','eligibility','dopamine','queue','step','seed','frozen'];
const mbActivity=circuit=>Object.fromEntries(mbFields.map(key=>[key,circuit[key]]));
const learningFields=['clockMs','rewardUntilMs','nextRewardAtMs','rewardPulses','consumedAmount','rewardedMilliseconds',
  'rewardDanSpikes','nonRewardDanSpikes','maxRewardGate','maxNonRewardGate','frozen','rewardEnabled','cues'];

export function guidanceRuntimeHashes(sim){
  const n=sim.neural,l=n.learning,body={...sim.state};delete body.synapticMemory;
  const original=n.serialize();delete original.synapticMemory;
  const frame=n.frame?{...n.frame}:null;if(frame)delete frame.at;
  const hashes={body:stateHash(body),originalBrain:stateHash(original),mbActivity:stateHash(mbActivity(l.circuit)),
    learningTransient:stateHash(Object.fromEntries(learningFields.map(key=>[key,l[key]]))),
    geometryCache:stateHash(n.landingSearchCache),
    observer:stateHash({frame,counts:n.metrics.counts,windowMs:n.metrics.windowMs,sequence:n.metrics.sequence}),
    q:stateHash(l.serializeWeights().efficacy),
    derivedReadout:stateHash({readouts:l.readouts,readoutWeights:l.readoutWeights,lastReadoutMs:l.lastReadoutMs,
      probe:mbActivity(l.probe),probeQ:l.probe.q})};
  return {...hashes,replay:stateHash(hashes)};
}
const causalIdentity=hashes=>Object.fromEntries(['body','originalBrain','mbActivity','learningTransient','geometryCache','observer'].map(key=>[key,hashes[key]]));

function immutableJSON(path,value){
  const temporary=path+'.pending-'+process.pid;
  if(existsSync(path)||existsSync(temporary))throw Error('Refusing to overwrite completed evidence: '+path);
  writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx',encoding:'utf8'});
  renameSync(temporary,path);
}
function rawWriter(path){
  const fd=openSync(path,'wx');let count=0;
  return {append(value){writeSync(fd,JSON.stringify(value)+'\n');count++;},
    close(){fsyncSync(fd);closeSync(fd);return count;}};
}
function progress(directory,details){writeFileSync(resolve(directory,'progress.json'),JSON.stringify({pid:process.pid,at:new Date().toISOString(),...details})+'\n');}

async function loadGuidanceRuntime(){
  const [{CueTrainingSession},{EmbodiedLife},{cloneCounterfactual},{FOOD_IDS,foodStock,syncFoodTotal,withFoodStock},
    {segmentOccluded},{urgentActivity},{validateSynapticMemory}]=await Promise.all([
    import('../src/cue-training-session.mjs'),import('../src/embodied-life.mjs'),import('./diagnose-learned-behavior.mjs'),
    import('../public/food-stock.mjs'),import('../public/collision-world.mjs'),import('../public/activity-cooldowns.mjs'),
    import('../public/synaptic-memory-schema.mjs')]);
  return {CueTrainingSession,EmbodiedLife,cloneCounterfactual,FOOD_IDS,foodStock,syncFoodTotal,withFoodStock,segmentOccluded,urgentActivity,validateSynapticMemory};
}
function captureSharedStart(session,backend){
  const original=backend.EmbodiedLife.prototype.tick;let runtime;
  try{backend.EmbodiedLife.prototype.tick=function(seconds){runtime=this;return original.call(this,seconds);};session.tick(.02);}
  finally{backend.EmbodiedLife.prototype.tick=original;}
  if(!runtime||runtime.neural.learning.consumedAmount!==0||runtime.neural.learning.rewardPulses!==0
    ||runtime.neural.learning.serializeWeights().efficacy.some(q=>q!==1))throw Error('Shared cue-off pre-training step was not naive');
  return runtime;
}
function cloneRuntime(source,seed,efficacy,backend){
  const clone=backend.cloneCounterfactual(source,{seed,efficacy});copyGuidanceAuxiliary(source,clone);return clone;
}
function inventory(sim,backend){return {...backend.foodStock(sim.state)};}
function urgentNeeds(sim,p,backend){return p.probe.urgentActions.filter(action=>backend.urgentActivity(sim.state,action));}
function distance(a,b){return Math.hypot(...a.map((x,i)=>x-b[i]));}
function checkpointJSON(sim){
  return {bodyAndBrain:sim.serialize(),mb:normalized(mbActivity(sim.neural.learning.circuit)),
    learning:normalized(Object.fromEntries(learningFields.map(key=>[key,sim.neural.learning[key]]))),
    geometryCache:normalized(sim.neural.landingSearchCache),hashes:guidanceRuntimeHashes(sim)};
}

function naturalTraining(sim,targetEvents,p,{seed,kind,directory,cohortDirectory},backend){
  const l=sim.neural.learning,started=sim.state.simSeconds,base={consumed:l.consumedAmount,rewards:l.rewardPulses,ate:sim.state.stats.ateSeconds},
    weights=l.serializeWeights().efficacy,writer=rawWriter(resolve(directory,'training-'+kind+'.jsonl'));
  let consumptionTicks=0,decision={done:false,failure:null},last;
  try{
    for(let step=0;step<=1500;step++){
      const elapsed=step*.02,events=l.rewardPulses-base.rewards;
      const sample={t:elapsed,time:sim.state.simSeconds,position:[...sim.state.actor.position],velocity:[...sim.state.actor.velocity],
        heading:sim.state.actor.heading,foods:inventory(sim,backend),consumedAmount:l.consumedAmount-base.consumed,
        actualTeachingEvents:events,qHash:stateHash(l.serializeWeights().efficacy),frozen:l.frozen,rewardEnabled:l.rewardEnabled,
        brainSteps:sim.neural.brain.step,pendingSteps:sim.neural.pending?.steps??0,neuralError:sim.neural.error??null};
      writer.append(sample);last=sample;
      decision=guidanceTrainingDecision(elapsed,events,targetEvents,{exact:kind==='frozen'});
      if(decision.done)break;
      const beforeConsumed=l.consumedAmount,beforeRewards=l.rewardPulses;sim.tick(.02);
      if(sim.neural.error)throw Error(sim.neural.error);
      if(l.consumedAmount>beforeConsumed)consumptionTicks++;
      if(l.rewardPulses>beforeRewards&&l.consumedAmount<=beforeConsumed)throw Error('Teaching occurred without same-tick actual intake');
      if(step%50===0)progress(cohortDirectory,{seed,stage:'training',history:kind,elapsed});
    }
  }finally{writer.close();}
  const finalWeights=l.serializeWeights().efficacy;
  return {elapsed:sim.state.simSeconds-started,actualTeachingEvents:l.rewardPulses-base.rewards,consumptionTicks,
    consumedAmount:l.consumedAmount-base.consumed,actualFeedingSeconds:sim.state.stats.ateSeconds-base.ate,
    changedSynapses:finalWeights.filter((q,i)=>q!==weights[i]).length,finalWeights,finalSample:last,
    failure:decision.failure,teachingMatched:l.rewardPulses-base.rewards===targetEvents,
    readouts:structuredClone(l.snapshot().readouts)};
}

function probeOne(sim,spec,p,{seed,directory,cohortDirectory},backend,learnedReplay=null){
  const l=sim.neural.learning,beforeInventory=inventory(sim,backend),beforeFlags={frozen:l.frozen,rewardEnabled:l.rewardEnabled},
    weights=l.serializeWeights().efficacy,qHash=stateHash(weights),beforeReward=l.rewardPulses,beforeRewarded=l.rewardedMilliseconds;
  const writer=rawWriter(resolve(directory,spec.mapping+'-'+spec.condition+'.jsonl')),rows=[],failures=[],urgent=new Set(),cleanup={};
  let tailSum=0,tailA=0,tailB=0,tailCount=0,initialHash=null,initialMatched=null,occlusion=null,firstRestoreMismatch=null;
  const cues=['A','B'].map(odor=>({id:'cue-'+odor,odor,position:[...spec.positions[odor]],strength:1,range:1.2,enabled:true}));
  try{
    for(const id of backend.FOOD_IDS)backend.foodStock(sim.state)[id]=0;backend.syncFoodTotal(sim.state);
    l.frozen=true;l.rewardEnabled=false;l.setCues(cues);
    initialHash=guidanceRuntimeHashes(sim);initialMatched=causalIdentity(initialHash);
    occlusion=backend.withFoodStock(sim.state,()=>Object.fromEntries(['A','B'].map(odor=>[odor,
      backend.segmentOccluded(sim.state.actor.position,spec.positions[odor],sim.state.actor)])));
    if(occlusion.A||occlusion.B){failures.push('occluded-fixed-source');return {valid:false,failures,tailPreferenceTarget:null,initialIdentity:initialMatched,occlusion,rows,cleanup};}
    for(let step=0;step<=400;step++){
      const t=step*.02,s=sim.state,dA=distance(s.actor.position,spec.positions.A),dB=distance(s.actor.position,spec.positions.B),
        trained=spec.target==='A'?dA:dB,other=spec.target==='A'?dB:dA,preference=(other-trained)/Math.max(1e-12,other+trained),
        hashes=guidanceRuntimeHashes(sim);
      for(const action of urgentNeeds(sim,p,backend))urgent.add(action);
      const row={t,position:[...s.actor.position],velocity:[...s.actor.velocity],heading:s.actor.heading,needs:structuredClone(s.needs),
        physiology:structuredClone(s.living.physiology),motor:structuredClone(sim.neural.motor),sensoryInputs:[...sim.neural.sensory.inputs],
        focus:s.living.focus.action,targetId:s.living.navigation.targetId,routeTarget:s.living.navigation.route?.targetId??null,
        distanceA:dA,distanceB:dB,preferenceTarget:preference,hashes,frozen:l.frozen,rewardEnabled:l.rewardEnabled,
        rewardPulses:l.rewardPulses,rewardedMilliseconds:l.rewardedMilliseconds,foods:inventory(sim,backend),neuralError:sim.neural.error??null};
      writer.append(row);rows.push({t,replay:hashes.replay,hashes,preferenceTarget:preference});
      if(learnedReplay&&hashes.replay!==learnedReplay[step]?.replay&&!firstRestoreMismatch)firstRestoreMismatch={step,t,
        differing:Object.keys(hashes).filter(key=>hashes[key]!==learnedReplay[step]?.hashes?.[key])};
      if(hashes.q!==qHash||!l.frozen||l.rewardEnabled||l.rewardPulses!==beforeReward||l.rewardedMilliseconds!==beforeRewarded
        ||backend.FOOD_IDS.some(id=>backend.foodStock(s)[id]!==0)||sim.neural.error)failures.push('probe-contamination-at-'+t);
      if(step>200){tailSum+=preference;tailA+=dA;tailB+=dB;tailCount++;}
      if(step===400)break;
      sim.tick(.02);if(sim.neural.error)throw Error(sim.neural.error);
      if(step%50===0)progress(cohortDirectory,{seed,stage:'probe',mapping:spec.mapping,condition:spec.condition,elapsed:t});
    }
    for(const action of urgent)failures.push('urgent-'+action);
    if(firstRestoreMismatch)failures.push('restore-replay-mismatch');
    return {valid:failures.length===0,failures:[...new Set(failures)],tailPreferenceTarget:tailCount?tailSum/tailCount:null,
      tailMeanDistanceA:tailCount?tailA/tailCount:null,tailMeanDistanceB:tailCount?tailB/tailCount:null,tailSamples:tailCount,
      initialIdentity:initialMatched,initialHashes:initialHash,occlusion,firstRestoreMismatch,rows,cleanup};
  }finally{
    Object.assign(backend.foodStock(sim.state),beforeInventory);backend.syncFoodTotal(sim.state);
    l.frozen=beforeFlags.frozen;l.rewardEnabled=beforeFlags.rewardEnabled;l.setCues([]);
    writer.close();
    cleanup.inventoryRestored=equal(inventory(sim,backend),beforeInventory);
    cleanup.flagsRestored=l.frozen===beforeFlags.frozen&&l.rewardEnabled===beforeFlags.rewardEnabled;
    cleanup.beforeFlags=beforeFlags;cleanup.afterFlags={frozen:l.frozen,rewardEnabled:l.rewardEnabled};
    if(!cleanup.inventoryRestored||!cleanup.flagsRestored)throw Error('Probe inventory or flags restoration failed');
  }
}

async function runGuidanceAnimal(seed,target,p,directory,cohortDirectory,closure,backend){
  mkdirSync(directory,{recursive:false});immutableJSON(resolve(directory,'started.json'),{seed,target,pid:process.pid,at:new Date().toISOString(),protocolSHA256:guidanceHash(p)});
  const record={seed,target,status:'failed',sourcesUnchanged:true,failures:[],training:{},mappings:{},startedAt:new Date().toISOString()};let session;
  const wall=performance.now();
  try{
    session=new backend.CueTrainingSession({seed});const naive=captureSharedStart(session,backend);
    session.command('emit',target);
    const naiveQ=naive.neural.learning.serializeWeights().efficacy,paired=cloneRuntime(naive,seed,naiveQ,backend),
      frozen=cloneRuntime(naive,seed,naiveQ,backend);
    if(!equal(causalIdentity(guidanceRuntimeHashes(paired)),causalIdentity(guidanceRuntimeHashes(frozen))))throw Error('Training histories did not share the exact naive checkpoint');
    paired.neural.learning.frozen=false;paired.neural.learning.rewardEnabled=true;
    frozen.neural.learning.frozen=true;frozen.neural.learning.rewardEnabled=true;
    immutableJSON(resolve(directory,'pretraining-checkpoint.json'),checkpointJSON(naive));
    record.training.paired=naturalTraining(paired,2,p,{seed,kind:'paired',directory,cohortDirectory},backend);
    record.training.frozen=naturalTraining(frozen,record.training.paired.actualTeachingEvents,p,{seed,kind:'frozen',directory,cohortDirectory},backend);
    record.training.frozen.postStateDifference={positionMetres:distance(paired.state.actor.position,frozen.state.actor.position),
      paired:causalIdentity(guidanceRuntimeHashes(paired)),frozen:causalIdentity(guidanceRuntimeHashes(frozen))};
    immutableJSON(resolve(directory,'paired-checkpoint.json'),checkpointJSON(paired));
    immutableJSON(resolve(directory,'frozen-checkpoint.json'),checkpointJSON(frozen));
    if(record.training.paired.failure)record.failures.push('paired-'+record.training.paired.failure);
    if(record.training.paired.changedSynapses<=0)record.failures.push('no-actual-paired-memory');
    if(record.training.frozen.failure||!record.training.frozen.teachingMatched||record.training.frozen.changedSynapses!==0)record.failures.push('frozen-teaching-yoke-failed');
    const pairedQ=record.training.paired.finalWeights,frozenQ=record.training.frozen.finalWeights;
    const specs=buildGuidanceBranches(p,target,paired.state.actor.position,frozen.state.actor.position);
    for(const mapping of p.probe.mappings){
      const byCondition={},replays={};
      for(const condition of p.probe.conditions){
        const spec=specs.find(x=>x.mapping===mapping&&x.condition===condition),anchor=condition==='frozen'?frozen:paired;
        let clone;
        if(condition==='restored'){
          const erased=cloneRuntime(paired,seed,pairedQ.map(()=>1),backend);
          const serialized=JSON.parse(JSON.stringify({...paired.neural.learning.serializeWeights(),efficacy:pairedQ}));
          backend.validateSynapticMemory(serialized);clone=cloneRuntime(erased,seed,serialized.efficacy,backend);
        }else clone=cloneRuntime(anchor,seed,condition==='erased'?pairedQ.map(()=>1):condition==='frozen'?frozenQ:pairedQ,backend);
        const result=probeOne(clone,spec,p,{seed,directory,cohortDirectory},backend,condition==='restored'?replays.learned:null);
        replays[condition]=result.rows;delete result.rows;byCondition[condition]=result;
      }
      const common=equal(byCondition.learned.initialIdentity,byCondition.erased.initialIdentity)&&equal(byCondition.learned.initialIdentity,byCondition.restored.initialIdentity);
      const restored=byCondition.restored.firstRestoreMismatch===null&&equal(replays.learned.map(x=>x.replay),replays.restored.map(x=>x.replay));
      const failures=[...new Set(Object.values(byCondition).flatMap(x=>x.failures))];
      if(!common)failures.push('paired-q-only-checkpoint-mismatch');if(!restored)failures.push('restore-replay-mismatch');
      record.mappings[mapping]={valid:failures.length===0,failures,commonCheckpointMatched:common,restoreExact:restored,
        frozenControlValid:byCondition.frozen.valid&&record.training.frozen.teachingMatched&&record.training.frozen.changedSynapses===0,...byCondition};
    }
    record.status='complete';
  }catch(error){record.failures.push('hard-execution-error');record.executionError=error instanceof Error?error.stack:String(error);}
  finally{
    session?.dispose();const check=verifyGuidanceHashes(closure);record.sourcesUnchanged=check.pass;if(!check.pass)record.failures.push('source-lock-changed');
    record.changedSources=check.changed;record.wallSeconds=(performance.now()-wall)/1000;record.finishedAt=new Date().toISOString();
    immutableJSON(resolve(directory,'result.json'),record);
  }
  return record;
}

function verifyApprovedProtocol(p){
  if(guidanceHash(p)!==APPROVED_PROTOCOL_SHA||createHash('sha256').update(readFileSync(DEFAULT_PROTOCOL)).digest('hex')!==APPROVED_RAW_SHA)
    throw Error('Protocol differs from the exact Root-approved canonical or raw hash');
}
function makeExecutionLock(p,mode){
  verifyApprovedProtocol(p);const closure=collectGuidanceClosure();
  return {format:1,rootApproved:true,approvedAt:'2026-10-23 parent task: exact protocol and conditional fresh validation approved',
    protocolSHA256:guidanceHash(p),protocolRawSHA256:APPROVED_RAW_SHA,mode,nodeVersion:process.version,
    sourceHashes:closure.sourceHashes,closure,createdAt:new Date().toISOString(),
    implementationSHA256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),
    recoveryPolicy:'Completed seed evidence is immutable. A started but uncompleted seed is retained as a failed interrupted attempt; resume only unstarted seeds. No layout or seed retries.'};
}
function acquireRunner(directory,resume){
  const path=resolve(directory,'runner.lock');
  if(existsSync(path)){
    const old=JSON.parse(readFileSync(path,'utf8'));let alive=false;
    try{process.kill(old.pid,0);alive=true;}catch{}
    if(alive)throw Error('Another runner is still alive: '+old.pid);
    if(!resume)throw Error('A stale runner lock exists; use explicit resume without overwriting evidence');
    unlinkSync(path);
  }
  writeFileSync(path,JSON.stringify({pid:process.pid,at:new Date().toISOString()})+'\n',{flag:'wx'});
  return ()=>{if(existsSync(path)&&JSON.parse(readFileSync(path,'utf8')).pid===process.pid)unlinkSync(path);};
}
function shortResult(result){
  return {seed:result.seed,target:result.target,status:result.status,failures:result.failures,
    native:result.mappings.native?{valid:result.mappings.native.valid,learned:result.mappings.native.learned?.tailPreferenceTarget,
      erased:result.mappings.native.erased?.tailPreferenceTarget,restoredExact:result.mappings.native.restoreExact}:null,
    swapped:result.mappings.swapped?{valid:result.mappings.swapped.valid,learned:result.mappings.swapped.learned?.tailPreferenceTarget,
      erased:result.mappings.swapped.erased?.tailPreferenceTarget,restoredExact:result.mappings.swapped.restoreExact}:null,
    wallSeconds:result.wallSeconds};
}

export async function executeGuidanceAcceptance({outputDirectory}){
  const p=loadGuidanceProtocol();verifyApprovedProtocol(p);
  const directory=resolve(outputDirectory);if(existsSync(directory))throw Error('Acceptance directory already exists; do not repeat or overwrite this acceptance');
  mkdirSync(directory,{recursive:true});const lock=makeExecutionLock(p,'development-executor-acceptance-8401-A');
  immutableJSON(resolve(directory,'run-lock.json'),lock);const release=acquireRunner(directory,false);
  let result;
  try{
    const backend=await loadGuidanceRuntime();
    if(!verifyGuidanceHashes(lock.closure).pass)throw Error('Source changed before acceptance construction');
    result=await runGuidanceAnimal(8401,'A',p,resolve(directory,'seed-8401'),directory,lock.closure,backend);
    const integrity=result.status==='complete'&&result.sourcesUnchanged&&result.failures.length===0
      &&p.probe.mappings.every(mapping=>result.mappings[mapping]?.valid&&result.mappings[mapping]?.restoreExact
        &&result.mappings[mapping]?.commonCheckpointMatched&&result.mappings[mapping]?.frozenControlValid);
    const receipt={format:1,kind:'executor-acceptance-not-cohort-evidence',accepted:integrity,seed:8401,target:'A',
      protocolSHA256:guidanceHash(p),implementationSHA256:lock.implementationSHA256,sourceHashes:lock.sourceHashes,
      elapsedSeconds:result.wallSeconds,result:shortResult(result),estimatedCohortMinutes:result.wallSeconds*16/60,
      scientificLearningSuccess:null,newHeldout:false};
    immutableJSON(resolve(directory,'acceptance.json'),receipt);console.log(JSON.stringify(receipt.result));return receipt;
  }finally{release();}
}

export async function executeGuidanceCohort({outputDirectory,acceptancePath,resume=false}){
  const p=loadGuidanceProtocol();verifyApprovedProtocol(p);const directory=resolve(outputDirectory),fresh=!existsSync(directory);
  if(!fresh&&!resume)throw Error('Cohort output exists; explicit seed-boundary resume required');
  if(fresh)mkdirSync(directory,{recursive:true});
  const acceptance=JSON.parse(readFileSync(acceptancePath,'utf8')),current=makeExecutionLock(p,'fresh-development-16-seeds');
  if(acceptance.accepted!==true||acceptance.protocolSHA256!==guidanceHash(p)||acceptance.implementationSHA256!==current.implementationSHA256
    ||!equal(acceptance.sourceHashes,current.sourceHashes))throw Error('A passing executor acceptance for this exact implementation and source closure is required');
  const lockPath=resolve(directory,'run-lock.json'),lock=fresh?current:JSON.parse(readFileSync(lockPath,'utf8'));
  if(fresh)immutableJSON(lockPath,lock);
  requireGuidanceRunLock(lock,p);
  if(!equal(lock.sourceHashes,current.sourceHashes)||!verifyGuidanceHashes(lock.closure).pass)throw Error('Locked runtime closure changed');
  const release=acquireRunner(directory,resume),results=[];
  immutableJSON(resolve(directory,'execution-start-'+Date.now()+'.json'),{pid:process.pid,at:new Date().toISOString(),resume,
    implementationSHA256:lock.implementationSHA256,protocolSHA256:guidanceHash(p),estimatedMinutes:acceptance.estimatedCohortMinutes});
  try{
    const backend=await loadGuidanceRuntime();
    for(const seed of p.seeds){
      const seedDirectory=resolve(directory,'seed-'+seed),resultPath=resolve(seedDirectory,'result.json');
      if(existsSync(resultPath)){results.push(JSON.parse(readFileSync(resultPath,'utf8')));continue;}
      if(existsSync(seedDirectory)){
        const failed={seed,target:seed%2?'B':'A',status:'failed',sourcesUnchanged:verifyGuidanceHashes(lock.closure).pass,
          failures:['hard-interruption-before-seed-completion'],training:{},mappings:{},finishedAt:new Date().toISOString()};
        immutableJSON(resultPath,failed);results.push(failed);console.log(JSON.stringify(shortResult(failed)));continue;
      }
      const sourceCheck=verifyGuidanceHashes(lock.closure);if(!sourceCheck.pass)throw Error('Locked source changed before seed '+seed+': '+sourceCheck.changed.join(','));
      const result=await runGuidanceAnimal(seed,seed%2?'B':'A',p,seedDirectory,directory,lock.closure,backend);
      results.push(result);console.log(JSON.stringify(shortResult(result)));
      if(!result.sourcesUnchanged)throw Error('Source lock changed during seed '+seed);
    }
    const summary=summarizeGuidanceValidation(results,p);
    summary.sourceClosureUnchanged=verifyGuidanceHashes(lock.closure).pass;
    summary.completedSeedEvidenceHashes=Object.fromEntries(p.seeds.map(seed=>[seed,createHash('sha256')
      .update(readFileSync(resolve(directory,'seed-'+seed,'result.json'))).digest('hex')]));
    const summaryPath=resolve(directory,'summary.json');if(!existsSync(summaryPath))immutableJSON(summaryPath,summary);
    progress(directory,{stage:'complete',seedsCompleted:results.length,predeclaredCriteriaMet:summary.predeclaredCriteriaMet});
    return summary;
  }catch(error){
    immutableJSON(resolve(directory,'cohort-crash-'+Date.now()+'.json'),{pid:process.pid,at:new Date().toISOString(),error:error instanceof Error?error.stack:String(error),
      completedSeeds:results.map(x=>x.seed),partialSummary:summarizeGuidanceValidation(results,p)});
    throw error;
  }finally{release();}
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++){
    const key=args[i];if(key==='--resume'){options.resume=true;continue;}
    if(!['--mode','--out','--acceptance','--protocol'].includes(key)||args[i+1]===undefined)throw Error('Unknown or missing validation CLI option');
    options[key.slice(2)]=args[++i];
  }
  try{
    const mode=options.mode??'review';
    if(mode==='review')console.log(JSON.stringify(planGuidanceValidation(loadGuidanceProtocol(options.protocol??DEFAULT_PROTOCOL))));
    else if(mode==='acceptance'){
      if(!options.out)throw Error('Acceptance needs a fresh --out directory');
      const r=await executeGuidanceAcceptance({outputDirectory:options.out});
      console.log(JSON.stringify({accepted:r.accepted,protocolSHA256:r.protocolSHA256,implementationSHA256:r.implementationSHA256,
        elapsedSeconds:r.elapsedSeconds,estimatedCohortMinutes:r.estimatedCohortMinutes}));process.exitCode=r.accepted?0:1;
    }else if(mode==='cohort'){
      if(!options.out||!options.acceptance)throw Error('Cohort needs --out and --acceptance receipt');
      const r=await executeGuidanceCohort({outputDirectory:options.out,acceptancePath:options.acceptance,resume:options.resume??false});
      console.log(JSON.stringify({cohortComplete:true,predeclaredCriteriaMet:r.predeclaredCriteriaMet,
        mappings:Object.fromEntries(Object.entries(r.mappings).map(([mapping,x])=>[mapping,{positiveSeeds:x.positiveSeeds,
          assigned:x.assigned,meanImprovement:x.meanImprovement,criteriaMet:x.criteriaMet,targets:x.targets}])),
        failedSeeds:r.allFailures.map(x=>x.seed)}));
    }else throw Error('Unknown validation mode');
  }catch(error){console.error(JSON.stringify({validationExecutionFailed:true,pid:process.pid,error:error instanceof Error?error.stack:String(error)}));process.exitCode=1;}
}
