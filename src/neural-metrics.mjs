// Read-only observability. No noise, state writes, or hidden motor commands.
const INPUT_LABELS = ['航向 · 左','航向 · 右','目标 · 左','目标 · 右','糖感受','水感受','触角机械感受','视觉趋近 · 左','视觉趋近 · 右'];
const FUNCTIONS = {
  PFL3:'方向与转向',PFL2:'方向调整',DNa01:'低增益转向候选',DNa02:'行走转向',DNg13:'行走转向',
  DNa03:'飞行转向候选',DNa04:'飞行转向候选',DNa15:'飞行转向候选',DNb01:'飞行相关候选',
  DNg07:'飞行动力候选',DNp20:'飞行动力候选',DNp01:'视觉惊逃',DNp07:'着陆伸腿',DNp10:'着陆伸腿',
  DNp09:'运动与停顿',MDN:'后退相关',CB0701:'MN9 · 进食启动',DNg62:'触角梳理输出',DNge078:'触角梳理输出',
  SAD093:'触角梳理中继',ER5:'睡眠相关候选',ExR1:'睡眠结构候选',ExR3:'睡眠结构候选',hDeltaK:'睡眠结构候选',
  's-LNv_a':'昼夜节律候选','s-LNv_b':'昼夜节律候选','l-LNv':'昼夜节律候选',
};

export class NeuralMetrics {
  constructor(graph){
    this.graph=graph;this.counts=new Uint16Array(graph.neurons);this.windowMs=0;this.sequence=0;
    this.input=new Set(graph.channels.flat());this.motor=new Set(graph.motorIndices);
    this.behavior=new Set(Object.values(graph.behaviorIndices).flat());
    this.groups=[];const groups=new Map();
    graph.labels.forEach((label,index)=>{
      if(!label.anchor||this.input.has(index))return;
      const type=label.type||'unannotated';
      if(!groups.has(type))groups.set(type,{id:type,label:FUNCTIONS[type]??type,count:0,left:[],right:[],other:[],role:this.motor.has(index)?'motor':this.behavior.has(index)?'behavior':'candidate'});
      const group=groups.get(type);group.count++;group[['left','right'].includes(label.side)?label.side:'other'].push(index);
    });
    this.groups=[...groups.values()].sort((a,b)=>a.id.localeCompare(b.id));
  }

  sample(spikes,steps,sequence){
    this.counts.fill(0);for(const index of spikes)this.counts[index]++;
    this.windowMs=steps*this.graph.dt_ms;this.sequence=sequence;
  }

  hz(indices){
    if(!this.windowMs||!indices.length)return null;
    return indices.reduce((sum,index)=>sum+this.counts[index],0)/indices.length/(this.windowMs/1000);
  }

  snapshot(inputs){
    return {windowMs:this.windowMs,sampled:this.windowMs>0,sequence:this.sequence,
      inputs:this.graph.channels.map((indices,i)=>({id:this.graph.channelNames[i],label:INPUT_LABELS[i],count:indices.length,
        strength:inputs?.[i]??0,hz:this.hz(indices)})),
      groups:this.groups.map(g=>({id:g.id,label:g.label,role:g.role,count:g.count,
        hz:this.hz([...g.left,...g.right,...g.other]),leftHz:this.hz(g.left),rightHz:this.hz(g.right)}))};
  }

  cells(brain,{query='',page=0,role='all'}={}){
    if(typeof query!=='string'||query.length>80||!Number.isSafeInteger(page)||page<0||page>100000
      ||!['all','input','motor','behavior','candidate','support'].includes(role))throw Object.assign(new Error('细胞查询参数无效'),{statusCode:400});
    const term=query.trim().toLowerCase(),matches=[],pageSize=24;
    this.graph.labels.forEach((label,index)=>{
      const cellRole=this.input.has(index)?'input':this.motor.has(index)?'motor':this.behavior.has(index)?'behavior':label.anchor?'candidate':'support';
      if(role!=='all'&&role!==cellRole)return;
      if(term&&!`${label.root} ${label.type} ${label.side} ${FUNCTIONS[label.type]??''}`.toLowerCase().includes(term))return;
      matches.push({label,index,cellRole});
    });
    const pages=Math.max(1,Math.ceil(matches.length/pageSize)),current=Math.min(page,pages-1);
    return {total:matches.length,page:current,pages,pageSize,windowMs:this.windowMs,sequence:this.sequence,
      cells:matches.slice(current*pageSize,(current+1)*pageSize).map(({label,index,cellRole})=>({
        index,root:label.root,type:label.type||'未注释',side:label.side,role:cellRole,
        hz:this.windowMs?this.counts[index]/(this.windowMs/1000):null,spikes:this.windowMs?this.counts[index]:null,
        voltage:brain.v[index],synapticDrive:brain.g[index],refractoryMs:Math.max(0,brain.ref[index]-brain.step)*this.graph.dt_ms,
      }))};
  }
}
