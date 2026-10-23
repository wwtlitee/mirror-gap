const ranges={energy:100,satiety:100,curiosity:100,comfort:100,thirst:1,sleepPressure:1,dirt:1,waste:1,alert:1,wetness:1};
export function bodyCheckpoint(state){const result={format:1,savedAt:Date.now(),values:{}};for(const key of Object.keys(ranges))result.values[key]=state.needs[key]??state.living.physiology[key]??state.living[key];return validateBodyCheckpoint(result);}
export function validateBodyCheckpoint(value){
 if(!value||value.format!==1||!Number.isFinite(value.savedAt)||!value.values)throw Error('身体存档格式无效');
 for(const [key,max]of Object.entries(ranges)){const n=value.values[key];if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>max)throw Error('身体存档数值无效：'+key);}
 return value;
}
export function restoreBody(state,saved){validateBodyCheckpoint(saved);for(const key of Object.keys(ranges)){const target=key in state.needs?state.needs:key in state.living.physiology?state.living.physiology:state.living;target[key]=saved.values[key];}}
