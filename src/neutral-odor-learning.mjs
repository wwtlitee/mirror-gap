import {MushroomCircuit,KC,DAN} from './mushroom-circuit.mjs';
import {validateSynapticMemory} from '../public/synaptic-memory-schema.mjs';
import {VERSION} from '../public/world-spec.mjs';

export const NEUTRAL_ODOR_ENCODING='neutral-AB-v1';
export const NEUTRAL_ODOR_IDS=Object.freeze(['A','B']);
export const NEUTRAL_ODOR_READOUT=Object.freeze({probeMs:500,seed:20261017,patternSeed:0x4e455554,
  patternFraction:.2,gain:3,rewardPulseMs:250,rewardCooldownMs:3000,refreshIntervalMs:1000});
const clip=(value,min=0,max=1)=>Math.max(min,Math.min(max,value));
let referenceRates;

/** Fixed synthetic PN activity; no food identity, anatomy-based selection or learned scores. */
export function makeNeutralOdorPatterns(pnIndices,n){
  let randomState=NEUTRAL_ODOR_READOUT.patternSeed;
  const random=()=>{let x=randomState;x^=x<<13;x^=x>>>17;x^=x<<5;randomState=x>>>0;return randomState/4294967296;};
  return Object.fromEntries(NEUTRAL_ODOR_IDS.map(odor=>{
    const indices=Array.from(pnIndices);
    for(let i=indices.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[indices[i],indices[j]]=[indices[j],indices[i]];}
    const pattern=new Float64Array(n);
    for(const i of indices.slice(0,Math.round(indices.length*NEUTRAL_ODOR_READOUT.patternFraction)))pattern[i]=1;
    return [odor,pattern];
  }));
}

function fixedReference(patterns){
  if(!referenceRates){
    const reference=new MushroomCircuit({seed:NEUTRAL_ODOR_READOUT.seed,frozen:true}),rates={};
    for(const odor of NEUTRAL_ODOR_IDS){
      reference.resetActivity();
      rates[odor]=reference.advance(NEUTRAL_ODOR_READOUT.probeMs,
        {odor:patterns[odor],reward:false,learn:false,seed:NEUTRAL_ODOR_READOUT.seed}).rateMBON;
    }
    referenceRates=Object.freeze(rates);
  }
  return referenceRates;
}

function actorPosition(state){
  const position=state?.actor?.position;
  if(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite))throw Error('中性气味需要有效的身体位置');
  return position;
}

function validateCues(cues){
  if(!Array.isArray(cues)||cues.length>32)throw Error('中性气味源必须是最多32项的数组');
  const ids=new Set(),allowed=new Set(['id','odor','position','strength','range','enabled']);
  return cues.map(cue=>{
    if(!cue||typeof cue!=='object'||Object.keys(cue).some(key=>!allowed.has(key))
      ||typeof cue.id!=='string'||!cue.id.startsWith('cue-')||!cue.id.trim()||cue.id.length>64||/[\p{Cc}\p{Cf}]/u.test(cue.id)||ids.has(cue.id)
      ||!NEUTRAL_ODOR_IDS.includes(cue.odor)||!Array.isArray(cue.position)||cue.position.length!==3||!cue.position.every(Number.isFinite))throw Error('独立中性气味源无效');
    const strength=cue.strength??1,range=cue.range??1,enabled=cue.enabled??true;
    if(!Number.isFinite(strength)||strength<0||strength>1||!Number.isFinite(range)||range<=0||range>100||typeof enabled!=='boolean')throw Error('中性气味浓度、范围或启用标记无效');
    ids.add(cue.id);
    return Object.freeze({id:cue.id,odor:cue.odor,position:Object.freeze([...cue.position]),strength,range,enabled});
  });
}

export class NeutralOdorLearning {
  constructor({seed=0x4d495252,saved=null,frozen=false,cues=[]}={}){
    if(typeof frozen!=='boolean')throw Error('中性气味冻结标记无效');
    this.circuit=new MushroomCircuit({seed});this.probe=new MushroomCircuit({seed:NEUTRAL_ODOR_READOUT.seed,frozen:true});
    this.patterns=makeNeutralOdorPatterns(this.circuit.pnIndices,this.circuit.n);
    this.kcIndices=Array.from(this.circuit.roles.keys()).filter(i=>this.circuit.roles[i]===KC);
    this.danIndices=Array.from(this.circuit.roles.keys()).filter(i=>this.circuit.roles[i]===DAN);
    this.frozen=frozen;this.rewardEnabled=true;this.setCues(cues);this.clearTransientLearning();
    if(saved)this.restoreWeights(saved);
  }

