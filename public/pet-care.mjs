import {validateFoodStock,refillFood} from './food-stock.mjs';
import {soundSensitivity} from './companion-learning.mjs';
// All timers use active simulation seconds; no offline catch-up or permanent death.
const clamp=v=>Math.max(0,Math.min(1,v));
export const createCare=()=>({weakness:0,deprivation:0,refillAt:0,rain:0,wind:0,habituation:0,stimulus:0,footstep:0,nextFoot:45,stepIndex:0,lastSound:'quiet'});
export const createMaintenance=()=>({foodFresh:1,waterFresh:1,cleanliness:1,bedding:1,wasteSeen:0,brush:0,dry:0,helpUntil:0,enrichUntil:0,quiet:false,nextAction:0,soundSequence:0,soundKind:'clean'});
export function maintenance(state){return (state.living.care??=createCare()).maintenance??=createMaintenance();}
export function validateCare(c){
  if(!c||!['weakness','rain','wind','habituation','stimulus'].every(k=>Number.isFinite(c[k])&&c[k]>=0&&c[k]<=1)||!['deprivation','refillAt','footstep','nextFoot','stepIndex'].every(k=>Number.isFinite(c[k])&&c[k]>=0&&c[k]<=1e12)||!['quiet','rain','wind','footstep','feed','water'].includes(c.lastSound))throw Error('照顾与环境存档无效');
  validateFoodStock(c.foods);
  const m=c.maintenance;
  if(m&&(!['foodFresh','waterFresh','cleanliness','bedding'].every(k=>Number.isFinite(m[k])&&m[k]>=0&&m[k]<=1)||!['wasteSeen','brush','dry','helpUntil','enrichUntil','nextAction'].every(k=>Number.isFinite(m[k])&&m[k]>=0&&m[k]<=1e12)||typeof m.quiet!=='boolean'))throw Error('养护存档无效');
  if(m?.soundSequence!==undefined&&(!Number.isSafeInteger(m.soundSequence)||m.soundSequence<0||!['food','water','clean','bedding','brush','dry','enrich','quiet'].includes(m.soundKind)))throw Error('养护声音存档无效');
  return c;
}
export function receiveWeather(state,value){
  if(!value||!['rain','wind'].every(k=>Number.isFinite(value[k])&&value[k]>=0&&value[k]<=1))throw Error('天气刺激无效');
  const c=state.living.care??=createCare();
  if(state.paused)return;
  const onset=Math.max(0,value.rain-c.rain,value.wind-c.wind);
  const sound=value.rain>c.rain?'rain':'wind';
  c.stimulus=Math.max(c.stimulus,onset*.08*(1-c.habituation*.7)*soundSensitivity(state,sound));
  if(onset>.05)c.lastSound=value.rain>c.rain?'rain':'wind';
  c.rain=value.rain;c.wind=value.wind;
}
export function replenish(state,kind){
  if(!['food','water'].includes(kind))throw Error('补充类型无效');
  const c=state.living.care??=createCare();
  if(kind==='water'&&state.simSeconds<c.refillAt)throw Error('刚刚补充过，请稍等片刻。');
  const old=state.home[kind],m=maintenance(state),fresh=kind==='food'?'foodFresh':'waterFresh';
  if(kind==='food')refillFood(state);else state.home.water=Math.min(100,old+40);
  const added=state.home[kind]-old;
  m[fresh]=(old*m[fresh]+added)/Math.max(1,old+added);
  m.soundSequence=(m.soundSequence??0)+1;m.soundKind=kind;
  if(kind==='water')c.refillAt=state.simSeconds+2;
  c.lastSound=kind==='food'?'feed':'water';c.stimulus=Math.max(c.stimulus,.035);state.stats.refills++;
}
export function careAction(state,action){
  const labels={'replace-food':'换上了新鲜食物。','replace-water':'洗净水碗，换上了清水。',clean:'清理了厕所和房间污物。',bedding:'换上了干净垫料。',brush:'准备好软刷，等它落稳后轻轻梳理。',dry:'准备吸干水珠，等它落稳后慢慢擦干。',enrich:'准备好了游戏，等它有精神时自己来玩。',quiet:'切换了安静休息安排。'};
  if(!Object.hasOwn(labels,action))throw Error('养护操作无效');
  const m=maintenance(state),l=state.living;
  if(state.simSeconds<m.nextAction)throw Error('正在照顾它，请稍等两秒。');
  m.nextAction=state.simSeconds+2;
  if(!['quiet','enrich'].includes(action))state.living.care.stimulus=Math.max(state.living.care.stimulus,.025);
  m.soundSequence=(m.soundSequence??0)+1;m.soundKind=action.replace('replace-','');
  if(action==='replace-food'){refillFood(state,{replace:true});m.foodFresh=1;}
  if(action==='replace-water'){state.home.water=100;m.waterFresh=1;}
  if(action==='clean'){m.cleanliness=1;m.wasteSeen=l.hygiene.bowelMovements;l.hygiene.lastDropPosition=null;}
  if(action==='bedding')m.bedding=1;
  if(action==='brush'||action==='dry'){m[action]=10;m.helpUntil=state.simSeconds+60;}
  if(action==='enrich'){m.enrichUntil=state.simSeconds+180;m.quiet=false;l.workstation.enabled=true;}
  if(action==='quiet'){m.quiet=!m.quiet;l.workstation.enabled=!m.quiet;}
  return labels[action];
}
export function updateMaintenance(state,dt,{resting=false,drinking=false}={}){
  if(state.paused||!state.companion?.identity.adoptedAt)return;
  const m=maintenance(state),l=state.living,p=l.physiology,n=state.needs;
  if(state.home.food>0)m.foodFresh=clamp(m.foodFresh-dt/3600);
  if(state.home.water>0)m.waterFresh=clamp(m.waterFresh-dt/4800);
  const newWaste=Math.max(0,l.hygiene.bowelMovements-m.wasteSeen);m.wasteSeen=l.hygiene.bowelMovements;
  m.cleanliness=clamp(m.cleanliness-newWaste*.18-dt/14400);
  m.bedding=clamp(m.bedding-dt*(resting?1/1800:1/14400));
  n.comfort=Math.max(0,Math.min(100,n.comfort+dt*((resting?m.bedding*.04:0)-(1-m.cleanliness)*.025-(state.actor.action==='eat'?(1-m.foodFresh)*.06:0)-(drinking?(1-m.waterFresh)*.06:0))));
  if(resting){n.energy=Math.min(100,n.energy+dt*(m.bedding-.5)*.08);p.sleepPressure=clamp(p.sleepPressure-dt*m.bedding*.0005);}
  if(state.actor.contact)p.dirt=clamp(p.dirt+dt*(1-m.cleanliness)*.00005);
  if(l.workstation.phase==='playing'&&state.simSeconds<m.enrichUntil)n.curiosity=Math.max(0,n.curiosity-dt*.12);
  if(state.simSeconds>m.helpUntil){m.brush=0;m.dry=0;}
  if(state.actor.contact&&Math.hypot(...state.actor.velocity)<.06&&!resting&&!drinking&&state.actor.action!=='eat'){
    const brush=Math.min(dt,m.brush),dry=Math.min(dt,m.dry);m.brush-=brush;m.dry-=dry;
    p.dirt=clamp(p.dirt-brush*.018);l.wetness=clamp(l.wetness-dry*.035);
  }
}
export function updateCare(state,dt){
  if(state.paused||!state.companion?.identity.adoptedAt)return;
  const c=state.living.care??=createCare(),n=state.needs,p=state.living.physiology;
  const deprived=n.satiety<12||p.thirst>.9;
  c.deprivation=deprived?Math.min(1e12,c.deprivation+dt):Math.max(0,c.deprivation-dt*3);
  c.weakness=clamp(c.weakness+dt*(deprived&&c.deprivation>120?1/900:n.satiety>25&&p.thirst<.65?-1/180:0));
  c.habituation=clamp(c.habituation+dt*(c.rain+c.wind>.1?1/1200:-1/2400));
  c.stimulus*=Math.exp(-dt/2);
  if(state.simSeconds>=c.nextFoot){
    c.footstep++;c.lastSound='footstep';c.stepIndex=(c.stepIndex+1)%6;
    c.nextFoot=state.simSeconds+(c.stepIndex?.48:70+((c.footstep*7919)%110));
    const distance=Math.hypot(state.actor.position[0]-5.8,state.actor.position[2]-3.5);
    const sensitivity=.7+(state.companion.temperament?.caution??.5)*.6;
    const signal=.16*Math.exp(-distance/6)*sensitivity*(1-c.habituation*.7)*(c.maintenance?.quiet ? .6 : 1)*soundSensitivity(state,'footstep');
    c.stimulus=Math.max(c.stimulus,signal);
    // Distant footsteps stay below the startle threshold and cannot force a wake-up.
    state.living.alert=Math.min(1,state.living.alert+signal*.12);
  }
}
