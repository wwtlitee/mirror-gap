const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const CAMPAIGN_CHAPTERS=freeze([
  {id:'first-meal',title:'初次共餐',subtitle:'你送来食物，它决定何时靠近。'},
  {id:'make-contact',title:'接通彼此',subtitle:'学会读懂机器发出的信号。'},
  {id:'another-way',title:'另一条路',subtitle:'一份补给，也可以有不同的去处。'},
  {id:'limited-light',title:'有限的光',subtitle:'给每一次飞行和等待留一点电。'},
  {id:'name-of-scent',title:'气味的名字',subtitle:'让一次真实经历，留下内部的改变。'},
  {id:'meet-again',title:'暂别与重逢',subtitle:'你可以停止提示，看看它自己的选择。'},
]);
export const CAMPAIGN_STAGES=freeze([
  {id:'first-delivery',chapter:0,title:'带一份见面礼',instruction:'取下补给，将它送到无花果的餐盘。',rule:{kind:'delivery',foodId:'fig'}},
  {id:'first-bite',chapter:0,title:'给它一点时间',instruction:'食物已经备好。它会自己靠近进食；你也可以趁这会儿认识工作台、水源和窗外。',rule:{kind:'consumption',minimum:.005}},
  {id:'relay-order',chapter:1,title:'让回声接通',instruction:'先接通西侧节点，再接通东侧节点。顺序错了可以再来。',rule:{kind:'relay_sequence',ids:['west','east']}},
  {id:'phase-switch',chapter:1,title:'同一个按钮，两种信号',instruction:'保持选择A，观察继电节点怎样把输出从A切换到B。',rule:{kind:'decoded_pair'}},
  {id:'cargo-route',chapter:2,title:'绕过那只杯子',instruction:'带着补给，依次穿过杯边、书架和餐台的标记。',rule:{kind:'cargo_route',ids:['cup','shelf','table']}},
  {id:'two-plates',chapter:2,title:'留出另一种选择',instruction:'取两份不同补给，分别投递到披萨与汉堡餐盘。',rule:{kind:'distribution',foodIds:['pizza','burger']}},
  {id:'energy-route',chapter:3,title:'途中需要歇一会儿',instruction:'依次在书架与餐台充能，再带着补给抵达终点。',rule:{kind:'energy_route',ids:['shelf','table'],minimumBattery:10}},
  {id:'hold-the-light',chapter:3,title:'留一盏灯',instruction:'让电路的有效气味脉冲累计保持两秒，同时留意电量。',rule:{kind:'signal_hold',seconds:2}},
  {id:'paired-scent',chapter:4,title:'给气味一点意义',instruction:'靠近室友发出A，让两次真实进食与气味配对，再给它至少十二秒自然学习。',rule:{kind:'paired_learning',odor:'A',minimumTeachingEvents:2,minimumSeconds:12}},
  {id:'unpaired-scent',chapter:4,title:'也闻闻另一种气味',instruction:'在没有新的食物奖励时呈现B，留下未配对的观察记录。',rule:{kind:'neutral_observation',odor:'B',seconds:2}},
  {id:'independent-choice',chapter:5,title:'这一次，你先停下来',instruction:'撤去食物，冻结学习，完整观察二十秒。它没有偏向也是一个真实结果。',rule:{kind:'probe',seconds:20}},
  {id:'reunion',chapter:5,title:'我们继续住在一起',instruction:'恢复补给，等待一次新的真实进食，为这段共同生活留个结尾。',rule:{kind:'reunion',minimum:.005}},
]);

