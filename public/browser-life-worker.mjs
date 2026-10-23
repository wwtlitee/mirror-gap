import {EmbodiedLife} from '../src/embodied-life.mjs';
import {RuntimeClock} from '../src/runtime-clock.mjs';
import {collisionInfo} from './collision-world.mjs';
import {companionCheckpoint,restoreCompanion} from './companion-checkpoint.mjs';
import {adoptCompanion,validName} from './companion-identity.mjs';
import {flushCompanion} from './companion-learning.mjs';
let sim,clock,last=performance.now(),hidden=false,lastCheckpoint=0,checkpointRevision=0,failed=false;
const state=()=>({...sim.snapshot(),collision:collisionInfo,neural:sim.neural.snapshot(),server:{testing:false,connected:true,mode:'digital-twin',persistenceError:null,timing:clock.snapshot()}});
const checkpoint=()=>companionCheckpoint(sim.state,{revision:++checkpointRevision,modelFingerprint:sim.neural.fingerprint??null});
const emit=(force=false,saved=null)=>{
 if(!sim||failed||hidden&&!force)return;
 const needsCheckpoint=force||performance.now()-lastCheckpoint>=2000;
 if(needsCheckpoint)lastCheckpoint=performance.now();
 postMessage({type:'state',state:state(),...(needsCheckpoint?{checkpoint:saved??checkpoint()}:{})});
};
const fail=error=>{if(!failed){failed=true;postMessage({type:'error',error:error.message});}};
onmessage=({data})=>{try{
 if(data.type==='init'){
  // Repeated handshakes cannot replace a living identity or recreate its brain.
  if(sim){postMessage({type:'initialized'});return;}
  const learningMode=data.saved?.format===2&&Object.hasOwn(data.saved,'synapticMemory')
    ?data.saved.synapticMemoryMode??'legacy-food':'neutral';
  const initial=new EmbodiedLife(null,{learningMode});restoreCompanion(initial.state,data.saved);
  if(initial.state.synapticMemory)initial.neural.learning.restoreWeights(initial.state.synapticMemory);
  initial.state.synapticMemory=initial.neural.learning.serializeWeights();
  initial.state.synapticMemoryMode=initial.neural.learningMode??learningMode;
  initial.state.synapticForaging=initial.state.synapticMemoryMode==='legacy-food';
  sim=initial;hidden=data.hidden===true;checkpointRevision=data.saved?.metadata?.revision??0;
  sim.setPaused(!sim.state.companion.identity.adoptedAt);
  sim.setSpeed(1);clock=new RuntimeClock(sim);last=performance.now();emit(true);return;
 }
 if(data.type==='visibility'){
  if(typeof data.hidden!=='boolean')throw Error('页面可见状态无效');
  if(hidden===data.hidden)return;
  hidden=data.hidden;last=performance.now();if(hidden&&sim)flushCompanion(sim.state);emit(true);return;
 }
 if(!sim)throw Error('数字分身尚未就绪');
 let result;
 if(data.path==='/api/state')result=state();
 else if(data.path==='/api/companion/export'){flushCompanion(sim.state);result=checkpoint();emit(true,result);}
 else if(data.path==='/api/companion'){
  const c=sim.state.companion,{type,value}=data.body??{};
  if(type==='adopt'){adoptCompanion(c,value);sim.setPaused(false);last=performance.now();}
  else if(type==='rename'){if(!c.identity.adoptedAt)throw Error('请先领养。');c.identity.name=validName(value);}
  else if(type==='voice'){if(typeof value?.enabled!=='boolean'||!Number.isFinite(value.volume)||value.volume<0||value.volume>1)throw Error('声音设置无效。');c.voice={...c.voice,enabled:value.enabled,volume:value.volume};}
  else throw Error('未知的果蝇操作');
  result=state();emit(true);
 }
 else if(data.path.startsWith('/api/neural/cells')){const p=new URL(data.path,'https://local').searchParams;result=sim.neural.cells({query:p.get('q')??'',role:p.get('role')??'all',page:Number(p.get('page')??0)});}
 else if(data.path==='/api/command'){
  const {type,value}=data.body;
  if(!sim.state.companion.identity.adoptedAt)throw Error('请先领养这只果蝇。');
  if(type==='pause')sim.setPaused(value);
  else if(type==='speed'&&value===1)sim.setSpeed(1);
  else if(['daytime','screen','leave-game','disturbance','game','water','weather','care'].includes(type))sim.environmentCommand(type,value);
  else if(['feed','mist','chime'].includes(type))sim.interact(type);
  else throw Error('未知操作');
  if(type==='weather')result={ok:true};else{result=state();emit(true);}
 }else throw Error('接口不存在');
 postMessage({id:data.id,result});
}catch(e){if(data.id)postMessage({id:data.id,type:'error',error:e.message});else fail(e);}};
setInterval(()=>{try{const now=performance.now(),elapsed=(now-last)/1000;last=now;if(sim&&!hidden&&!failed)clock.advance(elapsed);}catch(error){fail(error);}},8);
setInterval(()=>{try{emit();}catch(error){fail(error);}},200);

postMessage({type:'booted'});
