// Continuous integrate-and-fire simulation of the exported FlyWire subnetwork.
export class Brain {
 constructor(graph,random=Math.random,{inputChannels=null}={}){
  this.n=graph.neurons;this.random=random;this.v=new Float64Array(this.n).fill(-52);this.g=new Float64Array(this.n);this.ref=new Float64Array(this.n);
  // Compressed adjacency retains source order, including duplicate edges, with
  // contiguous storage instead of hundreds of thousands of tiny JS arrays.
  this.edgeOffsets=new Uint32Array(this.n+1);
  for(const source of graph.pre)this.edgeOffsets[source+1]++;
  for(let i=1;i<=this.n;i++)this.edgeOffsets[i]+=this.edgeOffsets[i-1];
  this.edgeTargets=new Uint32Array(graph.pre.length);this.edgeWeights=new Float64Array(graph.pre.length);
  const cursor=this.edgeOffsets.slice();
  for(let i=0;i<graph.pre.length;i++){const at=cursor[graph.pre[i]]++;this.edgeTargets[at]=graph.post[i];this.edgeWeights[at]=graph.weights[i]*.275;}
  this.queue=Array.from({length:19},()=>[]);this.step=0;this.count=new Float64Array(16);this.frames=0;
  this.inputMap = new Int8Array(this.n).fill(-1);
  const channels = inputChannels ?? Array.from({length:4},(_,c)=>Array.from({length:8},(_,i)=>i*4+c));
  if (!channels.length || channels.length > 32) throw new Error('感觉输入通道数量无效');
  this.inputCount = channels.length;
  channels.forEach((group,c)=>group.forEach(i=>{
   if (!Number.isInteger(i)||i<0||i>=this.n||this.inputMap[i]!==-1) throw new Error('感觉输入索引无效');
   this.inputMap[i]=c;
  }));
 }
 // Explicit ablation hook used by negative-control tests; never part of life UI.
 disconnect(){this.edgeOffsets.fill(0);this.edgeTargets=new Uint32Array();this.edgeWeights=new Float64Array();}
 advance(inputs,steps=40,{deferSummary=false}={}){
  if (!Array.isArray(inputs) || inputs.length !== this.inputCount || inputs.some(v => !Number.isFinite(v) || v < 0 || v > 1)
    || !Number.isInteger(steps) || steps < 1 || steps > 2000) throw new Error('无效的神经输入或步数');
  const em=Math.exp(-.1/20),eg=Math.exp(-.1/5),spikes=[],transmitted=[];
  // Keep the exact arithmetic, cell/edge order and RNG calls. Local typed-array
  // references and indexed edge traversal avoid millions of property/iterator
  // operations per readout without reducing neural resolution or connectivity.
  const {n,v,g,ref,inputMap,queue,edgeOffsets,edgeTargets,edgeWeights,count,random}=this;
  let step=this.step;
  for(let s=0;s<steps;s++,step++){
   const slot=step%19,arrivals=queue[slot];
   for(let k=0;k<arrivals.length;k++){
    const i=arrivals[k];transmitted.push(i);
    for(let e=edgeOffsets[i];e<edgeOffsets[i+1];e++)g[edgeTargets[e]]+=edgeWeights[e];
   }
   queue[slot]=[];
   const delayed=queue[(step+18)%19];
   for(let i=0;i<n;i++){
    const receptive=ref[i]<=step;
    if(receptive)v[i]=-52+(v[i]+52)*em+g[i]*(-1/3)*(eg-em);
    g[i]*=eg;
    const channel=inputMap[i];
    if(channel>=0 && random()<inputs[channel]*.02)v[i]+=68.75;
    if(receptive && v[i]>-45){
     spikes.push(i);v[i]=-52;g[i]=0;ref[i]=step+22;
     delayed.push(i);
     if(i>=32)count[Math.min(15,Math.floor((i-32)/((n-32)/16))) ]++;
    }
   }
  }
  this.step=step;this.frames+=steps;
  if(deferSummary)return {steps:this.step,spikes,transmitted};
  let left=0,right=0;
  for(let i=0;i<16;i++){const r=Math.log1p(this.count[i]/Math.max(1,(this.n-32)/16)/(this.frames*.0001));if(i%2)right+=r/8;else left+=r/8;}
  const result={speed:Math.tanh((left+right)/2),turn:2*(right-left)/(left+right+.1),activity:left+right,steps:this.step,spikes,transmitted};
  if(this.frames>=500){this.count.fill(0);this.frames=0;}
  return result;
 }
}