const FOOD_IDS=new Set(['apple','banana','burger','pizza','fries','sandwich','fig']);
const DISCOVERY_IDS=new Set(['work','water','window']);
const EVENT_TYPES=new Set(['delivery','consumption','relay','decodedSignal','checkpoint','charge','energyArrival','signal','pairedLearning','neutralObservation','probe','reunion','discovery']);
const finite=(n,min=0,max=Infinity)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const text=value=>typeof value==='string'&&value.length>0&&value.length<=64;
const bit=value=>value===0||value===1;
const blankProgress=()=>({deliveredFoods:[],cargoIds:[],consumed:0,relaySequence:[],decodedPhases:[],route:[],charges:[],energyArrival:null,signalSeconds:0,learning:null,neutralSeconds:0,probe:null,reunionAmount:0});
export function validateCampaignEvent(e,seconds){
  if(!e||typeof e!=='object'||Array.isArray(e)||!EVENT_TYPES.has(e.type))throw Error('未知的战役事件');
  const positive=value=>finite(value,Number.MIN_VALUE,100);
  if(['delivery','consumption','reunion'].includes(e.type)&&(!FOOD_IDS.has(e.foodId)||!positive(e.amount)))throw Error('事件需要真实有效的食物与消耗量');
  if(e.type==='delivery'&&!text(e.cargoId))throw Error('补给必须有独立货物身份');
  if(e.type==='discovery'&&!DISCOVERY_IDS.has(e.id))throw Error('探索地点无效');
  if(['relay','checkpoint','charge'].includes(e.type)&&!text(e.id))throw Error('机关事件身份无效');
  if(e.type==='checkpoint'&&typeof e.carrying!=='boolean')throw Error('检查点需要携带状态');
  if(e.type==='energyArrival'&&(!finite(e.battery,0,100)||typeof e.carrying!=='boolean'))throw Error('抵达电量或携带状态无效');
  if(e.type==='decodedSignal'&&(!bit(e.input)||!bit(e.phase)||!bit(e.output)||(e.input^e.phase)!==e.output))throw Error('信号必须来自可核对的异或输入和输出');
  if(['signal','neutralObservation'].includes(e.type)&&(!['A','B'].includes(e.odor)||!finite(e.seconds,Number.MIN_VALUE,seconds)))throw Error('气味观察时间或身份无效');
  if(e.type==='signal'&&(typeof e.powered!=='boolean'||!bit(e.output)))throw Error('信号输出或供电状态无效');
  if(e.type==='neutralObservation'&&(!Number.isSafeInteger(e.rewardPulses)||e.rewardPulses<0))throw Error('无奖励观察计数无效');
  if(e.type==='pairedLearning'&&(!['A','B'].includes(e.odor)||!positive(e.consumedAmount)||!Number.isSafeInteger(e.teachingEvents)||e.teachingEvents<1||!Number.isSafeInteger(e.changedSynapses)||e.changedSynapses<1||e.changedSynapses>946||!finite(e.elapsed)))throw Error('关联事件需要实际摄食、教学、时间和突触改变');
  if(e.type==='probe'&&(!finite(e.elapsed,0,20.001)||!finite(e.preferenceIndex,-1,1)||['completed','frozen','rewardEnabled','weightsUnchanged'].some(k=>typeof e[k]!=='boolean')))throw Error('探测事件无效');
}

export function createCampaignProgress(){
  return {format:1,productVersion:'8.5.0',stage:0,status:'playing',elapsed:0,stageSeconds:0,attempt:1,completed:[],
    progress:blankProgress(),stats:{deliveries:0,consumedAmount:0,mistakes:0,retries:0,discoveries:0},discoveries:[],recent:[],observations:[],scientificLearningSuccess:null};
}

