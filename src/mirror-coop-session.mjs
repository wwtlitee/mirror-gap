import {EmbodiedLife} from './embodied-life.mjs';
import {createCompanion,adoptCompanion} from '../public/companion-identity.mjs';
import {growthSummary} from '../public/companion-growth.mjs';
import {createCare} from '../public/pet-care.mjs';
import {FOOD_IDS,foodStock,syncFoodTotal,withFoodStock} from '../public/food-stock.mjs';
import {surfaceBelow,supportedFeet,segmentOccluded} from '../public/collision-world.mjs';
import {resourceContact} from '../public/resource-contact.mjs';
import {createMechanicalFly,advanceMechanicalFly,pickupMechanicalCargo,dropMechanicalCargo} from '../public/mechanical-fly.mjs';
import {makeMechanicalRoomResolver} from '../public/mechanical-room-collision.mjs';
import {CAMPAIGN_CHAPTERS,CAMPAIGN_STAGES,createCampaignProgress,advanceCampaign,continueCampaign,retryCampaign,restoreCampaignProgress} from '../public/mirror-campaign.mjs';
import {COOP_DOCK,COOP_INTERACTION_RADIUS,coopWorldObjects,deliveryNode,distance3} from '../public/mirror-coop-world.mjs';
import {DEFAULT_TAPEOUT,TAPEOUT_PULSE_SOURCE,parseCircuit,stepCircuit} from '../public/tapeout-circuit.mjs';
import {createCoopTrial,restoreCoopTrial,advanceCoopTrial} from '../public/coop-trial.mjs';
import {createCoopPairing,restoreCoopPairing,advanceCoopPairing} from '../public/coop-pairing.mjs';
import {createCoopClock,restoreCoopClock,advanceCoopClock} from '../public/coop-clock.mjs';

