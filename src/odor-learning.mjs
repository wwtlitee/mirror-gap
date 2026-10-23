import {MushroomCircuit} from './mushroom-circuit.mjs';
import {RESOURCE_DEFINITIONS} from '../public/resource-spec.mjs';
import {foodStock} from '../public/food-stock.mjs';

export const ODOR_MODEL_VERSION='0.0.1a';
export const FOOD_ODORS=RESOURCE_DEFINITIONS.filter(source=>source.kind==='food');
export const ODOR_READOUT=Object.freeze({probeMs:500,seed:20261017,neutralMBONHz:40,gain:3,rewardPulseMs:250,rewardCooldownMs:3000});
const clip=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));

// Fixed synthetic chemical coding, chosen without reference to connectivity,
// training results or food quality. Names select stimuli, never learned scores.
export function makeOdorPatterns(pnIndices,n,seed=0x4f444f52){
  let randomState=seed>>>0||1;
  const random=()=>{let x=randomState;x^=x<<13;x^=x>>>17;x^=x<<5;randomState=x>>>0;return randomState/4294967296;};
  return Object.fromEntries(FOOD_ODORS.map(source=>{
    const indices=Array.from(pnIndices);
    for(let i=indices.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[indices[i],indices[j]]=[indices[j],indices[i]];}
    const pattern=new Float64Array(n);
    for(const index of indices.slice(0,Math.round(indices.length*.2)))pattern[index]=1;
    return [source.id,pattern];
  }));
}

export class OdorLearning {
  constructor({seed=0x4d495252,saved=null,frozen=false,assignments={}}={}){
    this.circuit=new MushroomCircuit({seed});
    this.probe=new MushroomCircuit({seed:ODOR_READOUT.seed});
    this.patterns=makeOdorPatterns(this.circuit.pnIndices,this.circuit.n);
    this.assignments={...assignments};
    this.frozen=frozen;this.rewardEnabled=true;this.clockMs=0;this.rewardUntilMs=0;this.nextRewardAtMs=0;
    this.rewardPulses=0;this.consumedAmount=0;this.readouts={};
    this.lastReadoutMs=-Infinity;this.readoutWeights=null;this.computeMs=0;
    if(saved)this.restoreWeights(saved);
  }

  pattern(id){
    const result=this.patterns[this.assignments[id]??id];
    if(!result)throw Error('Unknown fixed odor stimulus');
    return result;
  }

  consume(id,amount){
    if(!FOOD_ODORS.some(source=>source.id===id)||!Number.isFinite(amount)||amount<=0)return false;
    this.consumedAmount+=amount;
    if(!this.rewardEnabled)return false;
    if(this.clockMs+1e-7<this.nextRewardAtMs)return false;
    this.rewardUntilMs=this.clockMs+ODOR_READOUT.rewardPulseMs;
    this.nextRewardAtMs=this.clockMs+ODOR_READOUT.rewardCooldownMs;
    this.rewardPulses++;
    return true;
  }

  odorAt(state){
    const stock=foodStock(state),p=state.actor.position;
    const sources=FOOD_ODORS.filter(source=>(stock?.[source.id]??state.home.food)>0);
    const levels=sources.map(source=>Math.exp(-Math.hypot(...source.position.map((value,i)=>value-p[i]))/.5));
    // Fixed competition approximates peripheral mixture normalization. It is
    // independent of reward, food ID and q; nearby odors dominate the mixture.
    const total=levels.reduce((sum,value)=>sum+value**4,0);
    const odor=new Float64Array(this.circuit.n),strength=clip(Math.max(0,...levels)*2);
    if(total>0)for(let k=0;k<sources.length;k++){
      const pattern=this.pattern(sources[k].id),amount=levels[k]**4/total*strength;
      for(const index of this.circuit.pnIndices)odor[index]+=pattern[index]*amount;
    }
    for(const index of this.circuit.pnIndices)odor[index]=clip(odor[index]);
    return odor;
  }

  advance(state,seconds){
    if(!Number.isFinite(seconds)||seconds<=0||seconds>.1)throw Error('Invalid learning time slice');
    const start=performance.now(),milliseconds=seconds*1000;
    const reward=this.clockMs<this.rewardUntilMs-1e-7;
    // Split at the exact pulse end: physics frames cannot lengthen a reward.
    const first=reward?Math.min(milliseconds,this.rewardUntilMs-this.clockMs):milliseconds;
    const odor=this.odorAt(state);
    this.circuit.advance(first,{odor,reward,learn:!this.frozen});
    if(first<milliseconds)this.circuit.advance(milliseconds-first,{odor,reward:false,learn:!this.frozen});
    this.clockMs+=milliseconds;this.computeMs=performance.now()-start;
  }

  refreshReadouts({force=false}={}){
    const weights=this.serializeWeights();
    const changed=!this.readoutWeights||weights.efficacy.some((q,i)=>Math.abs(q-this.readoutWeights[i])>1e-5);
    if(!force&&(!changed||this.clockMs-this.lastReadoutMs<1000))return this.readouts;
    const start=performance.now(),readouts={};
    for(const source of FOOD_ODORS){
      this.probe.restoreWeights(weights);
      const result=this.probe.advance(ODOR_READOUT.probeMs,{odor:this.pattern(source.id),reward:false,learn:false,seed:ODOR_READOUT.seed});
      const rateMBON=result.rateMBON;
      if(!Number.isFinite(rateMBON))throw Error('Invalid neural odor readout');
      readouts[source.id]={rateMBON,valence:clip((ODOR_READOUT.neutralMBONHz-rateMBON)/ODOR_READOUT.neutralMBONHz,-1,1)};
    }
    this.readouts=readouts;this.readoutWeights=[...weights.efficacy];this.lastReadoutMs=this.clockMs;
    this.readoutComputeMs=performance.now()-start;
    return readouts;
  }

  serializeWeights(){return this.circuit.serializeWeights();}
  restoreWeights(saved){
    this.circuit.restoreWeights(saved);this.probe.restoreWeights(saved);
    this.readoutWeights=null;this.readouts={};
    this.rewardUntilMs=0;this.nextRewardAtMs=this.clockMs;
  }

  snapshot(){
    const weights=this.serializeWeights().efficacy;
    return {modelVersion:ODOR_MODEL_VERSION,neurons:this.circuit.n,plasticConnections:weights.length,
      changedSynapses:weights.filter(q=>q<1-1e-10).length,meanEfficacy:weights.reduce((a,b)=>a+b,0)/weights.length,
      consumedAmount:this.consumedAmount,rewardPulses:this.rewardPulses,frozen:this.frozen,clockMs:this.clockMs,
      readouts:structuredClone(this.readouts),computeMs:this.computeMs,readoutComputeMs:this.readoutComputeMs??0,
      interface:'fixed-MBON-to-original-sensory-projection',reward:'actual-food-consumption-only'};
  }
}