function validateProgress(s){
  if(!s||typeof s!=='object'||s.format!==1||s.productVersion!=='8.5.0'||!Number.isSafeInteger(s.stage)||s.stage<0||s.stage>=12
    ||!['playing','cleared','complete'].includes(s.status)||!finite(s.elapsed)||!finite(s.stageSeconds)||s.stageSeconds>s.elapsed+1e-6
    ||!Number.isSafeInteger(s.attempt)||s.attempt<1||!Array.isArray(s.completed)||s.completed.length>12
    ||s.completed.some((n,i)=>n!==i)||s.scientificLearningSuccess!==null||!s.progress||!s.stats
    ||Object.values(s.stats).some(n=>!finite(n))||!Array.isArray(s.discoveries)||s.discoveries.length>3
    ||s.discoveries.some(id=>!DISCOVERY_IDS.has(id))||new Set(s.discoveries).size!==s.discoveries.length
    ||s.stats.discoveries!==s.discoveries.length||!Array.isArray(s.recent)||s.recent.length>24||!Array.isArray(s.observations)||s.observations.length>8)throw Error('战役存档无效，原记录保留');
  const expected=s.status==='playing'?s.stage:s.stage+1;
  if(s.completed.length!==expected||s.status==='complete'&&s.stage!==11)throw Error('章节完成记录不连续');
  const p=s.progress;
  for(const key of ['deliveries','mistakes','retries','discoveries'])if(!Number.isSafeInteger(s.stats[key])||s.stats[key]<0)throw Error('战役计数无效');
  if(!finite(s.stats.consumedAmount))throw Error('实际摄食累计无效');
  for(const key of ['deliveredFoods','cargoIds','relaySequence','decodedPhases','route','charges'])if(!Array.isArray(p[key])||p[key].length>64)throw Error('章节进度无效');
  for(const key of ['consumed','signalSeconds','neutralSeconds','reunionAmount'])if(!finite(p[key]))throw Error('章节计时或实际事件无效');
  if(p.deliveredFoods.some(id=>!FOOD_IDS.has(id))||p.cargoIds.some(id=>!text(id))||new Set(p.cargoIds).size!==p.cargoIds.length
    ||p.deliveredFoods.length!==p.cargoIds.length||p.decodedPhases.some(n=>!bit(n))||new Set(p.decodedPhases).size!==p.decodedPhases.length)throw Error('章节事件身份无效');
  const sequences={relaySequence:['west','east'],route:['cup','shelf','table'],charges:['shelf','table']};
  for(const [key,expected] of Object.entries(sequences))if(p[key].length>expected.length||p[key].some((id,i)=>id!==expected[i]))throw Error('机关顺序记录无效');
  if(p.learning!==null)validateCampaignEvent(p.learning,0);
  if(p.learning!==null&&p.learning?.type!=='pairedLearning')throw Error('关联学习记录无效');
  if(p.probe!==null){if(p.probe?.type!=='probe')throw Error('独立观察记录无效');validateCampaignEvent(p.probe,0);}
  if(p.energyArrival!==null)validateCampaignEvent({type:'energyArrival',...p.energyArrival},0);
  if(s.status!=='playing'&&!achieved(p,CAMPAIGN_STAGES[s.stage].rule))throw Error('章节完成标记缺少实际事件');
  for(const observation of s.observations){
    if(observation?.type!=='probe')throw Error('观察记录类型无效');
    validateCampaignEvent(observation,.25);
  }
}

