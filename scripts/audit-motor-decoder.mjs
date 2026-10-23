import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Brain} from '../src/neural-core.mjs';
import {RECEPTORS} from '../src/neural-controller.mjs';
import {smoothMotorVector,validateFunctionalGraph} from '../src/functional-controller.mjs';

const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const hashBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=x=>hashBytes(JSON.stringify(x));

export function declareMotorAudit(options={}){
  if(Object.keys(options).some(key=>key!=='outputDirectory'))throw Error('Motor audit options are fixed before data collection');
  return {protocol:'q-blind-motor-grid-v1',diagnosticVersion:'0.0.1',seeds:[719,1901],stepsPerFrame:400,
    slicesPerFrame:5,stepsPerSlice:80,framesPerCondition:10,warmupSteps:1200,emaAlpha:.25,ridgeFraction:.1,
    directions:[{id:'side-positive',vector:[1,0,0]},{id:'side-negative',vector:[-1,0,0]},
      {id:'forward-positive',vector:[0,0,1]},{id:'forward-negative',vector:[0,0,-1]}],
    profiles:[{id:'baseline',arousal:.34,gain:.28,extra:[0,0,0,0,0]},
      {id:'settling',arousal:.015,gain:.006,extra:[0,0,0,0,0]},
      {id:'taste',arousal:.34,gain:.28,extra:[.42,0,0,0,0]},
      {id:'mixed-side-channels',arousal:.34,gain:.28,extra:[0,.3,.35,.25,.25]}],
    methods:['current-1Hz','current-10Hz','ema-1Hz','ema-10Hz','ridge-1Hz','ridge-ema-10Hz'],
    outputDirectory:options.outputDirectory??null,
    exclusions:'No odor, memory weights, reward, body, expected movement or target label enters the decoder; direction labels are used only for offline error measurement.',
    timeScale:'All methods reuse the same captured 400-step neural frames. Physical dt changes are offline only and do not establish closed-loop body performance.',
    lateWindow:'Frames 5..10, inclusive; six 400-step observations per seed/condition.'};
}

export function encodeAuditInputs(vector,profile){
  return [...RECEPTORS.map(dir=>clamp(profile.arousal+profile.gain*dir.reduce((sum,x,i)=>sum+x*vector[i],0),0,.8)),...profile.extra];
}

export function decodeFrameCounts(counts,calibration,inverse=calibration.inverse){
  if(!Array.isArray(counts)||counts.length!==calibration.baseline.length||!counts.every(x=>Number.isFinite(x)&&x>=0))throw Error('Invalid motor counts');
  const rates=counts.map(x=>x/400),live=rates.some(x=>x>1e-5);
  const raw=live?inverse.map(row=>.34+row.reduce((sum,w,i)=>sum+w*(rates[i]-calibration.baseline[i]),0)):[0,0,0,0];
  const populations=raw.map(x=>clamp(x,0,1.2));
  const local=[0,1,2].map(axis=>clamp(RECEPTORS.reduce((sum,dir,i)=>sum+dir[axis]*populations[i],0)*.75/.28,-1,1));
  return {live,rates,rawPopulations:raw,populations,local,drive:clamp(populations.reduce((a,b)=>a+b,0)/4/.34,0,1.4),
    clippedChannels:raw.filter(x=>x<0||x>1.2).length};
}

export function horizontalAngleDegrees(expected,actual){
  const norm=Math.hypot(expected[0],expected[2])*Math.hypot(actual[0],actual[2]);
  if(norm<1e-10)return null;
  return Math.acos(clamp((expected[0]*actual[0]+expected[2]*actual[2])/norm,-1,1))*180/Math.PI;
}

function invertFour(matrix){
  const a=matrix.map((row,i)=>[...row,...Array.from({length:4},(_,j)=>i===j?1:0)]);
  for(let i=0;i<4;i++){
    let pivot=i;for(let j=i+1;j<4;j++)if(Math.abs(a[j][i])>Math.abs(a[pivot][i]))pivot=j;
    if(Math.abs(a[pivot][i])<1e-20)throw Error('Response matrix has insufficient rank');
    [a[i],a[pivot]]=[a[pivot],a[i]];const scale=a[i][i];for(let k=0;k<8;k++)a[i][k]/=scale;
    for(let j=0;j<4;j++)if(j!==i){const factor=a[j][i];for(let k=0;k<8;k++)a[j][k]-=factor*a[i][k];}
  }
  return a.map(row=>row.slice(4));
}