  clearTransientLearning(){
    this.clockMs=0;this.rewardUntilMs=0;this.nextRewardAtMs=0;this.rewardPulses=0;this.consumedAmount=0;
    this.rewardedMilliseconds=0;this.rewardDanSpikes=0;this.nonRewardDanSpikes=0;
    this.maxRewardGate=0;this.maxNonRewardGate=0;this.readouts={};this.readoutWeights=null;
    this.lastReadoutMs=-Infinity;this.computeMs=0;this.readoutComputeMs=0;
  }

  setCues(cues){const checked=validateCues(cues);this.cues=Object.freeze(checked);}

  pattern(odor){if(!NEUTRAL_ODOR_IDS.includes(odor))throw Error('未知的独立中性气味');return this.patterns[odor];}

  cueSamples(state){
    const position=actorPosition(state);
    return this.cues.filter(cue=>cue.enabled&&cue.strength>0).map(cue=>{
      const distance=Math.hypot(...cue.position.map((value,i)=>value-position[i]));
      return {id:cue.id,odor:cue.odor,position:[...cue.position],distance,intensity:cue.strength*Math.exp(-distance/cue.range),kind:'neutral-odor'};
    });
  }

  odorAt(state){
    const sources=this.cueSamples(state),odor=new Float64Array(this.circuit.n);
    const total=sources.reduce((sum,source)=>sum+source.intensity**4,0);
    const strength=clip(2*Math.max(0,...sources.map(source=>source.intensity)));
    if(total>0)for(const source of sources){
      const pattern=this.pattern(source.odor),amount=source.intensity**4/total*strength;
      for(const index of this.circuit.pnIndices)odor[index]+=pattern[index]*amount;
    }
    for(const index of this.circuit.pnIndices)odor[index]=clip(odor[index]);
    return odor;
  }

  /** Call only with consumeFood's actual positive amount, never with an intended action. */
  consume(foodId,amount){
    if(typeof foodId!=='string'||!foodId.trim()||!Number.isFinite(amount)||amount<=0)return false;
    this.consumedAmount+=amount;
    if(!this.rewardEnabled||this.clockMs+1e-7<this.nextRewardAtMs)return false;
    this.rewardUntilMs=this.clockMs+NEUTRAL_ODOR_READOUT.rewardPulseMs;
    this.nextRewardAtMs=this.clockMs+NEUTRAL_ODOR_READOUT.rewardCooldownMs;this.rewardPulses++;
    return true;
  }

  advance(state,seconds){
    const milliseconds=seconds*1000;
    if(!Number.isFinite(seconds)||seconds<=0||seconds>.1||Math.abs(Math.round(milliseconds/.5)*.5-milliseconds)>1e-9
      ||typeof this.frozen!=='boolean'||typeof this.rewardEnabled!=='boolean')throw Error('中性气味推进时间或运行标记无效');
    const odor=this.odorAt(state),start=performance.now(),counts=new Uint32Array(this.circuit.n);
    let remaining=milliseconds,gateSum=0,maxGate=0,rateSum=0,rewardMs=0;
    while(remaining>1e-9){
      const reward=this.rewardEnabled&&this.clockMs<this.rewardUntilMs-1e-7;
      const amount=reward?Math.min(remaining,this.rewardUntilMs-this.clockMs):remaining;
      const result=this.circuit.advance(amount,{odor,reward,learn:!this.frozen});
      for(let i=0;i<counts.length;i++)counts[i]+=result.counts[i];
      const danSpikes=this.danIndices.reduce((sum,i)=>sum+result.counts[i],0);
      if(reward){this.rewardDanSpikes+=danSpikes;this.rewardedMilliseconds+=amount;rewardMs+=amount;this.maxRewardGate=Math.max(this.maxRewardGate,result.maxGate);}
      else{this.nonRewardDanSpikes+=danSpikes;this.maxNonRewardGate=Math.max(this.maxNonRewardGate,result.maxGate);}
      gateSum+=result.gate*amount;rateSum+=result.rateMBON*amount;maxGate=Math.max(maxGate,result.maxGate);
      remaining-=amount;this.clockMs+=amount;
    }
    this.computeMs=performance.now()-start;
    return {counts,rateMBON:rateSum/milliseconds,gate:gateSum/milliseconds,maxGate,rewardMs};
  }

