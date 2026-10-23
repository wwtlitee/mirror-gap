// Shared deterministic arcade rules: screen observations -> neural input -> one axis.
export const CARTRIDGES = Object.freeze({racer:'像素公路',breakout:'砖块弹球',invaders:'星际巡航','light-chase':'追一束光'});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const hash=n=>{const x=Math.sin(n*127.1+8.3)*43758.5453;return x-Math.floor(x);};
export function createArcade(id='racer',round=1){
  if(!Object.hasOwn(CARTRIDGES,id))throw new Error('未知游戏');
  return {id,round,score:0,best:0,phase:'running',restart:0,t:0,spawn:0,serial:0,player:80,
    objects:[],shots:[],ball:{x:80,y:83,vx:25,vy:-32},bricks:Array(24).fill(1),hits:0};
}
export function validateArcade(g,id){
  const finite=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e9;
  const obj=o=>o&&['x','y','vx','vy'].every(k=>finite(o[k]));
  if(!g||g.id!==id||!Object.hasOwn(CARTRIDGES,id)||!['running','over'].includes(g.phase)
    ||!['round','score','best','restart','t','spawn','serial','player','hits'].every(k=>finite(g[k])&&g[k]>=0)
    ||g.player<13||g.player>147||!Number.isInteger(g.round)||!Number.isInteger(g.serial)
    ||!Array.isArray(g.objects)||g.objects.length>32||!g.objects.every(obj)
    ||!Array.isArray(g.shots)||g.shots.length>32||!g.shots.every(obj)||!obj(g.ball)
    ||!Array.isArray(g.bricks)||g.bricks.length!==24||!g.bricks.every(v=>v===0||v===1))throw new Error('游戏存档无效，原始文件保留');
  return g;
}
export function arcadeObservation(g){
  if(!g||g.phase!=='running')return [0,0];
  if(g.id==='breakout')return [clamp((g.ball.x-g.player)/65,-1,1),0];
  if(g.id==='invaders'){
    const target=[...g.objects].sort((a,b)=>b.y-a.y)[0];
    return [target?clamp((target.x-g.player)/65,-1,1):0,0];
  }
  let contrast=0;
  for(const car of g.objects){
    const dx=g.player-car.x, proximity=Math.max(0,(car.y-22)/82);
    contrast+=(dx>=0?1:-1)*Math.exp(-Math.abs(dx)/24)*proximity;
  }
  return [clamp(contrast+(g.player<35?.5:g.player>125?-.5:0),-1,1),0];
}
function finish(g){g.phase='over';g.restart=1.4;g.best=Math.max(g.best,g.score);g.hits++;}
export function stepArcade(g,motor,dt){
  if(!Number.isFinite(dt)||dt<0||dt>.25)throw new Error('游戏时间无效');
  const steer=Number.isFinite(motor?.local?.[0])?clamp(motor.local[0],-1,1):0;
  if(g.phase==='over'){
    g.restart=Math.max(0,g.restart-dt);
    if(!g.restart){const best=g.best,hits=g.hits;Object.assign(g,createArcade(g.id,g.round+1),{best,hits});}
    return;
  }
  g.t+=dt;g.player=clamp(g.player+steer*48*dt,13,147);g.spawn=Math.max(0,g.spawn-dt);
  if(g.id==='racer'){
    if(g.spawn<=0){g.objects.push({x:30+Math.floor(hash(++g.serial+g.round*29)*3)*50,y:-15,vx:0,vy:25});g.spawn=1.75;}
    for(const car of g.objects){car.y+=car.vy*dt;if(Math.abs(car.x-g.player)<13&&Math.abs(car.y-99)<16)finish(g);}
    const passed=g.objects.filter(o=>o.y>135).length;g.score+=passed*10;g.objects=g.objects.filter(o=>o.y<=135);
  }else if(g.id==='breakout'){
    // Slow the ball only: paddle and neural feedback retain their original cadence.
    const b=g.ball,oldY=b.y,ballDt=dt*.45;b.x+=b.vx*ballDt;b.y+=b.vy*ballDt;
    if(b.x<5||b.x>155){b.x=clamp(b.x,5,155);b.vx=-b.vx;}
    if(b.y<18){b.y=18;b.vy=Math.abs(b.vy);}
    if(b.vy>0&&oldY<=100&&b.y>=100&&Math.abs(b.x-g.player)<20){b.y=100;b.vy=-Math.abs(b.vy);b.vx=clamp((b.x-g.player)*2,-35,35);}
    for(let i=0;i<24;i++)if(g.bricks[i]){
      const x=7+(i%6)*25,y=24+Math.floor(i/6)*10;
      if(b.x>=x-3&&b.x<=x+25&&b.y>=y-3&&b.y<=y+10){g.bricks[i]=0;b.vy=-b.vy;g.score+=10;break;}
    }
    if(b.y>122||g.bricks.every(v=>v===0))finish(g);
  }else if(g.id==='invaders'){
    if(g.spawn<=0){g.objects.push({x:20+hash(++g.serial+g.round*17)*120,y:18,vx:0,vy:9});g.spawn=1.65;}
    if(Math.floor(g.t*3)!==Math.floor((g.t-dt)*3))g.shots.push({x:g.player,y:99,vx:0,vy:-75});
    for(const shot of g.shots){shot.y+=shot.vy*dt;for(const enemy of g.objects)if(!enemy.dead&&Math.abs(shot.x-enemy.x)<10&&Math.abs(shot.y-enemy.y)<8){enemy.dead=true;shot.y=-10;g.score+=10;break;}}
    for(const enemy of g.objects){enemy.y+=enemy.vy*dt;if(!enemy.dead&&enemy.y>99)finish(g);}
    g.shots=g.shots.filter(o=>o.y>14).slice(-32);g.objects=g.objects.filter(o=>!o.dead).slice(-32);
  }
}

