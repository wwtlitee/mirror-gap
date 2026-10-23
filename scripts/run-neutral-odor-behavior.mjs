import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const CONFIG=new URL('../config/neutral-odor-behavior-8.3.0.json',import.meta.url);
const sha=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const HELDOUT=Array.from({length:8},(_,i)=>6100+i),PILOT=[3100,3101];
const GRAPH_HASH='bb60bd82b8274e9530c3534ebe02f12284b6baabcddd8d2535088cfb56e6be2c';
const EMPTY_FOOD={apple:0,banana:0,burger:0,pizza:0,fries:0,sandwich:0,fig:0};
const CONDITIONS=['baseline','paired','unpaired','frozen','erased','restored'];
const writeJSON=(file,value)=>fs.writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',encoding:'utf8'});
const average=values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null;
const finite=Number.isFinite;

export function validateNeutralProtocol(p,{allowPilot=false}={}){
  const fail=()=>{throw Error('中性气味协议与预设边界不一致');};
  const pilot=p?.phase==='development-pilot';
  if(!p||p.format!==1||p.productVersion!=='8.3.0'||p.modelVersion!=='0.0.1a'
    ||(pilot?!allowPilot:p.phase!=='held-out-neutral-behavior')
    ||!same(p.seeds,pilot?PILOT:HELDOUT)||!same(p.pilotSeeds,PILOT)
    ||!Number.isInteger(p.workers)||p.workers<1||p.workers>3
    ||!same(p.training,{trials:6,trialSeconds:14,food:'burger',actualConsumptionRequired:true,
      consumptionTicksPerTrial:1,requiredRewardPulses:6,maxFirstBiteSeconds:3,pairedPostBiteSeconds:1,
      unpairedGapSeconds:3,traceTolerance:1e-8,cueRule:'even-A-odd-B',
      cueExposure:'full-field-source-follows-body-during-training-only',standardExposure:'place-on-real-food-surface-no-autonomous-foraging-claim'})
    ||!same(p.probe,{seconds:20,analysisWindowSeconds:10,stepSeconds:.02,sampleEverySeconds:.1,
      frozen:true,rewardEnabled:false,originalFoodNavigation:true,foods:EMPTY_FOOD})
    ||!same(p.release,{x:-3.6,z:1.5,surfaceSearchY:1.5,surfaceSearchDistance:1,heightScale:.09,
      heightEpsilon:.0001,requiredSupportedFeet:6,headingRule:'seed%4<2?0:pi'})
    ||!same(p.identity,{id:'33333333-3333-4333-8333-333333333333',seed:'0123456789abcdef0123456789abcdef',
      createdAt:1000,adoptedAt:2000,name:'中性气味实验'})
    ||!same(p.body,{satiety:25,thirst:.1,contactSeconds:4,focus:'eat',hour:12})
    ||!same(p.cueSources,{left:{position:[-3.6,1.05,.85],strength:1,range:1},right:{position:[-3.6,1.05,2.15],strength:1,range:1}})
    ||!same(p.mappings,{native:{left:'A',right:'B'},swapped:{left:'B',right:'A'}})
    ||!same(p.conditions,CONDITIONS)
    ||!same(p.criteria,{primaryMetric:'tail-time-mean-distance-preference-change',preferenceFormula:'(d_CSminus-d_CSplus)/(d_CSminus+d_CSplus)',
      directionFractionMin:.75,meanPairedOverUnpairedMin:.2,meanPairedOverFrozenMin:.2,baselineMeanAbsMax:.2,
      positiveIsStrict:true,nativeAndSwappedRequired:true,exactCausalControlsRequired:true,initialCueNoCueTrajectoryEqualityRequired:true})
    ||p.originalMotorGraphSHA256!==GRAPH_HASH)fail();
  return p;
}

export function pilotProtocol(formal){
  validateNeutralProtocol(formal);
  return {...structuredClone(formal),phase:'development-pilot',seeds:[...PILOT]};
}
export const cueForSeed=seed=>seed%2===0?'A':'B';
export const headingForSeed=seed=>seed%4<2?0:Math.PI;

export function preferenceIndex(distancePlus,distanceMinus){
  if(![distancePlus,distanceMinus].every(value=>finite(value)&&value>=0))throw Error('Cue distances must be finite and nonnegative');
  return distancePlus+distanceMinus===0?0:(distanceMinus-distancePlus)/(distanceMinus+distancePlus);
}

