// Isolated CPU rasterization keeps the neural diagram off the room/UI thread.
let canvas,ctx,graph=null,width=0,height=0,dpr=1,rotation=0,previous=0,visible=true,rotate=true;
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


self.onmessage=({data})=>{
 if(data.type==='visibility'){visible=data.visible;rotate=data.rotate;}
 if(data.type==='init'){canvas=data.canvas;ctx=canvas.getContext('2d',{alpha:true,willReadFrequently:true});}
 if(data.type==='graph'){graph=data.graph;positions=makePositions(graph.neurons);}
 if(data.type==='size'){width=data.width;height=data.height;dpr=data.dpr;}
 if(data.type==='frame'){const now=performance.now();if(data.clear){active.clear();travels.clear();}else{for(const n of data.spikes)active.set(n,now);for(const n of data.transmitted)travels.set(n,now);}}
};
function draw(now){
 setTimeout(()=>draw(performance.now()),80);
 if(!ctx||!width||!height||!visible)return;
 if(previous&&rotate)rotation=(rotation+Math.min(.1,(now-previous)/1000)*Math.PI*2/45)%(Math.PI*2);previous=now;
 const w=width,h=height;
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

}
draw(performance.now());
