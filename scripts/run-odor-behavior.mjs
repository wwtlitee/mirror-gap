import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {VERSION as RUNTIME_PRODUCT_VERSION} from '../public/world-spec.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const CONFIG=new URL('../config/odor-behavior-8.2.0.json',import.meta.url);
const sha=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const EXPECTED_SEEDS=Array.from({length:8},(_,i)=>2000+i);
const OLD_GRAPH_HASH='bb60bd82b8274e9530c3534ebe02f12284b6baabcddd8d2535088cfb56e6be2c';

export function validateOdorProtocol(p){
  const fail=()=>{throw Error('正式气味行为协议与预注册条件不一致');};
  if(!p||p.format!==1||p.productVersion!=='8.2.0'||p.modelVersion!=='0.0.1a'||p.phase!=='held-out-behavior'
    ||!same(p.seeds,EXPECTED_SEEDS)||!Number.isInteger(p.workers)||p.workers<1||p.workers>3
    ||!same(p.training,{seconds:18,requiredRewardPulses:6,targetRule:'even-burger-odd-pizza',actualConsumptionRequired:true})
    ||!same(p.probe,{seconds:30,stepSeconds:.02,sampleEverySeconds:.1,frozen:true,rewardEnabled:false})
    ||!same(p.release,{x:-3.6,z:1.5,surfaceSearchY:1.5,surfaceSearchDistance:1,heightScale:.09,heightEpsilon:.0001,requiredSupportedFeet:6,mustHaveNoFoodContact:true,headingRule:'seed%4<2?0:pi'})
    ||!same(p.body,{satiety:25,thirst:.1,contactSeconds:4,focus:'eat',hour:12})
    ||!same(p.foods,{apple:0,banana:0,burger:100,pizza:100,fries:0,sandwich:0,fig:0})
    ||!same(p.mappings,{native:{},swapped:{burger:'pizza',pizza:'burger'}})
    ||!same(p.conditions,['trained','frozen','erased','restored'])
    ||!same(p.criteria,{primaryMetric:'endpoint-target-surface-distance-reduction-advantage',directionFractionMin:.75,meanAdvantageMinMeters:.25,positiveIsStrict:true,nativeAndSwappedRequired:true,exactCausalControlsRequired:true})
    ||p.originalMotorGraphSHA256!==OLD_GRAPH_HASH)fail();
  const i=p.identity;
  if(!i||i.id!=='11111111-1111-4111-8111-111111111111'||i.seed!=='0123456789abcdef0123456789abcdef'
    ||i.createdAt!==1000||i.adoptedAt!==2000||i.name!=='气味实验')fail();
  return p;
}

export const targetForSeed=seed=>seed%2===0?'burger':'pizza';
export const headingForSeed=seed=>seed%4<2?0:Math.PI;
export function expectedPhysicalTarget(chemical,assignments){
  const target=['burger','pizza'].find(physical=>(assignments[physical]??physical)===chemical);
  if(!target)throw Error('气味交换必须保持两种化学刺激的一一对应');return target;
}

export async function reserveOutput(directory){
  const absolute=path.resolve(directory);
  await fs.mkdir(path.dirname(absolute),{recursive:true});
  await fs.mkdir(absolute); // EEXIST is intentional: delivered evidence is immutable.
  return absolute;
}

async function sourceHashes(){
  const names=[];
  async function collect(directory){
    for(const entry of await fs.readdir(path.join(ROOT,directory),{withFileTypes:true})){
      const name=directory+'/'+entry.name;
      if(entry.isDirectory())await collect(name);
      else if(/\.(mjs|json|sha256)$/.test(entry.name))names.push(name);
    }
  }
  await collect('src');await collect('public');
  names.push('package.json','scripts/run-odor-behavior.mjs','config/odor-behavior-8.2.0.json');names.sort();
  return Object.fromEntries(await Promise.all(names.map(async name=>[name,sha(await fs.readFile(path.join(ROOT,name)))])));
}
const writeJSON=(file,value)=>fs.writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',encoding:'utf8'});

