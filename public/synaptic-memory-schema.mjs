// v8.2.0: weight-only memory schema; no graph loading or neural runtime imports.
export const SYNAPTIC_MODEL_VERSION='0.0.1a';
export const SYNAPTIC_GRAPH_HASH='0b5de2a6c6b6d6265830ec91a65c8a5d11688ef01ba96c63bf75d239d4d89e3f';
export const SYNAPTIC_WEIGHT_COUNT=946;
const FIELDS=['format','modelVersion','graphHash','efficacy'];

export function validateSynapticMemoryMode(mode){
  if(mode!=='neutral'&&mode!=='legacy-food')throw Error('突触记忆模式无效，原数据已保留。');
  return mode;
}

export function validateSynapticMemory(value){
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||Object.keys(value).length!==FIELDS.length||!FIELDS.every(key=>Object.hasOwn(value,key))
    ||value.format!==1||value.modelVersion!==SYNAPTIC_MODEL_VERSION||value.graphHash!==SYNAPTIC_GRAPH_HASH
    ||!Array.isArray(value.efficacy)||value.efficacy.length!==SYNAPTIC_WEIGHT_COUNT){
    throw Error('突触记忆存档格式或来源无效，原数据已保留。');
  }
  // Indexed reads reject holes too; Array.every would skip missing efficacies.
  for(let i=0;i<SYNAPTIC_WEIGHT_COUNT;i++){
    const efficacy=value.efficacy[i];
    if(typeof efficacy!=='number'||!Number.isFinite(efficacy)||efficacy<.05||efficacy>1){
      throw Error('突触记忆权重无效，原数据已保留。');
    }
  }
  return value;
}
