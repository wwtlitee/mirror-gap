import {readFileSync,sha256} from './platform-io.mjs';
import {validateSynapticMemory,SYNAPTIC_MODEL_VERSION,SYNAPTIC_GRAPH_HASH,SYNAPTIC_WEIGHT_COUNT} from '../public/synaptic-memory-schema.mjs';

// A separate connectome-derived association circuit. The original motor brain
// remains the only source of decoded body thrust; this module has no body API.
export const PN=0,KC=1,MBON=2,DAN=3,APL=4;
export const MUSHROOM_MODEL_VERSION=SYNAPTIC_MODEL_VERSION;
export const MUSHROOM_GRAPH_HASH=SYNAPTIC_GRAPH_HASH;
export const MUSHROOM_DERIVED_FILE_HASH='ed90a151008f93b6945b5ce53ec9bba856d4150f9cd4c538805c3c79acb93890';
const PAYLOAD_HASH='0ed4ad597b78bb641b820e2a09ac8fb3ee6f58ae4f74c9fb05e7e356e9baf07f';
const DT=.5,EM=Math.exp(-DT/20),EG=Math.exp(-DT/5),TRACE_DECAY=Math.exp(-DT/100);
const COUPLING=5/(20-5)*(EM-EG),REFRACTORY_STEPS=Math.ceil(2.2/DT),DELAY_SLOTS=Math.ceil(1.8/DT)+1;
const cachedGraphs=new WeakMap();
let defaultGraph,defaultPayload;

const safeInteger=value=>Number.isSafeInteger(value)&&value>=0;
function requireSeed(value){if(!safeInteger(value))throw Error('突触回路随机种子无效');return value;}

// Exact low 64-bit products expressed as two unsigned 32-bit words. All
// intermediate 16-bit products fit exactly in a JavaScript Number; no BigInt,
// truncation to a 32-bit PRNG, or floating-point 64-bit identity conversion.
function productHigh(a,b){
  const low=a&65535,high=a>>>16,otherLow=b&65535,otherHigh=b>>>16;
  const t=high*otherLow+((low*otherLow)>>>16);
  const middle=(t&65535)+low*otherHigh;
  return (high*otherHigh+(t>>>16)+(middle>>>16))>>>0;
}
function mixedUniform(seedLow,seedHigh,stepLow,stepHigh,cellLow,cellHigh){
  let low=(seedLow^stepLow^cellLow)>>>0,high=(seedHigh^stepHigh^cellHigh)>>>0;
  let a=(low^(low>>>30)^(high<<2))>>>0,b=(high^(high>>>30))>>>0;
  high=(productHigh(a,0x1CE4E5B9)+Math.imul(b,0x1CE4E5B9)+Math.imul(a,0xBF58476D))>>>0;
  low=Math.imul(a,0x1CE4E5B9)>>>0;
  a=(low^(low>>>27)^(high<<5))>>>0;b=(high^(high>>>27))>>>0;
  high=(productHigh(a,0x133111EB)+Math.imul(b,0x133111EB)+Math.imul(a,0x94D049BB))>>>0;
  low=Math.imul(a,0x133111EB)>>>0;
  a=(low^(low>>>31)^(high<<1))>>>0;b=(high^(high>>>31))>>>0;
  return (b*2097152+(a>>>11))/9007199254740992;
}

/** Counter stream identical to learning-lab/model.py _uniform, including steps beyond uint32. */
export function counterUniform(seed,step,neuron){
  requireSeed(seed);
  if(!safeInteger(step)||step>=Number.MAX_SAFE_INTEGER||!Number.isInteger(neuron)||neuron<0||neuron>=0xffffffff)throw Error('突触回路随机计数器无效');
  const tick=step+1,tickLow=tick>>>0,tickHigh=Math.floor(tick/4294967296),cell=neuron+1;
  const stepLow=Math.imul(tickLow,0x7F4A7C15)>>>0;
  const stepHigh=(productHigh(tickLow,0x7F4A7C15)+Math.imul(tickHigh,0x7F4A7C15)+Math.imul(tickLow,0x9E3779B9))>>>0;
  const cellLow=Math.imul(cell,0xB1CE6E93)>>>0;
  const cellHigh=(productHigh(cell,0xB1CE6E93)+Math.imul(cell,0xD2B74407))>>>0;
  return mixedUniform(seed>>>0,Math.floor(seed/4294967296),stepLow,stepHigh,cellLow,cellHigh);
}

function loadDefaultGraph(){
  if(!defaultGraph){
    const raw=readFileSync(new URL('./mushroom-connectome.json',import.meta.url),'utf8');
    if(sha256(raw)!==MUSHROOM_DERIVED_FILE_HASH)throw Error('突触回路派生连接组校验失败');
    defaultGraph=JSON.parse(raw);defaultPayload=JSON.stringify(defaultGraph.payload);
  }
  return defaultGraph;
}