function mappingSummary(results,mapping,p){
  const rows=p.seeds.map(seed=>{
    const result=results.find(r=>r.seed===seed),group=result?.mappings?.[mapping],c=group?.conditions;
    const trained=c?.trained?.summary,frozen=c?.frozen?.summary;
    const valid=result?.status==='complete'&&c?.trained?.status==='complete'&&c?.frozen?.status==='complete'
      &&[trained?.startTargetDistance,trained?.endTargetDistance,frozen?.startTargetDistance,frozen?.endTargetDistance].every(Number.isFinite);
    const advantage=valid?(trained.startTargetDistance-trained.endTargetDistance)-(frozen.startTargetDistance-frozen.endTargetDistance):null;
    const causal=Boolean(result?.sourcesUnchanged&&result?.training?.trained?.status==='complete'
      &&result.training.trained.summary?.actualConsumption===true&&result.training.trained.summary.rewardPulses===6
      &&result.training?.frozen?.status==='complete'&&result.training.frozen.summary?.actualConsumption===true
      &&result.training.frozen.summary.rewardPulses===6&&result.training.frozen.summary.weightsAllOne===true
      &&p.conditions.every(name=>c?.[name]?.status==='complete'&&c[name].summary?.weightsUnchanged===true
        &&c[name].summary.rewardPulses===0&&c[name].summary.noRoute===true&&c[name].summary.originalMotorFrames>0)
      &&c.frozen.trajectoryHash===c.erased.trajectoryHash&&c.trained.trajectoryHash===c.restored.trajectoryHash);
    return {seed,trainingTarget:targetForSeed(seed),expectedTarget:expectedPhysicalTarget(targetForSeed(seed),p.mappings[mapping]),
      status:result?.status??'missing',advantageMeters:advantage,positive:advantage!==null&&advantage>0,causalControls:causal,
      conditions:Object.fromEntries(p.conditions.map(name=>[name,c?.[name]?.summary??null]))};
  });
  const valid=rows.filter(row=>row.advantageMeters!==null),positive=rows.filter(row=>row.positive).length;
  const mean=valid.length?valid.reduce((sum,row)=>sum+row.advantageMeters,0)/valid.length:null;
  const allCausal=rows.every(row=>row.causalControls);
  const feedingSuccess=Object.fromEntries(p.conditions.map(name=>[name,rows.filter(row=>{
    const first=row.conditions[name]?.firstConsumption;
    return first?.resource?.id===row.expectedTarget&&first.deltaAteSeconds>0;
  }).length]));
  return {primaryMetric:p.criteria.primaryMetric,nExpectedSeeds:p.seeds.length,nValidSeeds:valid.length,
    positiveSeeds:positive,positiveFraction:positive/p.seeds.length,meanAdvantageMeters:mean,
    directionPass:positive/p.seeds.length>=p.criteria.directionFractionMin,
    meanPass:mean!==null&&mean>p.criteria.meanAdvantageMinMeters,causalControlsPass:allCausal,
    pass:valid.length===p.seeds.length&&positive/p.seeds.length>=p.criteria.directionFractionMin&&mean>p.criteria.meanAdvantageMinMeters&&allCausal,
    feedingSuccess,rewardedFoodGroups:Object.fromEntries(['burger','pizza'].map(food=>{
      const group=rows.filter(row=>row.trainingTarget===food),values=group.filter(row=>row.advantageMeters!==null);
      return [food,{nSeeds:group.length,nValidSeeds:values.length,positiveSeeds:group.filter(row=>row.positive).length,
        meanAdvantageMeters:values.length?values.reduce((sum,row)=>sum+row.advantageMeters,0)/values.length:null,
        seeds:group.map(row=>({seed:row.seed,status:row.status,advantageMeters:row.advantageMeters,causalControls:row.causalControls}))}];
    })),seeds:rows};
}