function appendSequence(array,id,expected){
  if(id===expected[array.length]){array.push(id);return true;}
  array.length=0;if(id===expected[0])array.push(id);return false;
}
function receive(s,e,rule){
  const p=s.progress;
  if(e.type==='discovery'&&s.stage===1&&!s.discoveries.includes(e.id)){s.discoveries.push(e.id);s.stats.discoveries++;}
  if(e.type==='delivery'){
    if(p.cargoIds.includes(e.cargoId))return;
    p.cargoIds.push(e.cargoId);p.deliveredFoods.push(e.foodId);s.stats.deliveries++;
  }
  if(e.type==='consumption'){p.consumed+=e.amount;s.stats.consumedAmount+=e.amount;}
  if(e.type==='relay'&&rule.kind==='relay_sequence'&&!appendSequence(p.relaySequence,e.id,rule.ids))s.stats.mistakes++;
  if(e.type==='decodedSignal'&&rule.kind==='decoded_pair'&&e.input===0&&!p.decodedPhases.includes(e.phase))p.decodedPhases.push(e.phase);
  if(e.type==='checkpoint'&&rule.kind==='cargo_route'&&e.carrying&&!appendSequence(p.route,e.id,rule.ids))s.stats.mistakes++;
  if(e.type==='charge'&&rule.kind==='energy_route'&&!appendSequence(p.charges,e.id,rule.ids))s.stats.mistakes++;
  if(e.type==='energyArrival')p.energyArrival={battery:e.battery,carrying:e.carrying};
  if(e.type==='signal'&&rule.kind==='signal_hold'&&e.powered&&e.output===1)p.signalSeconds+=e.seconds;
  if(e.type==='pairedLearning'&&rule.kind==='paired_learning'&&e.odor===rule.odor)p.learning={...e};
  if(e.type==='neutralObservation'&&rule.kind==='neutral_observation'&&e.odor===rule.odor&&e.rewardPulses===0)p.neutralSeconds+=e.seconds;
  if(e.type==='probe'&&rule.kind==='probe')p.probe={...e};
  if(e.type==='reunion'&&rule.kind==='reunion'){p.reunionAmount+=e.amount;s.stats.consumedAmount+=e.amount;}
}
function achieved(p,rule){
  switch(rule.kind){
    case 'delivery':return p.deliveredFoods.includes(rule.foodId);
    case 'consumption':return p.consumed>=rule.minimum;
    case 'relay_sequence':return p.relaySequence.length===rule.ids.length;
    case 'decoded_pair':return p.decodedPhases.length===2;
    case 'cargo_route':return p.route.length===rule.ids.length;
    case 'distribution':return rule.foodIds.every(id=>p.deliveredFoods.includes(id));
    case 'energy_route':return p.charges.length===rule.ids.length&&p.energyArrival?.carrying&&p.energyArrival.battery>=rule.minimumBattery;
    case 'signal_hold':return p.signalSeconds>=rule.seconds;
    case 'paired_learning':return p.learning!==null&&p.learning.teachingEvents>=rule.minimumTeachingEvents&&p.learning.elapsed>=rule.minimumSeconds;
    case 'neutral_observation':return p.neutralSeconds>=rule.seconds;
    case 'probe':return p.probe?.completed&&p.probe.elapsed>=rule.seconds-1e-6&&p.probe.frozen&&!p.probe.rewardEnabled&&p.probe.weightsUnchanged;
    case 'reunion':return p.reunionAmount>=rule.minimum;
    default:throw Error('未实现的章节目标');
  }
}

/** Worker-only facts enter here. UI input must never call this event API directly. */
export function advanceCampaign(saved,{seconds=0,events=[]}={}){
  validateProgress(saved);
  if(!finite(seconds,0,.25)||!Array.isArray(events)||events.length>64)throw Error('战役时间或事件批次无效');
  events.forEach(e=>validateCampaignEvent(e,seconds));
  const s=structuredClone(saved);
  if(s.status!=='playing')return s;
  s.elapsed+=seconds;s.stageSeconds+=seconds;const rule=CAMPAIGN_STAGES[s.stage].rule;
  for(const event of events){receive(s,event,rule);s.recent.push({type:event.type,time:s.elapsed});}
  s.recent=s.recent.slice(-24);
  if(achieved(s.progress,rule)){
    if(rule.kind==='probe')s.observations.push(structuredClone(s.progress.probe));
    s.completed.push(s.stage);s.status='cleared';
  }
  return s;
}

export function continueCampaign(saved){
  validateProgress(saved);if(saved.status!=='cleared')throw Error('先完成当前任务');
  const s=structuredClone(saved);
  if(s.stage===11){s.status='complete';return s;}
  s.stage++;s.status='playing';s.stageSeconds=0;s.attempt=1;s.progress=blankProgress();s.recent=[];return s;
}
export function retryCampaign(saved){
  validateProgress(saved);if(saved.status!=='playing')throw Error('当前章节无需重试');
  const s=structuredClone(saved);s.attempt++;s.stats.retries++;s.stageSeconds=0;s.progress=blankProgress();s.recent=[];return s;
}
export function restoreCampaignProgress(saved){
  const restored=structuredClone(saved);
  if(restored&&restored.discoveries===undefined)restored.discoveries=[];
  if(restored?.stats&&restored.stats.discoveries===undefined)restored.stats.discoveries=restored.discoveries.length;
  validateProgress(restored);return restored;
}