const STEP=.02,PROBE_SECONDS=20,MAX_SAVE_BYTES=2_000_000;
const copy=value=>structuredClone(value),finite=(n,min=0,max=Infinity)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(n=>finite(n,-20,20));
const noInput=()=>({move:[0,0],lift:0,emit:'off',interact:false});
const blankProbe=()=>({running:false,duration:PROBE_SECONDS,elapsed:0,swapped:false,result:null});
const newLevel=()=>({phaseBit:0,relays:{west:0,east:0},dropped:[],nextCargo:1,visited:[],chargedAt:null,pairedStart:null,neutralReadyAt:0});
const TRIALS=Object.freeze({
  courier:{stage:4,title:'搬运试炼',instruction:'带着补给依次经过杯边、书架与餐台，再真正投递到无花果餐盘。'},
  signal:{stage:3,title:'信号试炼',instruction:'保持选择A，切换相位读出两种实际气味，并让有效脉冲累计两秒。'},
});
const qText=sim=>JSON.stringify(sim.neural.learning.serializeWeights().efficacy);
function validateInput(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['move','lift','emit','interact'].includes(k))
    ||!Array.isArray(value.move)||value.move.length!==2||value.move.some(n=>!finite(n,-1,1))||!finite(value.lift,-1,1)
    ||!['A','B','off'].includes(value.emit)||value.interact!==undefined&&typeof value.interact!=='boolean')throw Error('机械果蝇输入无效');
  return {move:[...value.move],lift:value.lift,emit:value.emit,interact:false};
}
function validateSaved(saved){
  if(!saved||typeof saved!=='object'||saved.format!==1||saved.productVersion!=='8.5.0'||!saved.body||!saved.coop
    ||JSON.stringify(saved).length>MAX_SAVE_BYTES)throw Error('合作存档无效，原记录保留');
  const c=saved.coop;
  if(c.substepSeconds!==undefined&&(!finite(c.substepSeconds,0,STEP)||c.substepSeconds>=STEP))throw Error('物理余时记录无效');
  if(!Number.isSafeInteger(c.seed)||c.seed<0||c.seed>0xffffffff||!c.mechanical||!c.level||!c.circuit||!c.probe
    ||!Array.isArray(c.level.dropped)||c.level.dropped.length>32||!Number.isSafeInteger(c.level.nextCargo)||c.level.nextCargo<1
    ||![0,1].includes(c.level.phaseBit)||!Array.isArray(c.circuit.pulseState)||c.circuit.pulseState.length>32
    ||c.circuit.pulseState.some(n=>!Number.isInteger(n)||n<0||n>255)||!finite(c.circuit.elapsed,0,c.circuit.clockStepSeconds??.5)
    ||!Number.isSafeInteger(c.circuit.steps)||c.circuit.steps<0||![0,1].includes(c.circuit.pulseOutput))throw Error('合作存档结构无效');
  if(!c.notice||typeof c.notice.text!=='string'||c.notice.text.length>240||!['info','error','success'].includes(c.notice.tone)||!Number.isSafeInteger(c.notice.serial)||c.notice.serial<0
    ||!c.level.relays||Object.keys(c.level.relays).length!==2||!['west','east'].every(id=>[0,1].includes(c.level.relays[id]))
    ||!Array.isArray(c.level.visited)||c.level.visited.length>8||c.level.visited.some(id=>!['shelf','table','dock'].includes(id))
    ||c.level.chargedAt!==undefined&&c.level.chargedAt!==null&&!['shelf','table','dock'].includes(c.level.chargedAt)
    ||!finite(c.level.neutralReadyAt??0))throw Error('合作提示或机关记录无效');
  restoreCampaignProgress(c.campaign);
  restoreCoopClock(c.circuit);
  if(c.level.pairedStart!==undefined&&c.level.pairedStart!==null){
    const pairing=c.level.pairedStart;restoreCoopPairing(pairing);if(c.campaign.stage!==8||c.trial)throw Error('配对观察记录不属于当前章节');
    if(c.campaign.status==='playing'){
      const efficacy=saved.body.synapticMemory?.efficacy;
      if(!finite(saved.body.simSeconds)||Math.abs(pairing.lastSimSeconds-saved.body.simSeconds)>1e-8||!Array.isArray(efficacy)
        ||efficacy.length!==pairing.lastWeights.efficacy.length||pairing.lastWeights.efficacy.some((q,i)=>q!==efficacy[i]))throw Error('配对观察与实际身体时间或突触不一致');
    }
  }
  if(c.trial!==undefined&&c.trial!==null){restoreCoopTrial(c.trial);if(c.campaign.status!=='complete')throw Error('试炼尚未解锁');}
  if(c.trialHistory!==undefined){
    if(!Array.isArray(c.trialHistory)||c.trialHistory.length>16)throw Error('试炼历史无效');
    for(const record of c.trialHistory){
      const {completedAtSimSeconds,...trial}=record??{};
      restoreCoopTrial(trial);if(trial.status!=='complete'||!finite(completedAtSimSeconds))throw Error('试炼完成记录无效');
    }
  }
  if((c.trial||(c.trialHistory?.length??0)>0)&&c.trialCounts===undefined)throw Error('试炼次数记录缺失');
  if(c.trialCounts!==undefined&&(!c.trialCounts||!['courier','signal'].every(kind=>Number.isSafeInteger(c.trialCounts[kind])&&c.trialCounts[kind]>=0)))throw Error('试炼次数无效');
  for(const trial of [c.trial,...c.trialHistory??[]].filter(Boolean))if(c.trialCounts[trial.kind]<trial.attempt)throw Error('试炼次数不连续');
  for(const item of c.level.dropped)if(!item||!vector(item.position)||!item.cargo||typeof item.id!=='string')throw Error('货物记录无效');
  const p=c.probe;
  if(typeof p.running!=='boolean'||typeof p.swapped!=='boolean'||!finite(p.elapsed,0,PROBE_SECONDS))throw Error('观察存档无效');
  if(p.running&&(!p.inventoryBefore||FOOD_IDS.some(id=>!finite(p.inventoryBefore[id],0,100))||!p.flagsBefore||typeof p.flagsBefore.frozen!=='boolean'||typeof p.flagsBefore.rewardEnabled!=='boolean'
    ||!vector(p.a)||!vector(p.b)||typeof p.weightsBefore!=='string'||!finite(p.integralA)||!finite(p.integralB)||!finite(p.integralPI,-20,20)))throw Error('正在进行的观察记录不完整');
}

