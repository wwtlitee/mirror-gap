// Durable development is separated from recent impressions and ordinary logs.
// Only observed outcomes with enough duration and spacing can form a habit.
export const DEVELOPMENT_LABELS = Object.freeze({
  food:{apple:'苹果',banana:'香蕉',burger:'汉堡',pizza:'披萨',fries:'薯条',sandwich:'三明治',fig:'无花果'},
  place:{rest:'栖息舱',feed:'补给台',work:'工作台',garden:'窗边',flight:'开阔空间',entry:'浅水池',perch:'树冠',nook:'书架暗角',toilet:'迷你厕所'},
  game:{racer:'像素公路',breakout:'砖块弹球',invaders:'星际巡航'},
  interaction:{feed:'添食物',water:'添水',mist:'喷雾',chime:'风铃',talk:'交谈',bedding:'整理床铺',clean:'打扫厕所',brush:'梳理',dry:'擦干',enrich:'准备游戏',quiet:'安静休息'},
  sound:Object.fromEntries(['rain','wind','footstep','chime'].flatMap(kind=>['rest','active'].map(context=>[`${kind}:${context}`,`${context==='rest'?'休息时':'活动时'}的${{rain:'雨声',wind:'风声',footstep:'脚步声',chime:'风铃'}[kind]}`]))),
});
export const DEVELOPMENT_SPACING = 120;
export const DEVELOPMENT_SPAN = 240;
export const MAX_MILESTONES = 96;
const clamp=(v,min=0,max=1)=>Math.max(min,Math.min(max,v));
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
const number=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const count=v=>Number.isSafeInteger(v)&&v>=0&&v<=1e9;
const text=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
export function createDevelopment(){
  return {format:1,habits:Object.fromEntries(Object.keys(DEVELOPMENT_LABELS).map(kind=>[kind,{}])),milestones:[],
    relationship:{familiarity:0,encounters:0,lastAt:null},
    toy:{gameId:'racer',practiceSeconds:0,sessions:0,skill:0,lastAt:null},
    cues:{chime:{association:0,paired:0,unpaired:0,lastAt:null}}};
}
export function ensureDevelopment(companion){return companion.development??=createDevelopment();}
export function validateDevelopment(d,activeSeconds){
  const time=v=>v===null||number(v,0,activeSeconds);
  if(!record(d)||d.format!==1||!record(d.habits)||Object.keys(d.habits).length!==Object.keys(DEVELOPMENT_LABELS).length)throw Error('成长经历存档无效。');
  for(const [kind,labels] of Object.entries(DEVELOPMENT_LABELS)){
    const values=d.habits[kind];
    if(!record(values)||Object.entries(values).some(([key,v])=>!Object.hasOwn(labels,key)||!record(v)||!number(v.score,-1,1)||!count(v.count)||v.count<1||!number(v.firstAt,0,activeSeconds)||!number(v.lastAt,v.firstAt,activeSeconds)||v.count>1+Math.floor((v.lastAt-v.firstAt+1e-6)/DEVELOPMENT_SPACING)))throw Error('稳定习惯存档无效。');
  }
  if(!Array.isArray(d.milestones)||d.milestones.length>MAX_MILESTONES||new Set(d.milestones.map(m=>m?.id)).size!==d.milestones.length||d.milestones.some(m=>!record(m)||!text(m.id,96)||!['first','habit','relationship','toy','cue','growth'].includes(m.kind)||!text(m.target,80)||!text(m.text,240)||!number(m.at,0,activeSeconds)))throw Error('重要经历存档无效。');
  const r=d.relationship,t=d.toy,c=d.cues?.chime;
  if(!record(r)||!number(r.familiarity,0,1)||!count(r.encounters)||!time(r.lastAt)||(r.encounters===0)!==(r.lastAt===null))throw Error('相处经历存档无效。');
  if(!record(t)||t.gameId!=='racer'||!number(t.practiceSeconds,0,activeSeconds)||!count(t.sessions)||!number(t.skill,0,1)||!time(t.lastAt)||(t.sessions===0)!==(t.lastAt===null)||t.skill>Math.min(1,t.practiceSeconds/480,t.sessions/6)+1e-6)throw Error('玩具成长存档无效。');
  if(!record(d.cues)||Object.keys(d.cues).length!==1||!record(c)||!number(c.association,-1,1)||!count(c.paired)||!count(c.unpaired)||!time(c.lastAt)||((c.paired+c.unpaired)===0)!==(c.lastAt===null))throw Error('声音关联存档无效。');
  return d;
}
export function addMilestone(companion,{id,kind,target,text:description}){
  const d=ensureDevelopment(companion);
  if(d.milestones.some(event=>event.id===id))return false;
  d.milestones.push({id,kind,target,at:companion.activeSeconds,text:String(description).slice(0,240)});
  if(d.milestones.length>MAX_MILESTONES)d.milestones.splice(0,d.milestones.length-MAX_MILESTONES);
  return true;
}
export function habitEstablished(entry){return Boolean(entry&&entry.count>=3&&entry.lastAt-entry.firstAt>=DEVELOPMENT_SPAN&&Math.abs(entry.score)>=.18);}
export function stablePreference(companion,kind,target){
  const value=companion?.development?.habits?.[kind]?.[target];
  return habitEstablished(value)?value.score:0;
}
export function recordHabit(companion,kind,target,reward,{duration=0}={}){
  if(!Object.hasOwn(DEVELOPMENT_LABELS[kind]??{},target)||!Number.isFinite(reward)||duration<(kind==='food'?3:12))return false;
  const values=ensureDevelopment(companion).habits[kind],previous=values[target],at=companion.activeSeconds;
  if(previous&&at-previous.lastAt<DEVELOPMENT_SPACING)return false;
  const oldEstablished=habitEstablished(previous),oldSign=Math.sign(previous?.score??0);
  const entry=values[target]={score:clamp(previous?previous.score+.14*(reward-previous.score):reward*.22,-1,1),count:Math.min(1e9,(previous?.count??0)+1),firstAt:previous?.firstAt??at,lastAt:at};
  const label=DEVELOPMENT_LABELS[kind][target];
  if(['food','game'].includes(kind))addMilestone(companion,{id:`first-${kind}-${target}`,kind:'first',target,text:kind==='food'?`第一次实际吃到了${label}，开始积累自己的口味。`:`第一次实际玩了${label}，留下了游戏经历。`});
  if(habitEstablished(entry)&&(!oldEstablished||oldSign!==Math.sign(entry.score))){
    const positive=entry.score>0;
    addMilestone(companion,{id:`habit-${kind}-${target}-${positive?'positive':'negative'}`,kind:'habit',target:`${kind}:${target}`,text:`经过 ${entry.count} 次分散的有效经历，${positive?'逐渐熟悉并偏向':'开始谨慎对待'}${label}。`});
  }
  return true;
}
export function recordRelationship(companion,reward){
  const r=ensureDevelopment(companion).relationship;
  if(!Number.isFinite(reward)||Math.abs(reward)<.05||(r.lastAt!==null&&companion.activeSeconds-r.lastAt<DEVELOPMENT_SPACING))return false;
  const before=r.familiarity;
  r.familiarity=clamp(before+(reward>0?.11*(1-before):.035)*clamp(reward,-1,1));
  r.encounters=Math.min(1e9,r.encounters+1);r.lastAt=companion.activeSeconds;
  for(const [threshold,id,label] of [[.25,'familiar','渐渐熟悉'],[.6,'trusted','安心相处']])if(before<threshold&&r.familiarity>=threshold)addMilestone(companion,{id:`relationship-${id}`,kind:'relationship',target:'keeper',text:`多次照顾之后获得了真实的恢复，对熟悉的照顾提示开始${label}。`});
  return true;
}
export function recordCueOutcome(companion,paired,reward=0){
  const cue=ensureDevelopment(companion).cues.chime;
  if(cue.lastAt!==null&&companion.activeSeconds-cue.lastAt<DEVELOPMENT_SPACING)return false;
  const target=paired?clamp(reward):-.15;
  cue.association=clamp(cue.association+.14*(target-cue.association),-1,1);
  cue[paired?'paired':'unpaired']=Math.min(1e9,cue[paired?'paired':'unpaired']+1);cue.lastAt=companion.activeSeconds;
  if(cue.paired>=3&&cue.association>.25)addMilestone(companion,{id:'cue-chime-paired',kind:'cue',target:'chime',text:'几次风铃之后都发生了舒适的实际体验，开始记住这段联系。'});
  return true;
}
export function practiceToy(companion,seconds,{newSession=false}={}){
  if(!(Number.isFinite(seconds)&&seconds>0))return;
  const t=ensureDevelopment(companion).toy,previous=t.skill;
  if(newSession&&(t.lastAt===null||companion.activeSeconds-t.lastAt>=DEVELOPMENT_SPACING)){t.sessions=Math.min(1e9,t.sessions+1);t.lastAt=companion.activeSeconds;}
  if(!t.sessions)return;
  t.practiceSeconds=Math.min(companion.activeSeconds,t.practiceSeconds+seconds);
  t.skill=clamp(Math.min(t.practiceSeconds/480,t.sessions/6));
  for(const [threshold,id,label] of [[.25,'exploring','开始熟悉像素公路的操作'],[.7,'practiced','经过多次游玩，更熟练地应对像素公路']])if(previous<threshold&&t.skill>=threshold)addMilestone(companion,{id:`toy-racer-${id}`,kind:'toy',target:'racer',text:`${label}。`});
}
export function developmentSummary(companion){
  const d=ensureDevelopment(companion),r=d.relationship,t=d.toy;
  const habits=Object.entries(d.habits).flatMap(([kind,values])=>Object.entries(values).filter(([,value])=>value.count>=1).map(([target,value])=>({kind,target,label:DEVELOPMENT_LABELS[kind][target],...value,confidence:clamp(Math.min(value.count/6,(value.lastAt-value.firstAt)/600)),established:habitEstablished(value)}))).sort((a,b)=>Number(b.established)-Number(a.established)||Math.abs(b.score)-Math.abs(a.score));
  const relationshipStage=r.familiarity>=.6?'trusted':r.familiarity>=.25?'familiar':'new',toyStage=t.skill>=.7?'practiced':t.skill>=.25?'exploring':'new';
  return {habits,relationship:{...r,stage:relationshipStage,label:{new:'刚开始相处',familiar:'渐渐熟悉',trusted:'安心相处'}[relationshipStage]},toy:{...t,stage:toyStage,label:{new:'初次试探',exploring:'渐渐玩熟',practiced:'熟练玩家'}[toyStage]},milestones:structuredClone(d.milestones),cue:{...d.cues.chime}};
}
