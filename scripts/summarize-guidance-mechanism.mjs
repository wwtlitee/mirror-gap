import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {summarizeGuidanceValidation,loadGuidanceProtocol} from './validate-learned-guidance.mjs';

const D=1/Math.sqrt(3),receptors=[[D,D,D],[-D,-D,D],[-D,D,-D],[D,-D,-D]];
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
const cosine=(a,b)=>{const length=Math.hypot(...a)*Math.hypot(...b);return length>1e-10?dot(a,b)/length:null;};
const mean=values=>values.length?values.reduce((sum,x)=>sum+x,0)/values.length:null;
const metric=values=>({samples:values.length,meanCosine:mean(values),positiveFraction:values.length?values.filter(x=>x>0).length/values.length:null});
const horizontal=vector=>[vector[0],0,vector[2]];
const addCosine=(values,a,b)=>{const value=cosine(a,b);if(value!==null)values.push(value);};

export function decodeGuidanceInput(inputs){
  if(!Array.isArray(inputs)||inputs.length<4||!inputs.slice(0,4).every(Number.isFinite))throw Error('Four finite receptor inputs required');
  return [0,1,2].map(axis=>.75/.28*receptors.reduce((sum,r,i)=>sum+r[axis]*inputs[i],0));
}

export function guidanceWorldVector(local,heading){
  if(!Number.isFinite(heading)||!Array.isArray(local)||local.length!==3||!local.every(Number.isFinite))throw Error('Finite sampled heading and vector required');
  return [local[0]*Math.cos(heading)+local[2]*Math.sin(heading),local[1],-local[0]*Math.sin(heading)+local[2]*Math.cos(heading)];
}

export function summarizeGuidanceFrames(rows,{source,startExclusive=-1}={}){
  if(!Array.isArray(source)||source.length!==3||!source.every(Number.isFinite))throw Error('Fixed cue source required');
  const inputTarget=[],motorTarget=[],inputMotor=[],inputTargetHorizontal=[],motorTargetHorizontal=[],inputMotorHorizontal=[],velocityTargetHorizontal=[];
  let previous=null,freshFrames=0,clippedReceptorFrames=0,missingSampledHeading=0;
  for(const row of rows){
    const encoded=JSON.stringify(row.motor),fresh=previous!==null&&encoded!==previous;previous=encoded;
    if(!fresh||row.t<=startExclusive)continue;
    freshFrames++;
    const heading=row.motor?.referenceHeading;
    if(!Number.isFinite(heading)){missingSampledHeading++;continue;}
    const motor=guidanceWorldVector(row.motor.local,heading),target=source.map((x,i)=>x-row.position[i]),mc=cosine(motor,target);
    if(mc!==null)motorTarget.push(mc);
    addCosine(motorTargetHorizontal,horizontal(motor),horizontal(target));
    if(row.velocity)addCosine(velocityTargetHorizontal,horizontal(row.velocity),horizontal(target));
    const clipped=row.sensoryInputs.slice(0,4).some(x=>x<=0||x>=.8);
    if(clipped){clippedReceptorFrames++;continue;}
    const input=guidanceWorldVector(decodeGuidanceInput(row.sensoryInputs),heading),ic=cosine(input,target),im=cosine(input,motor);
    if(ic!==null)inputTarget.push(ic);if(im!==null)inputMotor.push(im);
    addCosine(inputTargetHorizontal,horizontal(input),horizontal(target));
    addCosine(inputMotorHorizontal,horizontal(input),horizontal(motor));
  }
  return {worldFrame:'completed-neural-frame motor.referenceHeading',freshFrames,clippedReceptorFrames,missingSampledHeading,
    inputTarget:metric(inputTarget),motorTarget:metric(motorTarget),inputMotor:metric(inputMotor),
    inputTargetHorizontal:metric(inputTargetHorizontal),motorTargetHorizontal:metric(motorTargetHorizontal),
    inputMotorHorizontal:metric(inputMotorHorizontal),velocityTargetHorizontal:metric(velocityTargetHorizontal)};
}

const readJSON=path=>JSON.parse(readFileSync(path,'utf8'));
const readRows=path=>readFileSync(path,'utf8').trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
export function guidanceMechanismPrimaryValidity(result){
  const primary=summarizeGuidanceValidation([result],loadGuidanceProtocol());
  return Object.fromEntries(['native','swapped'].map(mapping=>[mapping,primary.mappings[mapping].observations.find(row=>row.seed===result.seed)]));
}
const correlation=pairs=>{
  if(pairs.length<2)return null;
  const ax=mean(pairs.map(p=>p[0])),ay=mean(pairs.map(p=>p[1]));
  const covariance=pairs.reduce((sum,p)=>sum+(p[0]-ax)*(p[1]-ay),0),variance=Math.sqrt(
    pairs.reduce((sum,p)=>sum+(p[0]-ax)**2,0)*pairs.reduce((sum,p)=>sum+(p[1]-ay)**2,0));
  return variance>1e-12?covariance/variance:null;
};