export function summarizePreference(samples,rewardedCue,probe){
  const other=rewardedCue==='A'?'B':'A',start=probe.seconds-probe.analysisWindowSeconds;
  if(!['A','B'].includes(rewardedCue)||!Array.isArray(samples)||samples.length<2
    ||Math.abs(samples[0].elapsed)>1e-7||Math.abs(samples.at(-1).elapsed-probe.seconds)>1e-7)throw Error('Probe samples must span the entire declared time window');
  let integral=0,duration=0,nIntervals=0;
  for(let i=1;i<samples.length;i++){
    const left=samples[i-1],right=samples[i],dt=right.elapsed-left.elapsed;
    if(!finite(dt)||dt<=0)throw Error('Probe samples must have strictly increasing times');
    const from=Math.max(start,left.elapsed),to=Math.min(probe.seconds,right.elapsed);
    if(to<=from)continue;
    const a=preferenceIndex(left.distances[rewardedCue],left.distances[other]);
    const b=preferenceIndex(right.distances[rewardedCue],right.distances[other]);
    const at=time=>a+(b-a)*(time-left.elapsed)/dt;
    integral+=(at(from)+at(to))*.5*(to-from);duration+=to-from;nIntervals++;
  }
  if(Math.abs(duration-probe.analysisWindowSeconds)>1e-7)throw Error('Analysis window is incomplete');
  return {preferenceIndex:integral/duration,analysisWindowSeconds:duration,nIntervals,
    endpointPreference:preferenceIndex(samples.at(-1).distances[rewardedCue],samples.at(-1).distances[other])};
}

export async function reserveOutput(directory){
  const absolute=path.resolve(directory);await fs.mkdir(path.dirname(absolute),{recursive:true});
  await fs.mkdir(absolute);return absolute;
}

export function summarizeProbeIntegrity(frames,{initialWeightSHA256,initialAteSeconds,initialConsumedAmount}){
  const failed={food:0,consumption:0,reward:0,plasticity:0,cueRoute:0,originalForaging:0};
  let frozen=true;
  for(const frame of frames){
    if(frame.homeFood!==0||!Object.values(frame.foodStock).every(value=>value===0))failed.food++;
    if(frame.ateSeconds!==initialAteSeconds||frame.consumedAmount!==initialConsumedAmount)failed.consumption++;
    if(frame.rewardEnabled!==false||frame.rewardPulses!==0||frame.rewardUntilMs!==0)failed.reward++;
    if(frame.frozen!==true||frame.weightSHA256!==initialWeightSHA256)failed.plasticity++;
    if([frame.navigationTarget,frame.routeTarget].some(value=>String(value??'').startsWith('cue-')))failed.cueRoute++;
    if(frame.synapticForaging!==false)failed.originalForaging++;
    frozen&&=frame.frozen===true;
  }
  return {pass:frames.length>0&&Object.values(failed).every(value=>value===0),
    emptyFoodAllFrames:failed.food===0,noConsumption:failed.consumption===0,noReward:failed.reward===0,
    weightsUnchanged:failed.plasticity===0,frozenAllFrames:frozen,noCueRoute:failed.cueRoute===0,
    originalFoodNavigationEnabled:failed.originalForaging===0,invariantFailureCounts:failed};
}