function compileGraph(graph){
  const original=loadDefaultGraph();
  if(cachedGraphs.has(graph))return cachedGraphs.get(graph);
  if(!graph||graph.format!==1||graph.modelVersion!==SYNAPTIC_MODEL_VERSION
    ||graph.sourceGraphHash!==SYNAPTIC_GRAPH_HASH||graph.payloadHash!==PAYLOAD_HASH
    ||JSON.stringify(graph.payload)!==defaultPayload)throw Error('突触回路数据与已审计图不一致');
  // Value-identical caller data shares the same immutable compiled structure.
  if(graph!==original&&cachedGraphs.has(original)){
    const compiled=cachedGraphs.get(original);cachedGraphs.set(graph,compiled);return compiled;
  }
  const {payload:p}=graph,n=p.neurons,edgeCount=p.pairPre.length;
  if(n!==1259||edgeCount!==73304||p.roots.length!==n||p.role.length!==n
    ||!p.roots.every(root=>typeof root==='string'&&/^\d{18}$/.test(root))
    ||new Set(p.roots).size!==n)throw Error('突触回路神经元身份无效');
  const roles=Int8Array.from(p.role),offsets=new Uint32Array(n+1);
  for(const pre of p.pairPre)offsets[pre+1]++;
  for(let i=1;i<=n;i++)offsets[i]+=offsets[i-1];
  const cursor=offsets.slice(),pre=new Uint32Array(edgeCount),targets=new Uint32Array(edgeCount);
  const weights=new Float64Array(edgeCount),plasticFraction=new Float64Array(edgeCount);
  const plastic=[],pn=[],mbon=[],cellLow=new Uint32Array(n),cellHigh=new Uint32Array(n);
  let danCount=0;
  for(let i=0;i<n;i++){
    if(roles[i]===PN)pn.push(i);if(roles[i]===MBON)mbon.push(i);if(roles[i]===DAN)danCount++;
    const cell=i+1;cellLow[i]=Math.imul(cell,0xB1CE6E93)>>>0;
    cellHigh[i]=(productHigh(cell,0xB1CE6E93)+Math.imul(cell,0xD2B74407))>>>0;
  }
  for(let i=0;i<edgeCount;i++){
    const source=p.pairPre[i],target=p.pairPost[i],at=cursor[source]++;
    pre[at]=source;targets[at]=target;
    const syn=p.pairSynCount[i],fraction=p.plasticNeuropilSynCount[i]/syn;
    plasticFraction[at]=fraction;
    let weight=syn*.275;
    if(roles[source]===APL||roles[source]===MBON)weight*=-1;
    // Literature-guided feedback sign assumption, fixed at the validated +1.
    if(roles[source]===MBON&&roles[target]===DAN)weight=syn*.275;
    if(roles[source]===DAN)weight=0;
    if(roles[source]===KC&&roles[target]===MBON&&fraction>0)weight*=20;
    weights[at]=weight;
  }
  for(let e=0;e<edgeCount;e++)if(plasticFraction[e]>0){
    if(roles[pre[e]]!==KC||roles[targets[e]]!==MBON)throw Error('突触可塑区域无效');
    plastic.push(e);
  }
  if(plastic.length!==SYNAPTIC_WEIGHT_COUNT||pn.length!==147||mbon.length!==1||danCount!==41)throw Error('突触回路细胞数量无效');
  const compiled={n,roles,offsets,pre,targets,weights,plasticFraction,plasticEdges:Uint32Array.from(plastic),pnIndices:Uint32Array.from(pn),mbonIndices:Uint32Array.from(mbon),danCount,cellLow,cellHigh};
  cachedGraphs.set(graph,compiled);cachedGraphs.set(original,compiled);return compiled;
}

export class MushroomCircuit {
  constructor({graph,seed=0x4d495252,frozen=false}={}){
    this.seed=requireSeed(seed);
    if(typeof frozen!=='boolean')throw Error('突触冻结标记无效');
    this.frozen=frozen;
    // Adjacency, anatomical weights and role metadata are shared read-only.
    // Efficacy and all neural state remain private to each living circuit.
    Object.assign(this,compileGraph(graph??loadDefaultGraph()));
    this.graphHash=SYNAPTIC_GRAPH_HASH;this.modelVersion=SYNAPTIC_MODEL_VERSION;
    this.q=new Float64Array(this.weights.length).fill(1);
    this.resetActivity();
  }

  resetActivity(){
    this.v=new Float64Array(this.n).fill(-52);this.g=new Float64Array(this.n);
    this.refractory=new Float64Array(this.n);this.eligibility=new Float64Array(this.n);this.dopamine=new Float64Array(this.n);
    this.queue=Array.from({length:DELAY_SLOTS},()=>[]);this.step=0;
  }