export function evaluateBehaviorResults(results,protocol){
  validateOdorProtocol(protocol);
  const duplicates=results.filter((r,i)=>results.findIndex(other=>other.seed===r.seed)!==i).map(r=>r.seed);
  const unexpected=results.filter(r=>!protocol.seeds.includes(r.seed)).map(r=>r.seed);
  const missing=protocol.seeds.filter(seed=>!results.some(r=>r.seed===seed));
  const mappings=Object.fromEntries(Object.keys(protocol.mappings).map(mapping=>[mapping,mappingSummary(results,mapping,protocol)]));
  return {format:1,productVersion:protocol.productVersion,modelVersion:protocol.modelVersion,
    scope:'Predeclared 30-second neural odor-guided approach; actual feeding is reported separately. No complete autonomous foraging claim.',
    nExpectedSeeds:protocol.seeds.length,nCompletedSeeds:results.filter(r=>r.status==='complete').length,
    missingSeeds:missing,duplicateSeeds:duplicates,unexpectedSeeds:unexpected,mappings,
    pass:!missing.length&&!duplicates.length&&!unexpected.length&&Object.values(mappings).every(mapping=>mapping.pass)};
}

let runtime;
async function loadRuntime(){
  if(!runtime){
    const modules=await Promise.all([
      import('../src/embodied-life.mjs'),import('../public/companion-identity.mjs'),import('../public/companion-growth.mjs'),
      import('../public/pet-care.mjs'),import('../public/food-stock.mjs'),import('../public/collision-world.mjs'),
      import('../public/resource-contact.mjs'),import('../public/resource-landing.mjs')]);
    runtime=Object.assign({},...modules);
  }
  return runtime;
}

function resident(p,seed){
  const {EmbodiedLife,createCompanion,adoptCompanion,validateCompanion,createCare,foodStock,syncFoodTotal,growthSummary}=runtime;
  const sim=new EmbodiedLife(null,{seed,learningMode:'legacy-food'}),s=sim.state;
  const companion=createCompanion({id:p.identity.id,seed:p.identity.seed,now:p.identity.createdAt});
  adoptCompanion(companion,p.identity.name,p.identity.adoptedAt);validateCompanion(companion);s.companion=companion;
  s.living.care=createCare();Object.assign(foodStock(s),p.foods);syncFoodTotal(s);
  Object.assign(s.actor,{bodyScale:growthSummary(companion).bodyScale,heading:headingForSeed(seed),velocity:[0,0,0],contact:true,zoneId:'feed',mode:'activity',action:'observe'});
  s.needs.satiety=p.body.satiety;s.living.physiology.thirst=p.body.thirst;s.living.contactSeconds=p.body.contactSeconds;
  s.living.focus.action=p.body.focus;s.living.clock={mode:'preview',hour:p.body.hour,anchor:s.simSeconds};sim.setSpeed(1);
  assert.ok(sim.neural.learning,'The original neural controller must contain the new association circuit');
  assert.equal(sim.neural.graph.neurons,4386);assert.equal(sim.neural.graph.pre.length,302896);
  return sim;
}

function initialPose(sim,p,target=null){
  const {withFoodStock,surfaceBelow,supportedFeet,resourceContact,resourceLandingPoses}=runtime;
  const s=sim.state,a=s.actor,scale=a.bodyScale;
  let ground=null;
  if(target){
    const pose=withFoodStock(s,()=>resourceLandingPoses(target,scale)[0]);assert.ok(pose,'Training food needs a stable landing pose');
    Object.assign(a,structuredClone(pose),{bodyScale:scale,velocity:[0,0,0],contact:true});
  }else{
    ground=withFoodStock(s,()=>surfaceBelow(p.release.x,p.release.surfaceSearchY,p.release.z,p.release.surfaceSearchDistance,scale));
    assert.ok(ground,'Release requires a real support surface');
    a.position=[p.release.x,ground.position[1]+p.release.heightScale*scale+p.release.heightEpsilon,p.release.z];
  }
  const feet=withFoodStock(s,()=>supportedFeet(a.position,a.heading,scale));
  const contact=withFoodStock(s,()=>resourceContact(a,'food'));
  assert.equal(feet,6,'All six feet must be physically supported');
  if(target)assert.equal(contact?.id,target,'Training pose must touch the actual assigned food');
  else assert.equal(contact,null,'Probe release must have no food contact');
  return {position:[...a.position],heading:a.heading,bodyScale:scale,supportedFeet:feet,foodContact:contact,ground};
}