function mappingSummary(results,mapping,p){
  const rows=p.seeds.map(seed=>{
    const result=results.find(row=>row.seed===seed),c=result?.mappings?.[mapping]?.conditions,t=result?.training;
    const baseline=c?.baseline?.summary?.preferenceIndex;
    const changes=Object.fromEntries(CONDITIONS.filter(name=>name!=='baseline').map(name=>[name,
      finite(baseline)&&finite(c?.[name]?.summary?.preferenceIndex)?c[name].summary.preferenceIndex-baseline:null]));
    const trainNames=['paired','unpaired','frozen'],paired=t?.paired?.summary;
    const valid=result?.status==='complete'&&CONDITIONS.every(name=>c?.[name]?.status==='complete')&&Object.values(changes).every(finite);
    const trainingValid=trainNames.every(name=>{
      const s=t?.[name]?.summary;return t?.[name]?.status==='complete'&&s.actualConsumption===true
        &&s.consumptionTicks===p.training.trials&&Math.abs(s.ateSeconds-p.training.trials*p.probe.stepSeconds)<1e-7
        &&s.rewardPulses===p.training.requiredRewardPulses&&s.pulsesFromSameStep===true
        &&Math.abs(s.consumedAmount-paired.consumedAmount)<1e-10&&s.cueExposureMs===paired.cueExposureMs;
    })&&t?.frozen?.summary?.weightsAllOne===true
      &&t?.unpaired?.summary?.minimumUnpairedGapMs>=p.training.unpairedGapSeconds*1000
      &&t?.unpaired?.summary?.naturallyDecayedBeforeUnpaired===true
      &&t?.unpaired?.summary?.naturallyDecayedBeforeUnpairedBites===true;
    const causal=Boolean(valid&&trainingValid&&result?.sourcesUnchanged&&result?.noCue?.status==='complete'
      &&CONDITIONS.every(name=>{
        const s=c[name].summary;return s.emptyFoodAllFrames&&s.noConsumption&&s.noReward&&s.weightsUnchanged
          &&s.noCueRoute&&s.originalFoodNavigationEnabled&&s.originalMotorFrames>0
          &&s.frozenAllFrames===true&&s.physicsFrameCount===Math.round(p.probe.seconds/p.probe.stepSeconds)
          &&s.invariantFailureCounts&&Object.values(s.invariantFailureCounts).every(value=>value===0)
          &&s.initialStateHash===c.baseline.summary.initialStateHash;
      })&&c.baseline.trajectoryHash===result.noCue.trajectoryHash
      &&c.baseline.trajectoryHash===c.frozen.trajectoryHash&&c.baseline.trajectoryHash===c.erased.trajectoryHash
      &&c.paired.trajectoryHash===c.restored.trajectoryHash);
    return {seed,rewardedCue:cueForSeed(seed),status:result?.status??'missing',baselinePreference:baseline??null,
      pairedPostPreference:c?.paired?.summary?.preferenceIndex??null,
      changes,positive:valid&&changes.paired>0,pairedOverUnpaired:valid?changes.paired-changes.unpaired:null,
      pairedOverFrozen:valid?changes.paired-changes.frozen:null,valid,causalControls:causal,
      conditions:Object.fromEntries(CONDITIONS.map(name=>[name,c?.[name]?.summary??null]))};
  });
  const valid=rows.filter(row=>row.valid),positiveSeeds=rows.filter(row=>row.positive).length;
  const meanBaseline=average(valid.map(row=>row.baselinePreference));
  const meanPairedOverUnpaired=average(valid.map(row=>row.pairedOverUnpaired));
  const meanPairedOverFrozen=average(valid.map(row=>row.pairedOverFrozen));
  const causalControlsPass=rows.every(row=>row.causalControls);
  const pass=valid.length===p.seeds.length&&positiveSeeds/p.seeds.length>=p.criteria.directionFractionMin
    &&Math.abs(meanBaseline)<=p.criteria.baselineMeanAbsMax
    &&meanPairedOverUnpaired>p.criteria.meanPairedOverUnpairedMin&&meanPairedOverFrozen>p.criteria.meanPairedOverFrozenMin&&causalControlsPass;
  return {primaryMetric:p.criteria.primaryMetric,nExpectedSeeds:p.seeds.length,nValidSeeds:valid.length,
    positiveSeeds,positiveFraction:positiveSeeds/p.seeds.length,meanBaselinePreference:meanBaseline,
    positiveAbsolutePreferenceSeeds:rows.filter(row=>row.valid&&row.pairedPostPreference>0).length,
    meanPairedPostPreference:average(valid.map(row=>row.pairedPostPreference)),
    meanPairedChange:average(valid.map(row=>row.changes.paired)),meanPairedOverUnpaired,meanPairedOverFrozen,
    causalControlsPass,pass,rewardedCueGroups:Object.fromEntries(['A','B'].map(cue=>{
      const group=rows.filter(row=>row.rewardedCue===cue),usable=group.filter(row=>row.valid);
      return [cue,{nExpectedSeeds:group.length,nValidSeeds:usable.length,positiveSeeds:group.filter(row=>row.positive).length,
        meanPairedChange:average(usable.map(row=>row.changes.paired)),seeds:group.map(row=>row.seed)}];
    })),seeds:rows};
}

export function evaluateNeutralResults(results,protocol,{allowPilot=false}={}){
  validateNeutralProtocol(protocol,{allowPilot});
  const missing=protocol.seeds.filter(seed=>!results.some(row=>row.seed===seed));
  const duplicates=results.filter((row,i)=>results.findIndex(other=>other.seed===row.seed)!==i).map(row=>row.seed);
  const unexpected=results.filter(row=>!protocol.seeds.includes(row.seed)).map(row=>row.seed);
  const mappings=Object.fromEntries(Object.keys(protocol.mappings).map(name=>[name,mappingSummary(results,name,protocol)]));
  return {format:1,phase:protocol.phase,productVersion:protocol.productVersion,modelVersion:protocol.modelVersion,
    scope:'Food-free cue preference after standardized real feeding; both mappings reuse the same individuals. No autonomous feeding or biological memory claim.',
    nExpectedSeeds:protocol.seeds.length,nCompletedSeeds:results.filter(row=>row.status==='complete').length,
    missingSeeds:missing,duplicateSeeds:duplicates,unexpectedSeeds:unexpected,mappings,
    pass:!missing.length&&!duplicates.length&&!unexpected.length&&Object.values(mappings).every(row=>row.pass)};
}