  /** Stimulus is n-dimensional and targets PN cells only. ms is neural time. */
  advance(milliseconds,{odor=null,reward=false,learn=true,seed=this.seed}={}){
    requireSeed(seed);
    const steps=Math.round(milliseconds/DT);
    if(!Number.isFinite(milliseconds)||milliseconds<=0||!Number.isSafeInteger(steps)||steps<1
      ||Math.abs(steps*DT-milliseconds)>1e-9||!Number.isSafeInteger(this.step+steps)
      ||typeof reward!=='boolean'||typeof learn!=='boolean'||typeof this.frozen!=='boolean')throw Error('突触回路推进参数无效');
    if(odor!==null){
      if(!(Array.isArray(odor)||ArrayBuffer.isView(odor))||odor.length!==this.n)throw Error('突触气味输入必须与神经元逐项对齐');
      for(let i=0;i<this.n;i++)if(!Number.isFinite(odor[i])||odor[i]<0||odor[i]>1||(this.roles[i]!==PN&&odor[i]!==0))throw Error('突触气味输入只允许 PN 细胞的 [0,1] 活动');
    }
    const counts=new Uint32Array(this.n),seedLow=seed>>>0,seedHigh=Math.floor(seed/4294967296);
    const {n,v,g,refractory,queue,eligibility,dopamine,q,offsets,targets,weights,plasticFraction,plasticEdges,pre,roles,cellLow,cellHigh}=this;
    let gateSum=0,maxGate=0;
    const stop=this.step+steps,learning=learn&&!this.frozen;
    for(let step=this.step;step<stop;step++){
      const arriving=queue[step%DELAY_SLOTS];
      for(let k=0;k<arriving.length;k++){
        const i=arriving[k];
        for(let e=offsets[i];e<offsets[i+1];e++)g[targets[e]]+=weights[e]*(1-plasticFraction[e]+plasticFraction[e]*q[e]);
      }
      arriving.length=0;
      const future=queue[(step+DELAY_SLOTS-1)%DELAY_SLOTS];
      const tick=step+1,tickLow=tick>>>0,tickHigh=Math.floor(tick/4294967296);
      const stepLow=Math.imul(tickLow,0x7F4A7C15)>>>0;
      const stepHigh=(productHigh(tickLow,0x7F4A7C15)+Math.imul(tickHigh,0x7F4A7C15)+Math.imul(tickLow,0x9E3779B9))>>>0;
      let danSum=0;
      for(let i=0;i<n;i++){
        const receptive=refractory[i]<=step,role=roles[i];
        if(receptive)v[i]=-52+(v[i]+52)*EM+g[i]*COUPLING;
        g[i]*=EG;eligibility[i]*=TRACE_DECAY;dopamine[i]*=TRACE_DECAY;
        // Counter streams have no consumed state: skipping a zero-probability
        // draw preserves every other cell's exact Python stimulus sequence.
        const drive=role===PN?(odor?odor[i]*100:0):role===DAN&&reward?50:0;
        if(drive>0&&mixedUniform(seedLow,seedHigh,stepLow,stepHigh,cellLow[i],cellHigh[i])<drive*DT/1000)v[i]+=68.75;
        if(receptive&&v[i]>-45){
          v[i]=-52;g[i]=0;refractory[i]=step+REFRACTORY_STEPS;future.push(i);counts[i]++;
          if(role===KC)eligibility[i]+=.4;else if(role===DAN)dopamine[i]+=.2;
        }
        if(role===DAN)danSum+=dopamine[i];
      }
      const gate=Math.min(1,Math.max(0,danSum/this.danCount));
      gateSum+=gate;maxGate=Math.max(maxGate,gate);
      if(learning&&gate>0)for(let j=0;j<plasticEdges.length;j++){
        const e=plasticEdges[j],activity=Math.min(1,eligibility[pre[e]]);
        q[e]=Math.max(.05,q[e]*Math.exp(-2*activity*gate*DT/1000));
      }
    }
    this.step=stop;
    for(let i=0;i<n;i++)if(!Number.isFinite(v[i])||!Number.isFinite(g[i])||Math.abs(g[i])>1e7)throw Error('突触神经模拟数值不稳定');
    let mbonSpikes=0;for(const i of this.mbonIndices)mbonSpikes+=counts[i];
    return {counts,rateMBON:mbonSpikes*1000/milliseconds/this.mbonIndices.length,gate:gateSum/steps,maxGate,neuralMilliseconds:milliseconds};
  }

  serializeWeights(){
    return {format:1,modelVersion:SYNAPTIC_MODEL_VERSION,graphHash:SYNAPTIC_GRAPH_HASH,
      efficacy:Array.from(this.plasticEdges,e=>this.q[e])};
  }

  restoreWeights(saved){
    validateSynapticMemory(saved);
    // Complete validation happens before either weights or activity changes.
    const efficacy=Float64Array.from(saved.efficacy);
    this.q.fill(1);for(let j=0;j<this.plasticEdges.length;j++)this.q[this.plasticEdges[j]]=efficacy[j];
    this.resetActivity();
  }
}