function sample(sim){
  const {withFoodStock,supportedFeet,resourceContact,nearestResource,foodStock}=runtime,s=sim.state,a=s.actor;
  return withFoodStock(s,()=>({time:s.simSeconds,position:[...a.position],velocity:[...a.velocity],heading:a.heading,
    contact:a.contact,supportedFeet:supportedFeet(a.position,a.heading,a),foodContact:resourceContact(a,'food'),
    resourceDistances:Object.fromEntries(['burger','pizza'].map(id=>[id,nearestResource(a.position,'food',{id,bodyScale:a.bodyScale})?.distance??null])),
    consumingResource:structuredClone(a.consumingResource??null),action:a.action,behavior:s.living.behavior,
    satiety:s.needs.satiety,ateSeconds:s.stats.ateSeconds,foodStock:structuredClone(foodStock(s)),
    motor:structuredClone(sim.neural.motor),originalMotorStep:sim.neural.brain.step,originalMotorRNG:sim.neural.rng,
    context:structuredClone(sim.neural.sensory?.context??{}),navigation:structuredClone(s.living.navigation),
    foodSignals:structuredClone((sim.neural.sensory?.signals??[]).filter(signal=>signal.resourceKind==='food'))}));
}

function runCondition(sim,p,{name,target,training=false}){
  const learning=sim.neural.learning,result={condition:name,status:'running',startedAt:new Date().toISOString(),
    initialWeights:learning.serializeWeights(),initialReadouts:structuredClone(learning.refreshReadouts({force:true})),
    samples:[],firstConsumption:null,consumptionEvents:[],rewardEvents:[]};
  const hash=createHash('sha256'),initialStock=structuredClone(runtime.foodStock(sim.state));
  const duration=training?p.training.seconds:p.probe.seconds;
  let previousAte=sim.state.stats.ateSeconds,previousRewards=learning.rewardPulses,noRoute=true;
  try{
    result.initialSupport=initialPose(sim,p,training?target:null);result.samples.push(sample(sim));
    for(let step=1;step<=Math.round(duration/p.probe.stepSeconds);step++){
      sim.tick(p.probe.stepSeconds);
      if(sim.neural.error)throw Error('Original neural controller failed: '+sim.neural.error);
      const s=sim.state,a=s.actor,ate=s.stats.ateSeconds,consumedThisStep=ate>previousAte;
      if(consumedThisStep){
        const event={time:s.simSeconds,deltaAteSeconds:ate-previousAte,resource:structuredClone(a.consumingResource),position:[...a.position]};
        result.firstConsumption??=event;result.consumptionEvents.push(event);
        if(training)assert.equal(event.resource?.id,target,'Training may consume only its assigned physical food');
      }
      previousAte=ate;
      if(learning.rewardPulses!==previousRewards){
        assert.ok(consumedThisStep,'Every reward must follow actual consumption in this exact physics step');
        result.rewardEvents.push({time:s.simSeconds,pulse:learning.rewardPulses,resource:structuredClone(a.consumingResource),ateSeconds:ate});
      }
      previousRewards=learning.rewardPulses;
      noRoute&&=s.living.navigation.route==null;
      hash.update(JSON.stringify({time:s.simSeconds,position:a.position,velocity:a.velocity,heading:a.heading,contact:a.contact,
        consumingResource:a.consumingResource??null,ateSeconds:ate,motor:sim.neural.motor,
        originalMotorStep:sim.neural.brain.step,originalMotorRNG:sim.neural.rng,route:s.living.navigation.route}));
      if(step%Math.round(p.probe.sampleEverySeconds/p.probe.stepSeconds)===0)result.samples.push(sample(sim));
    }
    result.status='complete';
  }catch(error){result.status='error';result.error={name:error.name,message:error.message,stack:error.stack};}
  result.finalWeights=learning.serializeWeights();result.trajectoryHash=hash.digest('hex');
  result.finalReadouts=structuredClone(learning.refreshReadouts({force:true}));
  const first=result.samples[0],last=result.samples.at(-1),actualConsumedByFood=Object.fromEntries(Object.entries(initialStock).map(([id,amount])=>[id,amount-runtime.foodStock(sim.state)[id]]));
  result.actualConsumedByFood=actualConsumedByFood;
  result.summary={actualConsumption:result.firstConsumption!==null&&actualConsumedByFood[target]>0,
    ateSeconds:sim.state.stats.ateSeconds-(first?.ateSeconds??0),firstConsumption:result.firstConsumption,
    rewardPulses:learning.rewardPulses,weightsUnchanged:same(result.initialWeights,result.finalWeights),
    weightsAllOne:result.finalWeights.efficacy.every(q=>q===1),changedSynapses:result.finalWeights.efficacy.filter(q=>q<1-1e-10).length,
    noRoute,originalMotorFrames:sim.neural.brain.step/400,startTargetDistance:first?.resourceDistances[target]??null,
    endTargetDistance:last?.resourceDistances[target]??null,minimumTargetDistance:result.samples.length?Math.min(...result.samples.map(row=>row.resourceDistances[target]??Infinity)):null,
    startPosition:first?.position??null,endPosition:last?.position??null};
  result.finishedAt=new Date().toISOString();
  return result;
}