export async function sourceHashes(){
  const names=[];
  async function collect(directory){
    for(const entry of await fs.readdir(path.join(ROOT,directory),{withFileTypes:true})){
      const name=directory+'/'+entry.name;
      if(entry.isDirectory())await collect(name);else if(/\.(mjs|json|sha256|bin)$/.test(entry.name))names.push(name);
    }
  }
  await collect('src');await collect('public');
  names.push('package.json','package-lock.json','scripts/run-neutral-odor-behavior.mjs','config/neutral-odor-behavior-8.3.0.json','tests/neutral-odor-protocol.test.mjs');
  names.sort();return Object.fromEntries(await Promise.all(names.map(async name=>[name,sha(await fs.readFile(path.join(ROOT,name)))])));
}

let runtime;
async function loadRuntime(){
  runtime??=Object.assign({},...await Promise.all([
    import('../src/embodied-life.mjs'),import('../public/companion-identity.mjs'),import('../public/companion-growth.mjs'),
    import('../public/pet-care.mjs'),import('../public/food-stock.mjs'),import('../public/collision-world.mjs'),
    import('../public/resource-contact.mjs'),import('../public/resource-landing.mjs')]));
  return runtime;
}

function stock(sim,values=EMPTY_FOOD){
  Object.assign(runtime.foodStock(sim.state),values);runtime.syncFoodTotal(sim.state);
}
function resident(p,seed){
  const sim=new runtime.EmbodiedLife(null,{seed,learningMode:'neutral'}),s=sim.state;
  const companion=runtime.createCompanion({id:p.identity.id,seed:p.identity.seed,now:p.identity.createdAt});
  runtime.adoptCompanion(companion,p.identity.name,p.identity.adoptedAt);runtime.validateCompanion(companion);s.companion=companion;
  s.living.care=runtime.createCare();stock(sim);
  Object.assign(s.actor,{bodyScale:runtime.growthSummary(companion).bodyScale,heading:headingForSeed(seed),velocity:[0,0,0],
    contact:true,zoneId:'feed',mode:'activity',action:'observe'});
  s.needs.satiety=p.body.satiety;s.living.physiology.thirst=p.body.thirst;s.living.contactSeconds=p.body.contactSeconds;
  s.living.focus.action=p.body.focus;s.living.clock={mode:'preview',hour:p.body.hour,anchor:s.simSeconds};sim.setSpeed(1);
  assert.equal(s.synapticForaging,false,'Original food navigation must remain enabled');
  assert.equal(sim.neural.graph.neurons,4386);assert.equal(sim.neural.graph.pre.length,302896);
  assert.equal(typeof sim.neural.learning?.setCues,'function','Neutral cue learning API is required');
  return sim;
}

function initialPose(sim,p,food=null){
  const s=sim.state,a=s.actor,scale=a.bodyScale;
  if(food){
    const pose=runtime.withFoodStock(s,()=>runtime.resourceLandingPoses(food,scale)[0]);
    assert.ok(pose,'Actual training food requires a valid landing pose');
    Object.assign(a,structuredClone(pose),{bodyScale:scale,velocity:[0,0,0],contact:true});
  }else{
    const ground=runtime.withFoodStock(s,()=>runtime.surfaceBelow(p.release.x,p.release.surfaceSearchY,p.release.z,p.release.surfaceSearchDistance,scale));
    assert.ok(ground,'Probe release must lie on a real support');
    a.position=[p.release.x,ground.position[1]+p.release.heightScale*scale+p.release.heightEpsilon,p.release.z];
  }
  const feet=runtime.withFoodStock(s,()=>runtime.supportedFeet(a.position,a.heading,scale));
  const contact=runtime.withFoodStock(s,()=>runtime.resourceContact(a,'food'));
  assert.equal(feet,6,'All six feet must be supported at release');
  if(food)assert.equal(contact?.id,food);else assert.equal(contact,null);
  return {position:[...a.position],heading:a.heading,supportedFeet:feet,foodContact:contact};
}

function mappedCues(p,mapping){
  return Object.entries(p.cueSources).map(([side,source])=>({id:'cue-'+side,odor:p.mappings[mapping][side],...structuredClone(source),enabled:true}));
}
function setTrainingCue(sim,cue,enabled){
  sim.neural.learning.setCues(enabled?[{id:'cue-training',odor:cue,position:[...sim.state.actor.position],strength:1,range:1,enabled:true}]:[]);
}
export function resetExposureAttention(state,contactSeconds){
  const living=state.living;
  Object.assign(living.focus,{action:'eat',candidate:null,candidateSince:state.simSeconds,lastUpdatedAt:state.simSeconds});
  living.navigation={targetId:null,selectedAt:state.simSeconds,bestDistance:null,lastProgressAt:state.simSeconds,
    failedUntil:{},failedFrom:{},resourceWait:0,resourceId:null,approach:null,route:null};
  living.commitment=null;living.resourceSession=null;living.contactSeconds=contactSeconds;
  if(living.activityRetryUntil)delete living.activityRetryUntil.eat;
  if(living.activityCooldowns)living.activityCooldowns.eat=0;
}
function traceSummary(learning){
  const {eligibilityMax,dopamineMax,dopamineMean}=learning.snapshot();
  return {eligibilityMax,dopamineMax,dopamineMean};
}
function tick(sim,dt){sim.tick(dt);if(sim.neural.error)throw Error('Original neural controller failed: '+sim.neural.error);}

