import {bodyMetrics} from './body-metrics.mjs';
import {careObservationText} from './companion-evidence.mjs';

const LABELS={satiety:['食物','Food'],thirst:['水','Water'],sleepPressure:['睡眠','Sleep'],waste:['排泄','Toilet'],curiosity:['娱乐','Fun']};
const ACTIONS={
 satiety:['replace-food','补充食物','Add food'],
 thirst:['replace-water','补充清水','Add water'],sleepPressure:['bedding','整理床铺','Make bed'],waste:['clean','清理环境','Clean room'],curiosity:['enrich','陪它玩','Prepare play']
};
export function setupPetCareUi(command,isBusy=()=>false){
 const buttons=[],summary=document.querySelector('#care-summary');
 const result=document.createElement('p');result.id='care-result';result.dataset.noLocale='';result.setAttribute('role','status');result.setAttribute('aria-live','polite');result.hidden=true;document.querySelector('#needs').append(result);
 for(const [key,[action]]of Object.entries(ACTIONS)){
  const row=document.querySelector(`#need-${key}`).closest('.need'),button=document.createElement('button');
  row.querySelector('label').dataset.noLocale='';
  button.className='need-action';button.dataset.care=action;button.dataset.careNeed=key;button.dataset.noLocale='';button.type='button';
  const label=document.createElement('span'),value=document.createElement('small');button.append(label,value);
  button.addEventListener('click',()=>{button.disabled=true;void command('care',action);});row.append(button);buttons.push(button);
 }
 // Keep DOM and keyboard order aligned: care actions first, observation only after.
 for(const key of Object.keys(ACTIONS).reverse()){const row=document.querySelector(`#need-${key}`).closest('.need');row.parentElement.prepend(row);}
 for(const row of document.querySelectorAll('#care-needs .need'))if(!row.querySelector('.need-action'))document.querySelector('#body-needs').append(row);
 return {update(state){
  const en=document.documentElement.lang==='en',m=state.living?.care?.maintenance;
  const seconds=Number.isFinite(state.simSeconds)?Math.max(0,state.simSeconds):null;
  const day=Number.isSafeInteger(state.clock?.day)&&state.clock.day>0?state.clock.day:seconds===null?'—':Math.floor((seconds/60+9)/24)+1;
  const length=state.actor?`${(bodyMetrics(state.actor).length*100).toFixed(2)} cm`:'—';
  const summaryText=en?`Day ${day} · Size ${length}`:`第 ${day} 天 · 体型 ${length}`;
  if(summary&&summary.textContent!==summaryText)summary.textContent=summaryText;
  const observations=state.careObservations,pending=observations?.pending?.at(-1),latest=observations?.results?.at(-1);
  const observation=pending??latest;
  result.hidden=!observation;
  if(observation){const copy=careObservationText(observation,en);if(result.textContent!==copy)result.textContent=copy;result.dataset.status=observation.status??'pending';}
  for(const button of buttons){const key=button.dataset.careNeed,[action,zh,label]=ACTIONS[key];
   const row=button.closest('.need'),name=LABELS[key][en?1:0],heading=row.querySelector('label');
   if(heading.textContent!==name)heading.textContent=name;
   const description=`${name}：${row.title}`;if(row.getAttribute('aria-label')!==description)row.setAttribute('aria-label',description);
   const copy=en?label:zh;
   const percent=n=>Number.isFinite(n)?`${Math.round(Math.max(0,Math.min(100,n)))}%`:'—';
   const remaining=Math.max(0,Math.ceil((m?.enrichUntil??0)-state.simSeconds));
   const value=key==='satiety'||key==='thirst'?`${en?'Left':'剩余'} ${percent(key==='satiety'?state.home.food:state.home.water)}`:
     key==='sleepPressure'||key==='waste'?`${en?'Clean':'洁净'} ${percent((key==='sleepPressure'?(m?.bedding??1):(m?.cleanliness??1))*100)}`:
     remaining>0?`${en?'Play':'活动'} ${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`:(en?'Ready':'可陪玩');
   if(button.firstChild.textContent!==copy)button.firstChild.textContent=copy;
   if(button.lastChild.textContent!==value)button.lastChild.textContent=value;
   button.hidden=!state.companion;button.disabled=!state.companion?.identity.adoptedAt||state.paused||isBusy()||(m?.nextAction??0)>state.simSeconds;
   const details=key==='satiety'?`剩余食物 ${Math.round(state.home.food)}% · 新鲜度 ${Math.round((m?.foodFresh??1)*100)}%`:key==='thirst'?`剩余清水 ${Math.round(state.home.water)}%`:key==='sleepPressure'?`垫料洁净 ${Math.round((m?.bedding??1)*100)}%`:key==='comfort'||key==='waste'?`环境洁净 ${Math.round((m?.cleanliness??1)*100)}%`:key==='dirt'||key==='wetness'?'落稳且未进食或睡眠时，逐渐进行护理':'';
   button.title=en?`${copy} · ${value}`:details;button.setAttribute('aria-label',`${copy} · ${value}`);
  }
 }};
}