export async function runSeed({seed,protocol,output,lockedHashes,lockSHA256}){
  const started=performance.now(),result={seed,productVersion:protocol.productVersion,modelVersion:protocol.modelVersion,
    runLockSHA256:lockSHA256,trainingTarget:targetForSeed(seed),releaseHeading:headingForSeed(seed),startedAt:new Date().toISOString(),status:'running',training:{},mappings:{}};
  try{
    result.sourceHashesBefore=await sourceHashes();assert.deepEqual(result.sourceHashesBefore,lockedHashes,'Sources changed after registration');
    await loadRuntime();
    for(const condition of ['trained','frozen']){
      const sim=resident(protocol,seed);sim.neural.learning.frozen=condition==='frozen';
      const training=runCondition(sim,protocol,{name:condition+'-training',target:result.trainingTarget,training:true});
      result.training[condition]=training;
      await writeJSON(path.join(output,`seed-${seed}-${condition}-training.json`),training);
      assert.equal(training.status,'complete',training.error?.message);
      assert.equal(training.summary.actualConsumption,true,'Training needs genuine target food consumption');
      assert.equal(training.summary.rewardPulses,protocol.training.requiredRewardPulses,'Training needs six actual-consumption PAM pulses');
      if(condition==='frozen')assert.equal(training.summary.weightsAllOne,true,'Frozen training must leave every efficacy at one');
      await writeJSON(path.join(output,`seed-${seed}-${condition}-weights.json`),training.finalWeights);
    }
    const trained=result.training.trained.finalWeights,frozen=result.training.frozen.finalWeights;
    for(const [mapping,assignments] of Object.entries(protocol.mappings)){
      const target=expectedPhysicalTarget(result.trainingTarget,assignments),group={expectedTarget:target,assignments,conditions:{}};
      result.mappings[mapping]=group;
      for(const condition of protocol.conditions){
        const sim=resident(protocol,seed),learning=sim.neural.learning;
        learning.frozen=true;learning.rewardEnabled=false;learning.assignments={...assignments};
        if(condition==='trained'||condition==='restored')learning.restoreWeights(trained);
        else if(condition==='frozen')learning.restoreWeights(frozen);
        else learning.restoreWeights({...trained,efficacy:trained.efficacy.map(()=>1)});
        sim.state.synapticMemory=learning.serializeWeights();
        const probe=runCondition(sim,protocol,{name:`${condition}-${mapping}`,target});
        group.conditions[condition]=probe;
        await writeJSON(path.join(output,`seed-${seed}-${condition}-${mapping}.json`),probe);
      }
    }
    result.status='complete';
  }catch(error){result.status='error';result.error={name:error.name,message:error.message,stack:error.stack};}
  result.sourceHashesAfter=await sourceHashes();result.sourcesUnchanged=same(result.sourceHashesBefore,result.sourceHashesAfter)&&same(result.sourceHashesAfter,lockedHashes);
  result.finishedAt=new Date().toISOString();result.wallSeconds=(performance.now()-started)/1000;
  await writeJSON(path.join(output,`seed-${seed}.json`),result);
  return result;
}