function train(sim,p,{name,cue,pairedTrials=null}){
  const learning=sim.neural.learning,dt=p.probe.stepSeconds;
  const result={condition:name,status:'running',trials:[],initialWeights:learning.serializeWeights(),samples:[],rewardEvents:[],consumptionEvents:[]};
  const ateStart=sim.state.stats.ateSeconds,consumedStart=learning.consumedAmount;
  let cueTicks=0,pulsesFromSameStep=true,minimumGap=Infinity;
  learning.frozen=name==='frozen';learning.rewardEnabled=true;
  try{
    for(let trial=0;trial<p.training.trials;trial++){
      const startTime=sim.state.simSeconds,startClock=learning.clockMs,expected=pairedTrials?.[trial];
      stock(sim,{...EMPTY_FOOD,[p.training.food]:100});
      resetExposureAttention(sim.state,p.body.contactSeconds);
      const attentionAtStart=structuredClone({focus:sim.state.living.focus,navigation:sim.state.living.navigation,
        commitment:sim.state.living.commitment,resourceSession:sim.state.living.resourceSession,
        activityRetryUntil:sim.state.living.activityRetryUntil??{},activityCooldowns:sim.state.living.activityCooldowns??{}});
      const pose=initialPose(sim,p,p.training.food);let bite=null,exposureTicks=0,trialCues=0,unpairedTrace=null;
      const cueTransitions=[];let previouslyEnabled=false;
      const maxSteps=Math.round(p.training.trialSeconds/dt),waitSteps=Math.round(p.training.unpairedGapSeconds/dt);
      let cueStartStep=name==='unpaired'?Infinity:0,cueEndStep=expected?expected.cueTicks:Infinity;
      for(let step=0;step<maxSteps;step++){
        if(name==='unpaired'&&bite&&step===bite.step+1+waitSteps){
          unpairedTrace=traceSummary(learning);
          assert.ok(Object.values(unpairedTrace).every(value=>value<=p.training.traceTolerance),'Unpaired odor requires naturally decayed eligibility and dopamine');
          cueStartStep=step;cueEndStep=step+expected.cueTicks;minimumGap=Math.min(minimumGap,Math.round((step-bite.step-1)*dt*1000));
        }
        const enabled=step>=cueStartStep&&step<cueEndStep;
        if(enabled!==previouslyEnabled){
          cueTransitions.push({event:enabled?'on':'off',step,elapsed:step*dt,clockMsBeforeStep:learning.clockMs,
            simSecondsBeforeStep:sim.state.simSeconds,position:[...sim.state.actor.position]});
          previouslyEnabled=enabled;
        }
        setTrainingCue(sim,cue,enabled);if(enabled){trialCues++;cueTicks++;}
        const oldAte=sim.state.stats.ateSeconds,oldPulse=learning.rewardPulses;
        const consumedAmountBefore=learning.consumedAmount,clockMsBeforeStep=learning.clockMs,bodyScaleBeforeStep=sim.state.actor.bodyScale;
        const unpairedTraceBeforeStep=name==='unpaired'&&!bite?traceSummary(learning):null;
        tick(sim,dt);const consumed=sim.state.stats.ateSeconds>oldAte+1e-10;
        if(consumed){
          assert.equal(bite,null,'Exactly one actual consumption tick is allowed per trial');
          assert.equal(sim.state.actor.consumingResource?.id,p.training.food);
          bite={step,elapsed:(step+1)*dt,time:sim.state.simSeconds,deltaAteSeconds:sim.state.stats.ateSeconds-oldAte,
            resource:structuredClone(sim.state.actor.consumingResource),position:[...sim.state.actor.position],
            consumedAmountBefore,consumedAmountAfter:learning.consumedAmount,consumedAmountDelta:learning.consumedAmount-consumedAmountBefore,
            bodyScaleBeforeStep,bodyScaleAtConsumption:sim.state.actor.bodyScale,clockMsBeforeStep,clockMsAfterStep:learning.clockMs,
            unpairedTraceBeforeStep};
          if(name==='unpaired')assert.ok(Object.values(unpairedTraceBeforeStep).every(value=>value<=p.training.traceTolerance),
            'Unpaired bite must not overlap eligibility or dopamine from the previous trial');
          result.consumptionEvents.push(bite);stock(sim);
          if(name==='paired')cueEndStep=step+1+Math.round(p.training.pairedPostBiteSeconds/dt);
        }
        if(learning.rewardPulses!==oldPulse){
          pulsesFromSameStep&&=consumed;result.rewardEvents.push({trial,time:sim.state.simSeconds,pulse:learning.rewardPulses,consumedThisStep:consumed});
        }
        if(!bite&&step*dt>=p.training.maxFirstBiteSeconds)throw Error('No genuine first bite within the standard food exposure');
        if(step%Math.round(p.probe.sampleEverySeconds/dt)===0)result.samples.push({trial,elapsed:(step+1)*dt,
          position:[...sim.state.actor.position],ateSeconds:sim.state.stats.ateSeconds,rewardPulses:learning.rewardPulses,
          cueEnabled:enabled,foodStock:structuredClone(runtime.foodStock(sim.state)),
          focus:structuredClone(sim.state.living.focus),behavior:sim.state.living.behavior,
          resourceSession:structuredClone(sim.state.living.resourceSession),commitment:structuredClone(sim.state.living.commitment),
          retry:structuredClone(sim.state.living.activityRetryUntil??{}),feedingSignal:sim.neural.behavior?.feeding??0});
        exposureTicks++;
      }
      assert.ok(bite,'Every trial needs a genuine bite');assert.ok(cueEndStep<=maxSteps-waitSteps,'Cue must end before the next reward by at least three seconds');
      if(expected)assert.equal(trialCues,expected.cueTicks,'Control cue exposure must match paired training');
      result.trials.push({trial,startTime,startClock,attentionAtStart,pose,bite,cueTicks:trialCues,
        cueExposureMs:trialCues*dt*1000,cueTransitions,unpairedTrace,
        simulatedSeconds:sim.state.simSeconds-startTime,learningMilliseconds:learning.clockMs-startClock,exposureTicks});
    }
    result.status='complete';
  }catch(error){result.status='error';result.error={name:error.name,message:error.message,stack:error.stack};}
  learning.setCues([]);stock(sim);
  result.finalWeights=learning.serializeWeights();result.finalReadouts=structuredClone(learning.refreshReadouts({force:true}));
  result.summary={actualConsumption:result.consumptionEvents.length===p.training.trials,consumptionTicks:result.consumptionEvents.length,
    ateSeconds:sim.state.stats.ateSeconds-ateStart,consumedAmount:learning.consumedAmount-consumedStart,
    rewardPulses:learning.rewardPulses,pulsesFromSameStep,cueExposureMs:cueTicks*dt*1000,
    weightsAllOne:result.finalWeights.efficacy.every(value=>value===1),
    changedSynapses:result.finalWeights.efficacy.filter(value=>value<1-1e-10).length,
    minimumUnpairedGapMs:finite(minimumGap)?minimumGap:null,
    naturallyDecayedBeforeUnpaired:name!=='unpaired'||result.trials.length===p.training.trials&&result.trials.every(trial=>
      trial.unpairedTrace&&Object.values(trial.unpairedTrace).every(value=>value<=p.training.traceTolerance)),
    naturallyDecayedBeforeUnpairedBites:name!=='unpaired'||result.trials.length===p.training.trials&&result.trials.every(trial=>
      trial.bite.unpairedTraceBeforeStep&&Object.values(trial.bite.unpairedTraceBeforeStep).every(value=>value<=p.training.traceTolerance))};
  return result;
}

