import {DEVELOPMENT_SPACING,DEVELOPMENT_SPAN} from './companion-development.mjs';

export function habitEvidence(habit,activeSeconds=0){
  const count=Math.max(0,habit.count??0),span=Math.max(0,(habit.lastAt??0)-(habit.firstAt??0));
  const score=Number.isFinite(habit.score)?habit.score:0;
  return {count,span,direction:score>.05?'preference':score<-.05?'caution':'neutral',
    confidence:Math.round(Math.max(0,Math.min(1,habit.confidence??0))*100),
    firstMinute:Math.floor((habit.firstAt??0)/60),lastMinute:Math.floor((habit.lastAt??0)/60),
    minutesSinceLast:Math.floor(Math.max(0,activeSeconds-(habit.lastAt??0))/60),
    neededCount:Math.max(0,3-count),neededSpan:Math.max(0,DEVELOPMENT_SPAN-span),spacing:DEVELOPMENT_SPACING,
    established:Boolean(habit.established)};
}

const names={feed:['补充食物','Food'],water:['补充清水','Water'],bedding:['整理床铺','Bedding'],clean:['清理环境','Cleaning'],enrich:['准备陪玩','Play'],mist:['喷雾','Mist'],chime:['风铃','Chime'],brush:['护理','Grooming'],dry:['干燥','Drying'],quiet:['安静','Quiet']};
export function careObservationText(observation,english=false){
  const name=names[observation.type]?.[english?1:0]??observation.type;
  if(!observation.status)return english?`${name} is ready. Watching what it actually does…`:`${name}已准备，正在观察它的实际反应…`;
  if(observation.status==='recovered')return english?`${name}: actual recovery or comfortable activity observed.`:`${name}之后，观察到了实际恢复或愉快活动。`;
  if(observation.status==='uneasy')return english?`${name}: it remained uneasy during this observation.`:`${name}之后，它仍然紧张，需要给它一些空间。`;
  return english?`${name}: no recovery confirmed in this observation window.`:`${name}之后，这次观察没有确认到恢复。`;
}
