import {RESOURCE_DEFINITIONS} from './resource-spec.mjs';
export const FOOD_IDS=RESOURCE_DEFINITIONS.filter(r=>r.kind==='food').map(r=>r.id);
export const FOOD_PIECES=8;
let current=null;
export function withFoodStock(state,fn){const previous=current;current=state?.companion?foodStock(state):null;try{return fn();}finally{current=previous;}}
export function foodStock(state){
  if(!state.companion)return null;
  const care=state.living.care;if(!care)return null;
  return care.foods??=Object.fromEntries(FOOD_IDS.map(id=>[id,state.home.food]));
}
export function validateFoodStock(value){if(value===undefined)return;if(!value||Object.keys(value).length!==FOOD_IDS.length||!FOOD_IDS.every(id=>Number.isFinite(value[id])&&value[id]>=0&&value[id]<=100))throw Error('分块食物存档无效');}
export function foodAmount(id){return current?.[id]??100;}
export function visiblePieces(id,stock=current){return Math.ceil((stock?.[id]??100)/100*FOOD_PIECES-1e-9);}
export function portionActive(id,piece){return piece===undefined||piece<visiblePieces(id);}
export function portionTag(id,piece,neighbor=-1){return 1+FOOD_IDS.indexOf(id)*FOOD_PIECES+piece+(neighbor+1)*64;}
export function foodGeometryKey(){return FOOD_IDS.map(id=>visiblePieces(id)).join(',');}
export function tagActive(tag){if(!tag)return true;const base=tag%64,id=FOOD_IDS[Math.floor((base-1)/FOOD_PIECES)],neighbor=Math.floor(tag/64)-1;return portionActive(id,(base-1)%FOOD_PIECES)&&(neighbor<0||!portionActive(id,neighbor));}
export function syncFoodTotal(state){const stock=foodStock(state);if(stock)state.home.food=FOOD_IDS.reduce((sum,id)=>sum+stock[id],0)/FOOD_IDS.length;}
export function refillFood(state,{replace=false,amount=40}={}){const stock=foodStock(state);if(stock){for(const id of FOOD_IDS)stock[id]=replace?100:Math.min(100,stock[id]+amount);syncFoodTotal(state);}else state.home.food=replace?100:Math.min(100,state.home.food+amount);}
export function consumeFood(state,id,amount){
  const stock=foodStock(state);
  if(!stock){const used=Math.min(state.home.food,amount);state.home.food-=used;return used;}
  if(!FOOD_IDS.includes(id))return 0;
  const used=Math.min(stock[id]/FOOD_IDS.length,amount);stock[id]=Math.max(0,stock[id]-used*FOOD_IDS.length);syncFoodTotal(state);return used;
}