  refreshReadouts({force=false}={}){
    const weights=this.serializeWeights(),changed=!this.readoutWeights||weights.efficacy.some((q,i)=>q!==this.readoutWeights[i]);
    if(!force&&(!changed||this.clockMs-this.lastReadoutMs<NEUTRAL_ODOR_READOUT.refreshIntervalMs))return this.readouts;
    const start=performance.now(),reference=fixedReference(this.patterns),readouts={};
    const untrained=weights.efficacy.every(q=>q===1);
    for(const odor of NEUTRAL_ODOR_IDS){
      let rateMBON=reference[odor];
      if(!untrained){
        this.probe.restoreWeights(weights);
        rateMBON=this.probe.advance(NEUTRAL_ODOR_READOUT.probeMs,
          {odor:this.pattern(odor),reward:false,learn:false,seed:NEUTRAL_ODOR_READOUT.seed}).rateMBON;
      }
      const deltaHz=reference[odor]-rateMBON;
      // Transparent engineering projection: only changed neural response above
      // the fixed q=1 reference adds learned valence to the original senses.
      readouts[odor]={rateMBON,baselineMBONHz:reference[odor],deltaHz,valence:clip(deltaHz/Math.max(1,reference[odor]),-1,1)};
    }
    this.readouts=readouts;this.readoutWeights=[...weights.efficacy];this.lastReadoutMs=this.clockMs;
    this.readoutComputeMs=performance.now()-start;return this.readouts;
  }

  sense(state){
    const readouts=this.refreshReadouts();
    return this.cueSamples(state).map(source=>({...source,neuralValence:readouts[source.odor]?.valence??0,
      neuralOdor:readouts[source.odor]??null,label:'中性气味 '+source.odor}));
  }

  serializeWeights(){return this.circuit.serializeWeights();}

  restoreWeights(saved){
    validateSynapticMemory(saved);
    const copied={format:saved.format,modelVersion:saved.modelVersion,graphHash:saved.graphHash,efficacy:[...saved.efficacy]};
    validateSynapticMemory(copied);
    this.circuit.restoreWeights(copied);this.probe.restoreWeights(copied);this.clearTransientLearning();
  }

  snapshot(){
    const weights=this.serializeWeights().efficacy,danValues=this.danIndices.map(i=>this.circuit.dopamine[i]);
    const dopamineMean=danValues.reduce((sum,value)=>sum+value,0)/danValues.length;
    return {productVersion:VERSION,modelVersion:this.circuit.modelVersion,encoding:NEUTRAL_ODOR_ENCODING,
      neurons:this.circuit.n,plasticConnections:weights.length,changedSynapses:weights.filter(q=>q<1-1e-10).length,
      meanEfficacy:weights.reduce((sum,q)=>sum+q,0)/weights.length,clockMs:this.clockMs,frozen:this.frozen,rewardEnabled:this.rewardEnabled,
      consumedAmount:this.consumedAmount,rewardPulses:this.rewardPulses,rewardedMilliseconds:this.rewardedMilliseconds,
      rewardDanSpikes:this.rewardDanSpikes,nonRewardDanSpikes:this.nonRewardDanSpikes,
      eligibilityMax:Math.max(0,...this.kcIndices.map(i=>this.circuit.eligibility[i])),
      dopamineMean,dopamineMax:Math.max(0,...danValues),instantGate:clip(dopamineMean),
      maxRewardGate:this.maxRewardGate,maxNonRewardGate:this.maxNonRewardGate,
      cues:this.cues.map(cue=>({...cue,position:[...cue.position]})),readouts:structuredClone(this.refreshReadouts()),
      computeMs:this.computeMs,readoutComputeMs:this.readoutComputeMs,
      interface:'fixed-delta-from-untrained-MBON-reference-to-original-senses',reward:'actual-food-consumption-only',
      nonRewardDanMeaning:'Spikes during phases without external PAM drive, including residual reward activity; not automatically spontaneous learning.'};
  }
}