export function regularizedInverse(response,fraction=.1){
  if(!Array.isArray(response)||!response.length||response.some(row=>!Array.isArray(row)||row.length!==4||!row.every(Number.isFinite)))throw Error('Invalid response matrix');
  const gram=Array.from({length:4},(_,i)=>Array.from({length:4},(_,j)=>response.reduce((sum,row)=>sum+row[i]*row[j],0)));
  const scale=gram.reduce((sum,row,i)=>sum+row[i],0)/4;
  if(!(scale>0)||!Number.isFinite(fraction)||fraction<=0)throw Error('Invalid response scale or regularization');
  for(let i=0;i<4;i++)gram[i][i]+=fraction*scale;
  const inverse=invertFour(gram);
  return inverse.map(row=>response.map(r=>row.reduce((sum,w,i)=>sum+w*r[i],0)));
}

function randomState(seed){const state={value:seed>>>0};return {state,random(){let x=state.value;x^=x<<13;x^=x>>>17;x^=x<<5;state.value=x>>>0;return state.value/4294967296;}};}
function snapshotBrain(brain,rng){return {rng:rng.state.value,step:brain.step,frames:brain.frames,
  v:new Float64Array(brain.v),g:new Float64Array(brain.g),ref:new Float64Array(brain.ref),
  count:new Float64Array(brain.count),queue:structuredClone(brain.queue)};}
function restoreBrain(graph,saved){const rng=randomState(saved.rng),brain=new Brain(graph,rng.random,{inputChannels:graph.channels});
  for(const key of ['v','g','ref','count'])brain[key].set(saved[key]);brain.queue=structuredClone(saved.queue);brain.step=saved.step;brain.frames=saved.frames;
  return {brain,rng};}
function collectFrame(brain,inputs,lookup,size){const counts=Array(size).fill(0);let spikeCount=0;
  for(let slice=0;slice<5;slice++){const result=brain.advance(inputs,80,{deferSummary:slice<4});spikeCount+=result.spikes.length;
    for(const index of result.spikes)if(lookup[index]>=0)counts[lookup[index]]++;}
  return {counts,spikeCount};}

function evaluateCounts(rawFrames,calibration,ridge,p,expected){
  const previous=Object.fromEntries(p.methods.map(id=>[id,{local:[0,0,0],referenceHeading:0}]));let ema=null;
  return rawFrames.map((raw,index)=>{
    ema=ema?raw.counts.map((value,i)=>ema[i]+p.emaAlpha*(value-ema[i])):[...raw.counts];
    const decoded={current:decodeFrameCounts(raw.counts,calibration),ema:decodeFrameCounts(ema,calibration),
      ridge:decodeFrameCounts(raw.counts,calibration,ridge),'ridge-ema':decodeFrameCounts(ema,calibration,ridge)};
    const candidates={};
    for(const method of p.methods){const key=method.startsWith('ridge-ema')?'ridge-ema':method.startsWith('ridge')?'ridge':method.startsWith('ema')?'ema':'current',
      dt=method.endsWith('10Hz')?.1:1,readout=decoded[key],local=smoothMotorVector(previous[method],readout.local,0,dt,readout.live);
      previous[method]={local,referenceHeading:0};candidates[method]={local,angleDegrees:horizontalAngleDegrees(expected,local),
        magnitude:Math.hypot(local[0],local[2]),clippedChannels:readout.clippedChannels};}
    return {frame:index+1,counts:raw.counts,spikeCount:raw.spikeCount,currentRawPopulations:decoded.current.rawPopulations,
      currentPopulations:decoded.current.populations,candidates};
  });
}

function summaryRows(cases,method,late=false){const values=cases.flatMap(condition=>condition.frames.filter(row=>!late||row.frame>=5).map(row=>row.candidates[method]));
  const angles=values.map(x=>x.angleDegrees).filter(x=>x!==null);
  return {frames:values.length,directionalFrames:angles.length,meanAngleDegrees:mean(angles),
    correctHemisphereFraction:angles.length?angles.filter(x=>x<90).length/angles.length:null,
    reverseFraction:angles.length?angles.filter(x=>x>90).length/angles.length:null,
    meanHorizontalMagnitude:mean(values.map(x=>x.magnitude)),
    clippedPopulationFraction:values.length?values.reduce((sum,x)=>sum+x.clippedChannels,0)/(4*values.length):null};}

const sourceFiles=['src/neural-core.mjs','src/neural-controller.mjs','src/functional-controller.mjs',
  'src/functional-calibration.json','src/functional-connectome.json'];
function sourceHashes(){return Object.fromEntries(sourceFiles.map(name=>[name,hashBytes(readFileSync(new URL('../'+name,import.meta.url)))]));}