export async function runStudy({protocol,output,workers=protocol.workers}){
  validateOdorProtocol(protocol);
  if(!Number.isInteger(workers)||workers<1||workers>3)throw Error('Workers must be 1, 2 or 3');
  const lockedHashes=await sourceHashes();
  assert.equal(lockedHashes['src/functional-connectome.json'],OLD_GRAPH_HASH,'Original motor connectome changed');
  const directory=await reserveOutput(output),lock={format:1,startedAt:new Date().toISOString(),protocol,workers,
    sourceHashes:lockedHashes,sourceCount:Object.keys(lockedHashes).length,
    sourceHashScope:'All .mjs/.json/.sha256 files under src/ and public/, package.json, this runner and protocol config',
    software:{node:process.version,platform:process.platform,architecture:process.arch},
    preregistration:'Written before any held-out simulation starts. No thresholds, stimuli, gain or protocol may change from these results.'};
  await writeJSON(path.join(directory,'run-lock.json'),lock);
  const lockSHA256=sha(await fs.readFile(path.join(directory,'run-lock.json'))),results=[];
  let next=0;
  async function lane(){
    while(next<protocol.seeds.length){
      const seed=protocol.seeds[next++];
      const item=await new Promise((resolve,reject)=>{
        const worker=new Worker(new URL(import.meta.url),{workerData:{kind:'odor-behavior-seed',seed,protocol,output:directory,lockedHashes,lockSHA256}});
        let messageReceived=false;
        worker.once('message',message=>{messageReceived=true;resolve(message);});worker.once('error',reject);
        worker.once('exit',code=>{if(code!==0||!messageReceived)reject(Error(`Seed ${seed} worker exited ${code}`));});
      });
      results.push(JSON.parse(await fs.readFile(path.join(directory,`seed-${seed}.json`),'utf8')));
      console.log(JSON.stringify({seed,status:item.status,wallSeconds:item.wallSeconds,completed:results.length,total:protocol.seeds.length}));
    }
  }
  await Promise.all(Array.from({length:workers},lane));
  results.sort((a,b)=>a.seed-b.seed);
  const summary=evaluateBehaviorResults(results,protocol);summary.runLockSHA256=lockSHA256;
  summary.finishedAt=new Date().toISOString();summary.sourceHashesAfter=await sourceHashes();
  summary.sourcesUnchanged=same(summary.sourceHashesAfter,lockedHashes);summary.pass&&=summary.sourcesUnchanged;
  await writeJSON(path.join(directory,'summary.json'),summary);
  return summary;
}

async function main(){
  const args=process.argv.slice(2);let output,config=CONFIG,workers;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--out')output=args[++i];else if(args[i]==='--config')config=args[++i];
    else if(args[i]==='--workers')workers=Number(args[++i]);else if(args[i]!=='--validate')throw Error('Unknown argument: '+args[i]);
  }
  const protocol=validateOdorProtocol(JSON.parse(await fs.readFile(config,'utf8')));
  if(args.includes('--validate')){console.log(JSON.stringify({valid:true,protocol}));return;}
  if(!output)throw Error('Provide a new --out directory; existing output is never overwritten');
  const summary=await runStudy({protocol,output,workers:workers??protocol.workers});
  console.log(JSON.stringify({pass:summary.pass,mappings:Object.fromEntries(Object.entries(summary.mappings).map(([name,value])=>[name,{positiveSeeds:value.positiveSeeds,meanAdvantageMeters:value.meanAdvantageMeters,causalControlsPass:value.causalControlsPass,feedingSuccess:value.feedingSuccess}]))}));
  if(!summary.pass)process.exitCode=1;
}

if(!isMainThread&&workerData?.kind==='odor-behavior-seed'){
  const result=await runSeed(workerData);parentPort.postMessage({seed:result.seed,status:result.status,wallSeconds:result.wallSeconds});
}else if(isMainThread&&process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await main();
}
