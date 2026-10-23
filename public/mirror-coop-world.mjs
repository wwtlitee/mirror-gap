import {RESOURCE_BY_ID} from './resource-spec.mjs';

export const COOP_DOCK=Object.freeze([-2.1,1.6,1.6]);
export const COOP_INTERACTION_RADIUS=.3;
const node=(id,kind,position,label,extra={})=>({id,kind,position:[...position],label,active:true,...extra});
export function deliveryNode(foodId){
  const food=RESOURCE_BY_ID[foodId];if(!food||food.kind!=='food')throw Error('未知餐盘');
  return node('plate-'+foodId,'delivery',[food.position[0],food.position[1]+.23,food.position[2]],'投递到'+food.label,{foodId});
}
export function coopWorldObjects(stage,level){
  if(!Number.isSafeInteger(stage)||stage<0||stage>11)throw Error('未知合作章节');
  const supply=node('supply','supply',[-1.86,1.6,1.6],'领取一份补给');
  const dock=node('dock','charge',COOP_DOCK,'起点充能台');
  let objects=[dock];
  if([0,1,4,5,6,8,11].includes(stage))objects.push(supply);
  if([0,1,8,11].includes(stage))objects.push(deliveryNode('fig'));
  if(stage===1)objects.push(
    node('work','checkpoint',[-1.2,1.9,-2.6],'认识工作台',{discovery:true}),
    node('water','checkpoint',[3.6,1.1,2.6],'寻找水源',{discovery:true}),
    node('window','checkpoint',[2.7,1.8,-2.8],'看看窗外',{discovery:true}));
  if(stage===2)objects.push(node('west','relay',[-3.95,1.65,-.6],'接通西侧节点'),node('east','relay',[-1.8,1.65,-1.7],'接通东侧节点'));
  if(stage===3)objects.push(node('phase','relay',[-2.8,1.65,.7],'切换信号相位',{state:level.phaseBit}));
  if(stage===4)objects.push(node('cup','checkpoint',[-3.15,1.8,.8],'杯边'),node('shelf','checkpoint',[-4.35,1.8,-.3],'书架'),node('table','checkpoint',[-3.4,1.8,1.8],'餐台'));
  if(stage===5)objects.push(deliveryNode('pizza'),deliveryNode('burger'));
  if(stage===6){
    objects=objects.filter(o=>o.id!=='dock');
    objects.push(node('shelf','charge',[-4.3,1.7,-.4],'书架充能台'),node('table','charge',[-3.5,1.6,1.4],'餐台充能台'),node('arrival','checkpoint',[-2.8,1.7,2.65],'带着补给抵达这里'));
  }
  if(stage===7)objects.push(node('signal-window','checkpoint',[-3.3,1.6,1.5],'留在信号区域'));
  for(const object of objects)if(object.kind==='relay')object.state=object.id==='phase'?level.phaseBit:(level.relays?.[object.id]??0);
  for(const dropped of level.dropped??[])objects.push(node(dropped.id,'supply',dropped.position,'取回放下的补给',{cargo:dropped.cargo}));
  return objects;
}
export const distance3=(a,b)=>Math.hypot(...a.map((value,index)=>value-b[index]));