export async function runMotorDecoderAudit(options={}){
  const p=declareMotorAudit(options),started=performance.now(),before=sourceHashes();
  const directory=p.outputDirectory?resolve(p.outputDirectory):null;
  if(directory){if(existsSync(directory))throw Error('Audit output already exists; preserve each run');mkdirSync(directory,{recursive:true});}
  const declaration={...p,declaredAt:new Date().toISOString(),sourceHashes:before,
    diagnosticSHA256:hashBytes(readFileSync(new URL(import.meta.url)))};
  if(directory)writeFileSync(resolve(directory,'predeclaration.json'),JSON.stringify(declaration,null,2)+'\n',{flag:'wx'});
  const graph=validateFunctionalGraph(JSON.parse(readFileSync(new URL('../src/functional-connectome.json',import.meta.url)))),
    calibration=JSON.parse(readFileSync(new URL('../src/functional-calibration.json',import.meta.url)));
  const lookup=new Int16Array(graph.neurons).fill(-1);graph.motorIndices.forEach((index,i)=>lookup[index]=i);
  const ridge=regularizedInverse(calibration.response,p.ridgeFraction),cases=[],warm={};
  for(const seed of p.seeds){const rng=randomState(seed),brain=new Brain(graph,rng.random,{inputChannels:graph.channels});
    brain.advance([.34,.34,.34,.34,0,0,0,0,0],p.warmupSteps);warm[seed]=snapshotBrain(brain,rng);}
  const record={declaration,cases,ridgeInverse:ridge,executionError:null,scientificLearningSuccess:null};
  try{
    for(const profile of p.profiles){
      for(const direction of p.directions)for(const seed of p.seeds){
        const {brain,rng}=restoreBrain(graph,warm[seed]),inputs=encodeAuditInputs(direction.vector,profile),raw=[];
        const initialHash=hash({rng:rng.state.value,v:Array.from(brain.v),g:Array.from(brain.g),ref:Array.from(brain.ref),queue:brain.queue,step:brain.step});
        for(let i=0;i<p.framesPerCondition;i++)raw.push(collectFrame(brain,inputs,lookup,graph.motorIndices.length));
        const frames=evaluateCounts(raw,calibration,ridge,p,direction.vector),lateCounts=Array(graph.motorIndices.length).fill(0);
        for(const row of raw.slice(4))row.counts.forEach((value,i)=>lateCounts[i]+=value/6);
        const pooled=decodeFrameCounts(lateCounts,calibration);
        cases.push({profile:profile.id,direction:direction.id,expected:direction.vector,seed,inputs,initialHash,frames,
          latePooledCurrent:{local:pooled.local,angleDegrees:horizontalAngleDegrees(direction.vector,pooled.local)}});
      }
      if(directory)writeFileSync(resolve(directory,'progress.json'),JSON.stringify({completedProfiles:cases.length/8,totalProfiles:p.profiles.length,conditions:cases.length})+'\n');
      console.log(JSON.stringify({audit:p.protocol,completedProfile:profile.id,conditions:cases.length,totalConditions:32}));
    }
  }catch(error){record.executionError=error instanceof Error?error.stack:String(error);}
  finally{
    record.sourceHashesAfter=sourceHashes();record.sourcesUnchanged=hash(before)===hash(record.sourceHashesAfter);record.wallSeconds=(performance.now()-started)/1000;
    record.pass=!record.executionError&&record.sourcesUnchanged&&cases.length===32;
    record.summary=Object.fromEntries(p.profiles.map(profile=>[profile.id,Object.fromEntries(p.methods.map(method=>[method,{
      all:summaryRows(cases.filter(x=>x.profile===profile.id),method),late:summaryRows(cases.filter(x=>x.profile===profile.id),method,true)}]))]));
    record.pooledLateByProfile=Object.fromEntries(p.profiles.map(profile=>[profile.id,{meanAngleDegrees:mean(cases.filter(x=>x.profile===profile.id).map(x=>x.latePooledCurrent.angleDegrees).filter(x=>x!==null))}]));
    if(directory){writeFileSync(resolve(directory,'trace.json'),JSON.stringify(record)+'\n',{flag:'wx'});
      writeFileSync(resolve(directory,'summary.json'),JSON.stringify({...record,cases:undefined,ridgeInverse:undefined},null,2)+'\n',{flag:'wx'});}
  }
  return record;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--out')throw Error('Use --out <fresh directory>; audit grid is fixed');
  const r=await runMotorDecoderAudit({outputDirectory:args[1]});
  console.log(JSON.stringify({pass:r.pass,wallSeconds:r.wallSeconds,executionError:r.executionError,
    profiles:Object.fromEntries(Object.entries(r.summary).map(([profile,methods])=>[profile,Object.fromEntries(Object.entries(methods)
      .map(([method,value])=>[method,{lateAngle:value.late.meanAngleDegrees,lateCorrectFraction:value.late.correctHemisphereFraction}]))])),pooled:r.pooledLateByProfile}));
  process.exitCode=r.pass?0:1;
}