export function summarizeGuidanceMechanism(directory){
  const animals=[];
  for(let seed=9300;seed<=9315;seed++){
    const path=resolve(directory,'seed-'+seed),receipt=resolve(path,'result.json');if(!existsSync(receipt))continue;
    const r=readJSON(receipt),primary=guidanceMechanismPrimaryValidity(r),readouts=r.training.paired?.readouts??{},trained=readouts[r.target],other=readouts[r.target==='A'?'B':'A'];
    const checkpoint=resolve(path,'paired-checkpoint.json'),learning=existsSync(checkpoint)?readJSON(checkpoint).learning:null;
    const animal={seed,target:r.target,failures:r.failures,status:r.status,wallSeconds:r.wallSeconds,
      teaching:r.training.paired?.actualTeachingEvents,trainingSeconds:r.training.paired?.elapsed,
      rewardGateDeliveredMs:learning?.rewardedMilliseconds??null,
      rewardGateRemainingMs:learning?Math.max(0,learning.rewardUntilMs-learning.clockMs):null,
      rewardDanSpikes:learning?.rewardDanSpikes??null,
      mbonA:readouts.A,mbonB:readouts.B,targetValenceContrast:trained&&other?trained.valence-other.valence:null,
      targetActualMBONRateDifferenceHz:trained&&other?trained.rateMBON-other.rateMBON:null,
      note:'A/B baseline firing rates differ; normalized learned valence contrast is distinct from raw MBON rate difference.',mappings:{}};
    for(const mapping of ['native','swapped']){
      const item=r.mappings[mapping];if(!item)continue;
      const branch={valid:primary[mapping].valid,failures:primary[mapping].failures,qualifying:primary[mapping].qualifying,
        primaryContribution:primary[mapping].primaryContribution,probeOnlyValid:item.valid,learned:item.learned?.tailPreferenceTarget??null,
        erased:item.erased?.tailPreferenceTarget??null,restoreExact:item.restoreExact,conditions:{}};
      branch.delta=Number.isFinite(branch.learned)&&Number.isFinite(branch.erased)?branch.learned-branch.erased:null;
      for(const condition of ['learned','erased','frozen']){
        const raw=resolve(path,mapping+'-'+condition+'.jsonl');if(!existsSync(raw))continue;
        const rows=readRows(raw);if(!rows.length)continue;
        const center=rows[0].position,left=(mapping==='native'&&r.target==='A')||(mapping==='swapped'&&r.target==='B'),source=[center[0]+(left?-.65:.65),center[1],center[2]];
        const target=source.map((x,i)=>x-center[i]),sampledHeading=rows[0].motor.referenceHeading;
        branch.conditions[condition]={startingHeading:rows[0].heading,startingMotorReferenceHeading:rows[0].motor.referenceHeading,
          startingForwardTargetCosine:cosine(guidanceWorldVector([0,0,1],rows[0].heading),target),
          startingMotorTargetHorizontalCosine:Number.isFinite(sampledHeading)?cosine(horizontal(guidanceWorldVector(rows[0].motor.local,sampledHeading)),horizontal(target)):null,
          startingVelocityTargetHorizontalCosine:rows[0].velocity?cosine(horizontal(rows[0].velocity),horizontal(target)):null,
          all:summarizeGuidanceFrames(rows,{source}),tail:summarizeGuidanceFrames(rows,{source,startExclusive:4})};
      }
      animal.mappings[mapping]=branch;
    }
    animals.push(animal);
  }
  const groups={};
  for(const target of ['all','A','B'])for(const mapping of ['native','swapped']){
    const selected=animals.filter(a=>(target==='all'||a.target===target)&&a.mappings[mapping]);
    const valid=selected.filter(a=>a.mappings[mapping].valid),key=target+'-'+mapping;
    groups[key]={completed:selected.length,valid:valid.length,meanDelta:mean(valid.map(a=>a.mappings[mapping].delta)),
      qualifying:valid.filter(a=>a.mappings[mapping].learned>0&&a.mappings[mapping].delta>0).length,
      valenceContrastVsDeltaCorrelation:correlation(valid.filter(a=>Number.isFinite(a.targetValenceContrast)).map(a=>[a.targetValenceContrast,a.mappings[mapping].delta])),
      startingHeadingVsDeltaCorrelation:correlation(valid.filter(a=>Number.isFinite(a.mappings[mapping].conditions.learned?.startingForwardTargetCosine))
        .map(a=>[a.mappings[mapping].conditions.learned.startingForwardTargetCosine,a.mappings[mapping].delta])),
      startingVelocityVsLearnedPreferenceCorrelation:correlation(valid.filter(a=>Number.isFinite(a.mappings[mapping].conditions.learned?.startingVelocityTargetHorizontalCosine))
        .map(a=>[a.mappings[mapping].conditions.learned.startingVelocityTargetHorizontalCosine,a.mappings[mapping].learned])),
      tailDirection:Object.fromEntries(['learned','erased','frozen'].map(condition=>[condition,Object.fromEntries(['inputTarget','motorTarget','inputMotor',
        'inputTargetHorizontal','motorTargetHorizontal','inputMotorHorizontal','velocityTargetHorizontal']
        .map(metricName=>[metricName,mean(valid.map(a=>a.mappings[mapping].conditions[condition]?.tail[metricName].meanCosine).filter(Number.isFinite))]))]))};
  }
  return {format:1,kind:'read-only-observational-mechanism-summary',generatedAt:new Date().toISOString(),completed:animals.length,
    limitations:['No new animals or neural execution. No source/core changes. These correlations do not establish a decoder or heading cause.',
      'Directions use only changed completed motor readouts and their sampled reference heading; exactly unchanged readouts may be omitted.',
      'Total receptor projection includes safety, physiology and background cues. It is not an isolated odor force.',
      '3D motor vectors do not subtract gravity or baseline lift; separate horizontal statistics are provided to avoid that confound.',
      'All-frame statistics can include an old pending frame from training; tail4s statistics exclude that initial transient.',
      'Primary decisions remain in the immutable predeclared validation summary, with all16 assigned animals.'],groups,animals};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const [directory,output]=process.argv.slice(2);if(!directory||!output)throw Error('Provide cohort directory and fresh output JSON path');
  const report=summarizeGuidanceMechanism(resolve(directory));writeFileSync(output,JSON.stringify(report,null,2)+'\n',{encoding:'utf8',flag:'wx'});
  console.log(JSON.stringify({completed:report.completed,groups:report.groups,output:resolve(output)}));
}