export function drawArcade(ctx,g,{idle=false,title='PIXEL ROAD'}={}){
  ctx.imageSmoothingEnabled=false;ctx.fillStyle='#071b24';ctx.fillRect(0,0,160,120);
  ctx.font='6px monospace';ctx.fillStyle='#b4e4cf';ctx.fillText(title,5,8);
  ctx.textAlign='right';ctx.fillText(String(g?.score??0).padStart(4,'0'),155,8);ctx.textAlign='left';
  if(!g){ctx.fillText('WAITING FOR MIRROR GAP',13,61);return;}
  if(g.id==='racer'){
    ctx.fillStyle='#20433c';ctx.fillRect(0,13,17,107);ctx.fillRect(143,13,17,107);
    ctx.fillStyle='#ced5b0';ctx.fillRect(18,13,2,107);ctx.fillRect(140,13,2,107);
    for(let y=-14;y<125;y+=24){ctx.fillStyle='#6d8780';ctx.fillRect(59,y+(g.t*25%24),2,11);ctx.fillRect(100,y+(g.t*25%24),2,11);}
    const car=(x,y,color)=>{ctx.fillStyle='#030b11';ctx.fillRect(x-8,y-8,16,17);ctx.fillStyle=color;ctx.fillRect(x-5,y-11,10,23);ctx.fillStyle='#b6e9dd';ctx.fillRect(x-4,y-5,8,5);ctx.fillStyle='#091b2b';ctx.fillRect(x-3,y+5,6,4);};
    for(const o of g.objects)car(Math.round(o.x),Math.round(o.y),'#e78d69');car(Math.round(g.player),99,'#78d3b4');
  }else if(g.id==='breakout'){
    for(let i=0;i<24;i++)if(g.bricks[i]){ctx.fillStyle=['#e49375','#dfb76e','#8fbfb0','#719eab'][Math.floor(i/6)];ctx.fillRect(7+i%6*25,24+Math.floor(i/6)*10,22,7);}
    ctx.fillStyle='#f0ddb0';ctx.fillRect(g.ball.x-2,g.ball.y-2,4,4);ctx.fillStyle='#83d7c1';ctx.fillRect(g.player-17,104,34,4);
  }else if(g.id==='invaders'){
    ctx.fillStyle='#456779';for(let i=0;i<32;i++)ctx.fillRect(hash(i+9)*160,14+(i*37+g.t*6)%106,1,1);
    ctx.fillStyle='#9ddccc';ctx.fillRect(g.player-2,97,4,10);ctx.fillRect(g.player-8,103,16,4);
    ctx.fillStyle='#efd7a1';for(const s of g.shots)ctx.fillRect(s.x,s.y,2,5);
    for(const e of g.objects){ctx.fillStyle='#df927b';ctx.fillRect(e.x-6,e.y-3,12,6);ctx.fillRect(e.x-10,e.y,20,3);ctx.fillStyle='#081b24';ctx.fillRect(e.x-4,e.y-2,2,2);ctx.fillRect(e.x+2,e.y-2,2,2);}
  }
  if(idle||g.phase==='over'){ctx.fillStyle='#071b24d9';ctx.fillRect(12,46,136,28);ctx.fillStyle='#f3d6a0';ctx.fillText(idle?'WAITING FOR MIRROR GAP':'NEXT ROUND...',21,62);}
}