function sample(sim,p,cues,elapsed){
  const s=sim.state,a=s.actor;
  return {elapsed,position:[...a.position],velocity:[...a.velocity],heading:a.heading,action:a.action,
    distances:Object.fromEntries(cues.map(cue=>[cue.odor,Math.hypot(...cue.position.map((value,i)=>value-a.position[i]))])),
    ateSeconds:s.stats.ateSeconds,foodStock:structuredClone(runtime.foodStock(s)),rewardPulses:sim.neural.learning.rewardPulses,
    homeFood:s.home.food,
    context:structuredClone(sim.neural.sensory?.context??{}),route:structuredClone(s.living.navigation.route),
    motor:structuredClone(sim.neural.motor),originalMotorStep:sim.neural.brain.step,originalMotorRNG:sim.neural.rng,
    cueSignals:structuredClone((sim.neural.sensory?.signals??[]).filter(signal=>String(signal.id).startsWith('cue-')))};
}
function initialStateHash(sim){
  const state=structuredClone(sim.state),neural=sim.neural.serialize();delete state.synapticMemory;delete neural.synapticMemory;
  return sha(JSON.stringify({state,neural}));
}

function probe(sim,p,{name,cue,mapping,noCue=false}){
  const learning=sim.neural.learning,cues=mappedCues(p,mapping),result={condition:name,status:'running',samples:[],physicsTrace:[]};
  stock(sim);learning.frozen=true;learning.rewardEnabled=false;learning.setCues(noCue?[]:cues);
  result.initialSupport=initialPose(sim,p);result.initialWeights=learning.serializeWeights();
  result.initialWeightCanonical=JSON.stringify(result.initialWeights);result.initialWeightSHA256=sha(result.initialWeightCanonical);
  result.initialReadouts=structuredClone(learning.refreshReadouts({force:true}));
  const stateHash=initialStateHash(sim),trace=createHash('sha256'),ateStart=sim.state.stats.ateSeconds,consumedStart=learning.consumedAmount;
  const integrityFrame=()=>({homeFood:sim.state.home.food,foodStock:structuredClone(runtime.foodStock(sim.state)),
    ateSeconds:sim.state.stats.ateSeconds,consumedAmount:learning.consumedAmount,
    rewardEnabled:learning.rewardEnabled,rewardPulses:learning.rewardPulses,rewardUntilMs:learning.rewardUntilMs,
    frozen:learning.frozen,weightSHA256:sha(JSON.stringify(learning.serializeWeights())),
    navigationTarget:sim.state.living.navigation.targetId,routeTarget:sim.state.living.navigation.route?.targetId??null,
    synapticForaging:sim.state.synapticForaging});
  const initialIntegrity=integrityFrame();
  result.samples.push(sample(sim,p,cues,0));
  try{
    for(let step=1;step<=Math.round(p.probe.seconds/p.probe.stepSeconds);step++){
      tick(sim,p.probe.stepSeconds);const s=sim.state,a=s.actor;
      const trajectory={position:[...a.position],velocity:[...a.velocity],heading:a.heading,action:a.action,
        motor:structuredClone(sim.neural.motor),step:sim.neural.brain.step,rng:sim.neural.rng,
        route:structuredClone(s.living.navigation.route),ate:s.stats.ateSeconds};
      const trajectoryCanonical=JSON.stringify(trajectory);trace.update(trajectoryCanonical);
      result.physicsTrace.push({step,elapsed:step*p.probe.stepSeconds,trajectory,trajectoryCanonical,invariants:integrityFrame()});
      if(step%Math.round(p.probe.sampleEverySeconds/p.probe.stepSeconds)===0)result.samples.push(sample(sim,p,cues,step*p.probe.stepSeconds));
    }
    result.status='complete';
  }catch(error){result.status='error';result.error={name:error.name,message:error.message,stack:error.stack};}
  result.finalWeights=learning.serializeWeights();result.trajectoryHash=trace.digest('hex');
  result.finalWeightCanonical=JSON.stringify(result.finalWeights);result.initialIntegrity=initialIntegrity;
  const integrity=summarizeProbeIntegrity([initialIntegrity,...result.physicsTrace.map(frame=>frame.invariants)],
    {initialWeightSHA256:result.initialWeightSHA256,initialAteSeconds:ateStart,initialConsumedAmount:consumedStart});
  result.summary={...(result.status==='complete'?summarizePreference(result.samples,cue,p.probe):{preferenceIndex:null}),
    ...integrity,physicsFrameCount:result.physicsTrace.length,originalMotorFrames:sim.neural.brain.step/400,initialStateHash:stateHash};
  return result;
}

