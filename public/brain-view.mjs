// Adapted from the user's fly-chaser brain-view. Coordinates are schematic only.
export function createBrainView(canvas) {
const status=document.getElementById('neural-status');
let worker=null;
if(typeof Worker!=='undefined'&&canvas.transferControlToOffscreen){
 worker=new Worker(new URL('./brain-worker.mjs',import.meta.url),{type:'module'});
 const offscreen=canvas.transferControlToOffscreen();worker.postMessage({type:'init',canvas:offscreen},[offscreen]);
 worker.onerror=()=>{status.textContent='脑图绘制暂不可用';};
}
const ctx=worker?null:canvas.getContext('2d',{alpha:true,willReadFrequently:true});
let lastSize='';
let graph=null,lastFrame=0,lastSteps=0,raf=0,lastSequence=-1,online=false,stateStatus='starting',disposed=false,geometryError=false;
const active=new Map(),travels=new Map();
function hash(i){const n=Math.sin(i*127.1+311.7)*43758.5453;return n-Math.floor(n);}
let positions=[];
function makePositions(n){return Array.from({length:n},(_,i)=>{
  const side=i%2?1:-1,angle=hash(i+2)*Math.PI*2,vertical=1-2*hash(i+2051);
  const radius=Math.cbrt(hash(i+7012)),ring=Math.sqrt(1-vertical*vertical)*radius;
  // Schematic central brain, lateral optic lobes and ventral connection.
  // These display coordinates are not anatomical measurements of the connectome.
  const region=hash(i+9012);
  const part=region<.53?{x:.145,y:-.045,sx:.19,sy:.225,sz:.165}:
    region<.88?{x:.405,y:.005,sx:.115,sy:.18,sz:.115}:
    {x:.06,y:.19,sx:.09,sy:.12,sz:.11};
  return {x:side*(part.x+Math.cos(angle)*ring*part.sx),
    y:part.y+vertical*radius*part.sy,z:Math.sin(angle)*ring*part.sz};
});}

const controller = new AbortController();
fetch('/assets/functional-brain-view.json', {signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json();})
  .then(g=>{if(!disposed){graph=g;positions=makePositions(g.neurons);worker?.postMessage({type:'graph',graph:g});}}).catch(error=>{if(error.name!=='AbortError'){geometryError=true;status.textContent='脑图加载失败';}});
function update(data, connected) {
  online=connected; stateStatus=data?.status || 'unavailable';
  document.getElementById('neuron-count').textContent=data?.neurons ? data.neurons.toLocaleString('en-US') : '—';
  document.getElementById('neural-note').textContent=!data?.available ? data?.reason || '神经数据暂不可用'
    : '功能回路 → 神经响应 → 身体 / 屏幕 · 脑图抽样示意';
  if(!connected || !data?.available || data.status === 'paused') {
    active.clear(); travels.clear();worker?.postMessage({type:'frame',clear:true});
    status.textContent=!connected?'数据已断开':data?.status==='paused'?'已暂停':'暂不可用';
    document.getElementById('spike-count').textContent='—';
    return;
  }
  if(geometryError){status.textContent='脑图加载失败';return;}
  const frame=data.frame;
  if(!frame){status.textContent='等待首帧';return;}
  if(frame.sequence===lastSequence)return;
  if(frame.sequence<lastSequence){active.clear();travels.clear();}
  if(visibleToViewer)worker?.postMessage({type:'frame',spikes:frame.spikes,transmitted:frame.transmitted});
  lastSequence=frame.sequence;lastSteps=frame.steps;lastFrame=performance.now();
  for(const i of frame.spikes)if(Number.isInteger(i)&&i>=0&&i<positions.length)active.set(i,lastFrame);
  for(const i of frame.transmitted)if(Number.isInteger(i)&&i>=0&&i<positions.length)travels.set(i,lastFrame);
  status.textContent=frame.spikeCount?'检测到放电':'正在采样';
  document.getElementById('spike-count').textContent=String(frame.spikeCount);
  document.getElementById('neural-steps').textContent=frame.steps.toLocaleString('en-US');
}
function disconnect(){worker?.postMessage({type:'frame',clear:true});online=false;active.clear();travels.clear();status.textContent='数据已断开';document.getElementById('spike-count').textContent='—';}
const reducedMotion=matchMedia('(prefers-reduced-motion:reduce)');
let visibleToViewer=false,lastVisibility='';
const visibility=()=>{visibleToViewer=!document.hidden&&canvas.clientWidth>0&&canvas.clientHeight>0&&getComputedStyle(canvas).visibility!=='hidden';const key=`${visibleToViewer}/${reducedMotion.matches}`;if(key!==lastVisibility){worker?.postMessage({type:'visibility',visible:visibleToViewer,rotate:!reducedMotion.matches});lastVisibility=key;}};document.addEventListener('visibilitychange',visibility);reducedMotion.addEventListener('change',visibility);visibility();
let previous=0,rotation=0;
function draw(now){
  raf = requestAnimationFrame(draw);if(now-previous<80)return;visibility();if(!visibleToViewer){previous=now;return;}
  if(previous&&!reducedMotion.matches)rotation=(rotation+Math.min(.1,(now-previous)/1000)*Math.PI*2/45)%(Math.PI*2);
  previous=now;
  const rect={width:canvas.clientWidth,height:canvas.clientHeight},dpr=Math.min(devicePixelRatio,2);
  const w=rect.width,h=rect.height;if(!w||!h)return;
  if(worker){const key=`${w}/${h}/${dpr}`;if(key!==lastSize){worker.postMessage({type:'size',width:w,height:h,dpr});lastSize=key;}for(const [i,t]of active)if(now-t>600)active.delete(i);for(const [i,t]of travels)if(now-t>450)travels.delete(i);return;}
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const scale=Math.min(w*1.35,h*1.4);
  const cos=Math.cos(rotation),sin=Math.sin(rotation);
  const project=(x,y,z)=>{
    const rx=x*cos+z*sin,rz=-x*sin+z*cos,perspective=1/(1-rz*.38);
    return{x:w*.5+rx*scale*.55*perspective,y:h*.43+y*scale*.8*perspective,depth:rz};
  };
  const projected=positions.map(p=>project(p.x,p.y,p.z));
  const xy=i=>projected[i];
  for(const [i,t]of active)if(now-t>600)active.delete(i);
  for(const [i,t]of travels)if(now-t>450)travels.delete(i);
  // Group real sampled activity by opacity. Thousands of individual Canvas2D
  // fills/strokes stalled software compositing alongside WebGL every 80 ms.
  const edgeBins=Array.from({length:7},()=>[]),dots=[],nodeBins=Array.from({length:9},()=>[]);
  if(graph)for(let k=0;k<graph.pre.length;k++){
    const pre=graph.pre[k],post=graph.post[k],a=xy(pre),b=xy(post),t=travels.get(pre);
    if(!a||!b)continue;
    const bin=t===undefined?0:Math.max(1,Math.min(6,Math.ceil((1-(now-t)/450)*6)));
    edgeBins[bin].push(a.x,a.y,b.x,b.y);
    if(t!==undefined){const progress=Math.min(1,(now-t)/450);dots.push(a.x+(b.x-a.x)*progress,a.y+(b.y-a.y)*progress);}
  }
  edgeBins.forEach((lines,bin)=>{if(!lines.length)return;ctx.strokeStyle=bin?'rgba(234,181,111,'+(bin/6*.6)+')':'#769eb014';ctx.lineWidth=bin?.8:.4;ctx.beginPath();for(let i=0;i<lines.length;i+=4){ctx.moveTo(lines[i],lines[i+1]);ctx.lineTo(lines[i+2],lines[i+3]);}ctx.stroke();});
  ctx.fillStyle='#f2d5a0';ctx.beginPath();for(let i=0;i<dots.length;i+=2){ctx.moveTo(dots[i]+1.2,dots[i+1]);ctx.arc(dots[i],dots[i+1],1.2,0,7);}ctx.fill();
  for(const i of graph?.sample??[]){const p=xy(i),t=active.get(i);if(!p)continue;const bin=t===undefined?(p.depth>.1?0:p.depth>-.1?1:2):3+Math.max(0,Math.min(5,Math.ceil((1-(now-t)/600)*6)-1));nodeBins[bin].push(p.x,p.y);}
  nodeBins.forEach((points,bin)=>{if(!points.length)return;ctx.fillStyle=bin<3?['#c3d8e4a0','#91b2c268','#54798530'][bin]:'rgba(255,204,130,'+((bin-2)/6)+')';const radius=bin<3?.65:1.8;ctx.beginPath();for(let i=0;i<points.length;i+=2){ctx.moveTo(points[i]+radius,points[i+1]);ctx.arc(points[i],points[i+1],radius,0,7);}ctx.fill();});
  if (online && stateStatus === 'live' && lastFrame && now-lastFrame > 1800) {
    status.textContent='等待新采样'; active.clear(); travels.clear();
    document.getElementById('spike-count').textContent='—';
  }
}

raf=requestAnimationFrame(draw);
return {update,disconnect,diagnostics:()=>({steps:lastSteps,activeNeurons:active.size,transmittingNeurons:travels.size,worker:!!worker,visible:visibleToViewer,schematic:true,online,status:stateStatus,rotationRadians:rotation}),
  dispose(){document.removeEventListener('visibilitychange',visibility);reducedMotion.removeEventListener('change',visibility);worker?.terminate();disposed=true;controller.abort();cancelAnimationFrame(raf);active.clear();travels.clear();}};
}