/** Sole authority for both subjects. Commands change the mechanical fly or environment only. */
export class MirrorCoopSession{
  #sim;#coop;#input=noInput();#resolver=makeMechanicalRoomResolver();#xor=parseCircuit(DEFAULT_TAPEOUT);#pulse=parseCircuit(TAPEOUT_PULSE_SOURCE);#disposed=false;
  constructor({seed=8501,saved=null}={}){
    if(saved!==null){validateSaved(saved);this.#restore(saved);return;}
    if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw Error('合作实验种子无效');
    const sim=new EmbodiedLife(null,{seed,learningMode:'neutral'}),s=sim.state;
    const identitySeed=seed.toString(16).padStart(8,'0').repeat(4);
    s.companion=createCompanion({id:crypto.randomUUID(),seed:identitySeed,now:Date.now()});adoptCompanion(s.companion,'镜隙',Date.now());
    s.living.care=createCare();for(const id of FOOD_IDS)foodStock(s)[id]=0;syncFoodTotal(s);
    const scale=growthSummary(s.companion).bodyScale,ground=withFoodStock(s,()=>surfaceBelow(-3.6,1.5,1.5,1,scale));
    if(!ground)throw Error('合作场景缺少真实初始支撑');
    Object.assign(s.actor,{bodyScale:scale,position:[-3.6,ground.position[1]+.09*scale+.0001,1.5],heading:0,velocity:[0,0,0],contact:true,zoneId:'feed',mode:'activity',action:'observe'});
    const feet=withFoodStock(s,()=>supportedFeet(s.actor.position,s.actor.heading,scale));
    if(feet!==6||withFoodStock(s,()=>resourceContact(s.actor,'food')))throw Error('自主果蝇释放点必须有六足支撑且未接触食物');
    s.actor.supportFeet=feet;s.needs.satiety=25;s.living.physiology.thirst=.1;s.living.contactSeconds=4;s.living.focus.action='eat';s.living.clock={mode:'preview',hour:12,anchor:s.simSeconds};
    this.#sim=sim;this.#coop={seed,mechanical:createMechanicalFly({position:[...COOP_DOCK],seed}),campaign:createCampaignProgress(),level:newLevel(),circuit:createCoopClock(),probe:blankProbe(),notice:{text:'先领取一份补给，去认识你的新室友。',tone:'info',serial:1}};
    this.#sim.neural.learning.setCues([]);this.#sim.setSpeed(1);this.#sim.setPaused(false);
    Object.assign(this.#coop,{trial:null,trialHistory:[],trialCounts:{courier:0,signal:0},substepSeconds:0});
  }
  #restore(saved){
    const sim=new EmbodiedLife(copy(saved.body)),coop=copy(saved.coop);coop.level={...newLevel(),...coop.level};
    coop.campaign=restoreCampaignProgress(coop.campaign);
    if(coop.trial===undefined)coop.trial=null;
    if(coop.trialHistory===undefined)coop.trialHistory=[];
    if(coop.trialCounts===undefined)coop.trialCounts={courier:0,signal:0};
    if(coop.substepSeconds===undefined)coop.substepSeconds=0;
    coop.circuit=restoreCoopClock(coop.circuit);
    if(coop.campaign.stage===8)coop.level.pairedStart=coop.level.pairedStart?
      restoreCoopPairing(coop.level.pairedStart):createCoopPairing({simSeconds:sim.state.simSeconds,weights:sim.neural.learning.serializeWeights()});
    advanceMechanicalFly(coop.mechanical,{...noInput(),emit:coop.mechanical.emit},0);
    this.#resolver({position:coop.mechanical.position,desiredPosition:coop.mechanical.position,radius:.045,seconds:0});
    if(coop.probe.running){sim.neural.learning.frozen=true;sim.neural.learning.rewardEnabled=false;
      if(qText(sim)!==coop.probe.weightsBefore)throw Error('观察中的突触记录与存档不一致');}
    this.#sim=sim;this.#coop=coop;this.#input=noInput();this.#disposed=false;this.#setCues();
  }
  #notice(text,tone='info'){this.#coop.notice={text,tone,serial:this.#coop.notice.serial+1};}
  #stageIndex(){return this.#coop.trial?TRIALS[this.#coop.trial.kind].stage:this.#coop.campaign.stage;}
  #objects(){
    const campaign=this.#coop.campaign;
    const objects=coopWorldObjects(this.#stageIndex(),this.#coop.level);
    if(this.#coop.trial?.kind==='courier')objects.push(deliveryNode('fig'));
    return objects.filter(object=>!object.discovery||
      campaign.status==='playing'&&!campaign.discoveries.includes(object.id));
  }
  #interaction(){
    const m=this.#coop.mechanical;
    return this.#objects().filter(o=>o.active&&['supply','delivery','relay'].includes(o.kind)&&!(o.kind==='supply'&&m.cargo))
      .map(o=>({...o,distance:distance3(o.position,m.position)})).filter(o=>o.distance<=COOP_INTERACTION_RADIUS).sort((a,b)=>a.distance-b.distance)[0]??null;
  }
  #events(events,seconds=0,metrics={}){
    const c=this.#coop;
    if(!c.trial){c.campaign=advanceCampaign(c.campaign,{seconds,events});return;}
    const before=c.trial;c.trial=advanceCoopTrial(before,{seconds,events,...metrics});
    if(before.status==='playing'&&c.trial.status==='complete'){
      c.trialHistory=[...c.trialHistory,{...copy(c.trial),completedAtSimSeconds:this.#sim.state.simSeconds}].slice(-16);
      this.#notice('这一段的真实成绩已记下，室友仍在继续生活。','success');
    }
  }
  #startTrial(payload){
    const c=this.#coop,kind=payload?.kind;
    if(c.campaign.status!=='complete'||c.probe.running)throw Error('完成共同生活后再开启试炼');
    if(!payload||Object.keys(payload).length!==1||!Object.hasOwn(TRIALS,kind))throw Error('试炼类型无效');
    const attempt=c.trialCounts[kind]+1,trial=createCoopTrial(kind,{attempt});
    c.trialCounts[kind]=attempt;c.trial=trial;c.level={...newLevel(),nextCargo:c.level.nextCargo};
    c.circuit=createCoopClock();
    c.mechanical=createMechanicalFly({position:[...COOP_DOCK],seed:c.seed});this.#input=noInput();this.#setCues();
    this.#notice(TRIALS[kind].instruction);
  }
  #signal(){
    const requested=this.#coop.mechanical.emit,input=requested==='B'?1:0,phase=this.#coop.level.phaseBit;
    const output=stepCircuit(this.#xor,{state:new Uint8Array(),inputs:Uint8Array.of(input|(phase<<1))}).outputs[0]&1;
    const settlingSeconds=this.#coop.campaign.stage===9?Math.max(0,this.#coop.level.neutralReadyAt-this.#sim.state.simSeconds):0;
    const actual=requested==='off'||this.#coop.probe.running||this.#coop.mechanical.battery<=0||!this.#coop.circuit.pulseOutput||settlingSeconds>0?'off':output?'B':'A';
    return {input,phase,output,selected:requested,actual,settlingSeconds};
  }
  #setCues(){
    const p=this.#coop.probe,learning=this.#sim.neural.learning;
    if(p.running){learning.setCues([{id:'cue-coop-A',odor:'A',position:[...p.a],strength:1,range:1.2,enabled:true},{id:'cue-coop-B',odor:'B',position:[...p.b],strength:1,range:1.2,enabled:true}]);return;}
    const signal=this.#signal();learning.setCues(signal.actual==='off'?[]:[{id:'cue-mechanical',odor:signal.actual,position:[...this.#coop.mechanical.position],strength:1,range:1.2,enabled:true}]);
  }
  #interact(){
    if(this.#coop.probe.running)throw Error('先结束观察，再操作环境');
    const object=this.#interaction(),c=this.#coop;
    if(!object){
      if(c.mechanical.cargo){const dropped=dropMechanicalCargo(c.mechanical);c.mechanical=dropped.state;
        c.level.dropped.push({id:'dropped-'+dropped.cargo.id,position:[...c.mechanical.position],cargo:dropped.cargo});this.#notice('补给已放下，可以回到这里取回。');}
      else this.#notice('靠近亮起的补给、餐盘或节点，再按交互。');
      return;
    }
    if(object.kind==='supply'){
      const cargo=object.cargo??{id:'nutrient-'+c.level.nextCargo++,weight:.35};
      c.mechanical=pickupMechanicalCargo(c.mechanical,cargo);c.level.dropped=c.level.dropped.filter(item=>item.id!==object.id);this.#notice('带好了。把补给送到亮起的餐盘。');
    }else if(object.kind==='delivery'){
      if(!c.mechanical.cargo){this.#notice('先带来一份补给。');return;}
      const stage=this.#stageIndex(),portion=c.campaign.status==='complete'&&!c.trial?20:stage===8?4:stage===11?1:2;
      const cargo=c.mechanical.cargo,stock=foodStock(this.#sim.state),added=Math.min(portion,100-stock[object.foodId]);
      if(added<=1e-8){this.#notice('这个餐盘已经满了，补给先留在你这里。');return;}
      stock[object.foodId]+=added;syncFoodTotal(this.#sim.state);
      c.mechanical=dropMechanicalCargo(c.mechanical).state;
      this.#events([{type:'delivery',foodId:object.foodId,amount:added,cargoId:cargo.id}]);this.#notice('补给送到了。真正吃下去，才会产生学习信号。');
    }else if(object.kind==='relay'){
      if(object.id==='phase')c.level.phaseBit^=1;else c.level.relays[object.id]^=1;
      this.#events([{type:'relay',id:object.id}]);this.#setCues();this.#notice(object.id==='phase'?'电路输入相位已改变，看看输出气味。':'节点状态已改变。');
    }
  }
  #enterStage(){
    const c=this.#coop,stage=c.campaign.stage;c.level={...newLevel(),nextCargo:c.level.nextCargo};
    this.#input={...noInput(),emit:c.mechanical.emit};
    if(stage===6)c.mechanical={...c.mechanical,battery:35};
    if(stage===8)c.level.pairedStart=createCoopPairing({simSeconds:this.#sim.state.simSeconds,weights:this.#sim.neural.learning.serializeWeights()});
    if(stage===9){
      for(const id of FOOD_IDS)foodStock(this.#sim.state)[id]=0;syncFoodTotal(this.#sim.state);
      c.level.neutralReadyAt=this.#sim.state.simSeconds+3;
    }
    this.#notice(CAMPAIGN_STAGES[stage].instruction);
  }
  #startProbe(payload){
    if(this.#coop.campaign.stage!==10||this.#coop.campaign.status!=='playing')throw Error('先完成前面的共同生活，再开始独立观察');
    if(this.#coop.probe.running)throw Error('观察已经开始');
    if(payload!==undefined&&(!payload||Object.keys(payload).some(k=>k!=='swapped')||typeof payload.swapped!=='boolean'))throw Error('观察参数无效');
    const s=this.#sim.state,l=this.#sim.neural.learning,center=[...s.actor.position],swapped=payload?.swapped??false;
    const left=[center[0]-.65,center[1],center[2]],right=[center[0]+.65,center[1],center[2]];
    if(left[0]<-5.8||right[0]>5.8)throw Error('这里太靠近房间边缘，等它到开阔处再观察');
    if(withFoodStock(s,()=>segmentOccluded(center,left,s.actor)||segmentOccluded(center,right,s.actor)))throw Error('气味位置受到家具遮挡，等它到开阔处再观察');
    const p={...blankProbe(),running:true,swapped,a:swapped?right:left,b:swapped?left:right,
      inventoryBefore:copy(foodStock(s)),flagsBefore:{frozen:l.frozen,rewardEnabled:l.rewardEnabled},weightsBefore:qText(this.#sim),integralA:0,integralB:0,integralPI:0};
    for(const id of FOOD_IDS)foodStock(s)[id]=0;syncFoodTotal(s);l.frozen=true;l.rewardEnabled=false;
    this.#coop.probe=p;this.#setCues();this.#notice('食物已撤去。现在观察它自己的二十秒。');
  }
  #finishProbe(completed){
    const p=this.#coop.probe;if(!p.running)return;
    const l=this.#sim.neural.learning,s=this.#sim.state,weightsUnchanged=qText(this.#sim)===p.weightsBefore;
    Object.assign(foodStock(s),p.inventoryBefore);syncFoodTotal(s);l.frozen=p.flagsBefore.frozen;l.rewardEnabled=p.flagsBefore.rewardEnabled;p.running=false;
    p.result={completed,elapsed:p.elapsed,preferenceIndex:p.elapsed?p.integralPI/p.elapsed:0,meanDistanceA:p.elapsed?p.integralA/p.elapsed:null,meanDistanceB:p.elapsed?p.integralB/p.elapsed:null,weightsUnchanged,inventoryRestored:FOOD_IDS.every(id=>foodStock(s)[id]===p.inventoryBefore[id])};
    this.#setCues();this.#notice(completed?'观察已记录。无论偏向哪边，我们都保留真实结果。':'观察已结束，食物与学习开关已恢复。');
    if(completed)this.#events([{type:'probe',elapsed:p.elapsed,completed:true,frozen:true,rewardEnabled:false,weightsUnchanged,preferenceIndex:p.result.preferenceIndex}]);
  }
  command(action,payload){
    if(this.#disposed)throw Error('合作会话已结束');
    if(action==='input'){this.#input=validateInput(payload);return this.snapshot();}
    if(action==='pause'){if(typeof payload!=='boolean')throw Error('暂停参数无效');this.#sim.setPaused(payload);}
    else if(action==='interact')this.#interact();
    else if(action==='continue'){this.#coop.campaign=continueCampaign(this.#coop.campaign);this.#enterStage();}
    else if(action==='retry'){
      if(this.#coop.trial)this.#startTrial({kind:this.#coop.trial.kind});
      else {this.#finishProbe(false);this.#coop.campaign=retryCampaign(this.#coop.campaign);this.#coop.mechanical=createMechanicalFly({position:[...COOP_DOCK],seed:this.#coop.seed});this.#enterStage();}
    }
    else if(action==='trial')this.#startTrial(payload);
    else if(action==='endTrial'){
      if(payload!==undefined||!this.#coop.trial)throw Error('当前没有进行中的试炼');
      this.#coop.trial=null;this.#coop.level={...newLevel(),nextCargo:this.#coop.level.nextCargo};this.#input=noInput();
      this.#coop.mechanical={...this.#coop.mechanical,emit:'off'};this.#setCues();this.#notice('成绩保留，我们继续住在一起。');
    }
    else if(action==='probe')this.#startProbe(payload);
    else if(action==='endProbe')this.#finishProbe(false);
    else if(action==='newGame'){
      if(!payload||payload.confirm!==true||Object.keys(payload).length!==1)throw Error('新游戏会清空本次战役，请明确确认');
      const next=new MirrorCoopSession({seed:this.#coop.seed});this.#finishProbe(false);this.#sim=next.#sim;this.#coop=next.#coop;this.#input=noInput();
    }else if(action==='import'){
      if(!payload||Object.keys(payload).length!==1||!payload.checkpoint)throw Error('导入需要完整存档');
      const next=new MirrorCoopSession({saved:payload.checkpoint});this.#finishProbe(false);this.#sim=next.#sim;this.#coop=next.#coop;this.#input=noInput();
    }else if(action==='export')return this.serialize();
    else throw Error('未知的合作操作');
    return this.snapshot();
  }
  tick(seconds){
    if(!finite(seconds,0,.25))throw Error('合作时间增量无效');
    if(this.#disposed||this.#sim.state.paused||seconds===0)return;
    this.#coop.substepSeconds+=seconds;
    try{while(this.#coop.substepSeconds+Number.EPSILON>=STEP){this.#coop.substepSeconds=Math.max(0,this.#coop.substepSeconds-STEP);this.#step(STEP);}}
    catch(error){this.#finishProbe(false);this.#sim.setPaused(true);this.#notice('会话已暂停：'+error.message,'error');throw error;}
  }
  #step(dt){
    const c=this.#coop,m=c.mechanical,l=this.#sim.neural.learning,s=this.#sim.state,stage=this.#stageIndex();
    const objects=this.#objects(),charger=objects.find(o=>o.kind==='charge'&&distance3(o.position,m.position)<.22);
    c.mechanical=withFoodStock(s,()=>advanceMechanicalFly(m,this.#input,dt,{resolveMove:this.#resolver,charging:Boolean(charger)}));
    if(c.mechanical.recoveredThisStep)this.#notice(stage===6&&c.mechanical.battery===0?
      '机械果蝇已回收，补给保留。这一段可重试；轻装去充能台，少爬升会更省电。':'机械果蝇已回收，携带的补给保留。','info');
    c.circuit=advanceCoopClock(c.circuit,dt,this.#pulse);
    this.#setCues();const signal=this.#signal(),beforeFoods=copy(foodStock(s)),rewardBefore=l.rewardPulses,consumeBefore=l.consumedAmount;
    this.#sim.tick(dt);if(this.#sim.neural.error)throw Error(this.#sim.neural.error);
    const events=[],used=l.consumedAmount-consumeBefore;
    if(used>0){const foodId=FOOD_IDS.find(id=>foodStock(s)[id]<beforeFoods[id]);if(!foodId)throw Error('实际消费与食物库存不一致');
      events.push({type:stage===11?'reunion':'consumption',foodId,amount:used});}
    if(c.probe.running){
      const p=c.probe,a=distance3(s.actor.position,p.a),b=distance3(s.actor.position,p.b);p.elapsed=Math.min(PROBE_SECONDS,p.elapsed+dt);p.integralA+=a*dt;p.integralB+=b*dt;p.integralPI+=(b-a)/Math.max(1e-9,a+b)*dt;
      if(p.elapsed>=PROBE_SECONDS-1e-8){p.elapsed=PROBE_SECONDS;this.#finishProbe(true);}
    }
    if(stage===3&&signal.selected==='A'&&signal.actual!=='off')events.push({type:'decodedSignal',input:signal.input,phase:signal.phase,output:signal.output});
    if(stage===1&&c.campaign.status==='playing')for(const object of objects){
      if(object.discovery&&distance3(object.position,c.mechanical.position)<.25)events.push({type:'discovery',id:object.id});
    }
    if(stage===4){const nextId=CAMPAIGN_STAGES[stage].rule.ids[c.trial?.route.length??c.campaign.progress.route.length],o=objects.find(o=>o.id===nextId);if(o&&c.mechanical.cargo&&distance3(o.position,c.mechanical.position)<.24)events.push({type:'checkpoint',id:o.id,carrying:true});}
    if(stage===6){
      if(!charger)c.level.chargedAt=null;
      if(charger&&c.level.chargedAt!==charger.id&&c.mechanical.battery>m.battery){
        c.level.chargedAt=charger.id;c.level.visited=[...c.level.visited,charger.id].slice(-8);
        events.push({type:'charge',id:charger.id});
      }
      const arrival=objects.find(o=>o.id==='arrival');if(arrival&&distance3(arrival.position,c.mechanical.position)<.24)events.push({type:'energyArrival',battery:c.mechanical.battery,carrying:Boolean(c.mechanical.cargo)});
    }
    if(stage===7&&signal.actual!=='off')events.push({type:'signal',odor:signal.actual,seconds:dt,powered:true,output:c.circuit.pulseOutput});
    if(c.trial?.kind==='signal'&&signal.selected==='A'&&signal.actual!=='off')events.push({type:'signal',odor:signal.actual,seconds:dt,powered:true,output:c.circuit.pulseOutput});
    if(stage===8&&c.campaign.status==='playing'){
      const paired=advanceCoopPairing(c.level.pairedStart,{simSeconds:s.simSeconds,seconds:dt,consumedDelta:used,
        rewardPulseDelta:l.rewardPulses-rewardBefore,rewardWindowRemainingMs:Math.max(0,l.rewardUntilMs-l.clockMs),
        actualOdor:signal.actual,cueSamples:l.cueSamples(s),weights:l.serializeWeights(),frozen:l.frozen,rewardEnabled:l.rewardEnabled});
      c.level.pairedStart=paired.state;if(paired.receipt)events.push(paired.receipt);
    }
    if(stage===9&&signal.actual==='B')events.push({type:'neutralObservation',odor:'B',seconds:dt,rewardPulses:l.rewardPulses-rewardBefore});
    this.#events(events,dt,{energySpent:Math.max(0,m.battery-c.mechanical.battery),collision:c.mechanical.blocked});
  }
  snapshot(){
    const room=this.#sim.snapshot(),c=this.#coop,signal=this.#signal(),campaign=copy(c.campaign),authoredStage=CAMPAIGN_STAGES[this.#stageIndex()];
    const stage=c.trial?{...authoredStage,id:c.trial.id,title:TRIALS[c.trial.kind].title,instruction:TRIALS[c.trial.kind].instruction}:authoredStage;
    const chapter=c.trial?{id:'free-trial',title:'自由试炼',subtitle:'室友继续生活，这一段另记成绩。'}:CAMPAIGN_CHAPTERS[stage.chapter];
    return {...room,neural:this.#sim.neural.snapshot(),coop:{version:'8.5.0',seed:c.seed,phase:this.#disposed?'disposed':c.probe.running?'probe':c.trial?'trial':campaign.status==='complete'?'complete':'campaign',paused:this.#sim.state.paused,
      mechanical:copy(c.mechanical),campaign,trial:copy(c.trial),trialHistory:copy(c.trialHistory),stage,chapter,objects:this.#objects(),interaction:this.#interaction(),
      pairing:c.level.pairedStart?{pairedPulses:c.level.pairedStart.pairedPulses,pairedConsumption:c.level.pairedStart.pairedConsumption,
        changedSynapses:c.level.pairedStart.changedSynapses,elapsed:c.level.pairedStart.elapsed,ready:Boolean(c.level.pairedStart.receipt),counts:copy(c.level.pairedStart.counts)}:null,
      diagnostics:{learning:{cueSamples:this.#sim.neural.learning.cueSamples(this.#sim.state),rewardWindowRemainingMs:Math.max(0,this.#sim.neural.learning.rewardUntilMs-this.#sim.neural.learning.clockMs)}},
      circuit:{chainId:196,cpu:DEFAULT_TAPEOUT.cpu,xorId:'1',pulseId:'4',mode:'frozen-chain-netlist',...copy(c.circuit),...signal,inputBits:[signal.input,signal.phase]},
      probe:{duration:PROBE_SECONDS,elapsed:c.probe.elapsed,running:c.probe.running,swapped:c.probe.swapped,result:copy(c.probe.result)},notice:copy(c.notice)}};
  }
  serialize(){if(this.#disposed)throw Error('会话已结束，不能覆盖有效存档');return {format:1,productVersion:'8.5.0',body:this.#sim.serialize(),coop:copy(this.#coop)};}
  dispose(){if(!this.#disposed){this.#finishProbe(false);this.#sim.setPaused(true);this.#input=noInput();this.#disposed=true;}return this.snapshot();}
}