export async function runSeed({seed,protocol:p,output,lockedHashes,lockSHA256}){
  const started=performance.now(),r={seed,phase:p.phase,productVersion:p.productVersion,runLockSHA256:lockSHA256,
    rewardedCue:cueForSeed(seed),startedAt:new Date().toISOString(),status:'running',training:{},mappings:{}};
  try{
    r.sourceHashesBefore=await sourceHashes();assert.deepEqual(r.sourceHashesBefore,lockedHashes,'Sources changed after registration');await loadRuntime();
    for(const name of ['paired','unpaired','frozen']){
      const sim=resident(p,seed),condition=train(sim,p,{name,cue:r.rewardedCue,pairedTrials:name==='paired'?null:r.training.paired.trials});
      r.training[name]=condition;await writeJSON(path.join(output,`seed-${seed}-${name}-training.json`),condition);
      assert.equal(condition.status,'complete',condition.error?.message);assert.equal(condition.summary.actualConsumption,true);
      assert.equal(condition.summary.rewardPulses,p.training.requiredRewardPulses);await writeJSON(path.join(output,`seed-${seed}-${name}-weights.json`),condition.finalWeights);
    }
    const baseline=resident(p,seed).neural.learning.serializeWeights();
    r.noCue=probe(resident(p,seed),p,{name:'no-cue',cue:r.rewardedCue,mapping:'native',noCue:true});
    await writeJSON(path.join(output,`seed-${seed}-no-cue.json`),r.noCue);
    for(const mapping of Object.keys(p.mappings)){
      const group={conditions:{}};r.mappings[mapping]=group;
      for(const name of CONDITIONS){
        const sim=resident(p,seed),saved=name==='paired'||name==='restored'?r.training.paired.finalWeights:
          name==='unpaired'?r.training.unpaired.finalWeights:name==='frozen'?r.training.frozen.finalWeights:baseline;
        sim.neural.learning.restoreWeights(saved);sim.state.synapticMemory=sim.neural.learning.serializeWeights();
        const condition=probe(sim,p,{name,cue:r.rewardedCue,mapping});group.conditions[name]=condition;
        await writeJSON(path.join(output,`seed-${seed}-${name}-${mapping}.json`),condition);
      }
    }
    r.status='complete';
  }catch(error){r.status='error';r.error={name:error.name,message:error.message,stack:error.stack};}
  r.sourceHashesAfter=await sourceHashes();r.sourcesUnchanged=same(r.sourceHashesBefore,r.sourceHashesAfter)&&same(r.sourceHashesAfter,lockedHashes);
  r.wallSeconds=(performance.now()-started)/1000;r.finishedAt=new Date().toISOString();
  await writeJSON(path.join(output,`seed-${seed}.json`),r);return r;
}

export async function runStudy({protocol:p,output,workers=p.workers,allowPilot=false}){
  validateNeutralProtocol(p,{allowPilot});if(!Number.isInteger(workers)||workers<1||workers>3)throw Error('Use one to three workers');
  const lockedHashes=await sourceHashes();assert.equal(lockedHashes['src/functional-connectome.json'],GRAPH_HASH);
  const directory=await reserveOutput(output),lock={format:1,startedAt:new Date().toISOString(),protocol:p,workers,
    sourceHashes:lockedHashes,sourceCount:Object.keys(lockedHashes).length,
    preregistration:p.phase==='development-pilot'?'Development-only results; never pooled with held-out results.':'Locked before any held-out simulation. No tuning using these results.',
    software:{node:process.version,platform:process.platform,architecture:process.arch}};
  await writeJSON(path.join(directory,'run-lock.json'),lock);const lockSHA256=sha(await fs.readFile(path.join(directory,'run-lock.json')));
  const results=[];let next=0;
  async function lane(){
    while(next<p.seeds.length){
      const seed=p.seeds[next++];
      await new Promise((resolve,reject)=>{
        const worker=new Worker(new URL(import.meta.url),{workerData:{kind:'neutral-odor-seed',seed,protocol:p,output:directory,lockedHashes,lockSHA256}});
        let received=false;worker.once('message',value=>{received=true;resolve(value);});worker.once('error',reject);
        worker.once('exit',code=>{if(code!==0||!received)reject(Error(`Seed ${seed} worker exited ${code}`));});
      });
      const result=JSON.parse(await fs.readFile(path.join(directory,`seed-${seed}.json`),'utf8'));results.push(result);
      console.log(JSON.stringify({seed,status:result.status,error:result.error?.message,wallSeconds:result.wallSeconds,completed:results.length,total:p.seeds.length}));
    }
  }
  await Promise.all(Array.from({length:workers},lane));results.sort((a,b)=>a.seed-b.seed);
  const summary=evaluateNeutralResults(results,p,{allowPilot});summary.runLockSHA256=lockSHA256;
  summary.sourceHashesAfter=await sourceHashes();summary.sourcesUnchanged=same(summary.sourceHashesAfter,lockedHashes);summary.pass&&=summary.sourcesUnchanged;
  summary.finishedAt=new Date().toISOString();await writeJSON(path.join(directory,'summary.json'),summary);return summary;
}

async function main(){
  const args=process.argv.slice(2);let config=CONFIG,output,workers,pilot=false,validate=false;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--out')output=args[++i];else if(args[i]==='--config')config=args[++i];
    else if(args[i]==='--workers')workers=Number(args[++i]);else if(args[i]==='--pilot')pilot=true;
    else if(args[i]==='--validate')validate=true;else throw Error('Unknown argument: '+args[i]);
  }
  let protocol=JSON.parse(await fs.readFile(config,'utf8'));if(pilot)protocol=pilotProtocol(protocol);validateNeutralProtocol(protocol,{allowPilot:pilot});
  if(validate){console.log(JSON.stringify({valid:true,protocol}));return;}
  if(!output)throw Error('Provide a new --out directory; existing evidence is immutable');
  const summary=await runStudy({protocol,output,workers:workers??protocol.workers,allowPilot:pilot});
  console.log(JSON.stringify({phase:summary.phase,pass:summary.pass,mappings:Object.fromEntries(Object.entries(summary.mappings).map(([key,value])=>[key,
    {positiveSeeds:value.positiveSeeds,meanPairedChange:value.meanPairedChange,meanPairedOverUnpaired:value.meanPairedOverUnpaired,causalControlsPass:value.causalControlsPass}]))}));
  if(!summary.pass)process.exitCode=1;
}

if(!isMainThread&&workerData?.kind==='neutral-odor-seed'){
  const r=await runSeed(workerData);parentPort.postMessage({seed:r.seed,status:r.status});
}else if(isMainThread&&process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
