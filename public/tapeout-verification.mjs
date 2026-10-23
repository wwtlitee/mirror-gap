import {DEFAULT_TAPEOUT,TAPEOUT_PULSE_CIRCUIT,TAPEOUT_PULSE_SOURCE,createReadonlyTapeoutBridge,parseCircuit,stepCircuit,circuitHex} from './tapeout-circuit.mjs';

const native=parseCircuit(TAPEOUT_PULSE_SOURCE);
const xor=parseCircuit(DEFAULT_TAPEOUT);
const pulse=parseCircuit(TAPEOUT_PULSE_CIRCUIT,{resolveRef:()=>native});
const sameBytes=(a,b)=>circuitHex(a)===circuitHex(b);

function matchDescriptor(actual,expected,label){
  if(!actual||['nIn','nOut','nState','gateCount','signals','netlist'].some(key=>actual[key]!==expected[key]))throw Error(`${label}链上网表与固定运行电路不一致`);
}

/** One explicit, read-only verification. A failure never replaces the frozen runtime. */
export async function verifyFrozenTapeout({bridge=createReadonlyTapeoutBridge(),onProgress=()=>{}}={}){
  if(typeof onProgress!=='function'||!bridge||['verifyDeployment','loadCircuit','step'].some(key=>typeof bridge[key]!=='function'))throw Error('电路核验接口无效');
  onProgress({phase:'deployment',completed:0,total:7});
  const deployment=await bridge.verifyDeployment();
  if(deployment.chainId!==196||deployment.factory!==DEFAULT_TAPEOUT.factory||deployment.cpu!==DEFAULT_TAPEOUT.cpu||!/^0x[0-9a-f]+$/i.test(deployment.blockNumber??''))throw Error('X Layer处理器身份核验不一致');
  const loadedXor=await bridge.loadCircuit({cpu:DEFAULT_TAPEOUT.cpu,id:1n});
  const loadedPulse=await bridge.loadCircuit({cpu:TAPEOUT_PULSE_CIRCUIT.cpu,id:4n});
  matchDescriptor(loadedXor,xor,'XOR');matchDescriptor(loadedPulse,pulse,'LATCH引用');
  const ref=loadedPulse.elements?.[0];
  if(ref?.op!==2||ref.cpu!==TAPEOUT_PULSE_SOURCE.cpu||ref.id!==102n)throw Error('脉冲引用来源不一致');
  matchDescriptor(ref.sub,native,'双LATCH');
  let completed=0;
  for(let input=0;input<4;input++){
    const inputs=Uint8Array.of(input),state=new Uint8Array();
    const local=stepCircuit(xor,{state,inputs}),remote=await bridge.step({cpu:DEFAULT_TAPEOUT.cpu,id:1n,state,inputs});
    if(!sameBytes(local.outputs,remote.outputs)||!sameBytes(local.newState,remote.newState))throw Error(`XOR输入${input}的链上输出不一致`);
    onProgress({phase:'xor',completed:++completed,total:7});
  }
  let state=new Uint8Array();
  for(let tick=0;tick<3;tick++){
    const inputs=new Uint8Array(),local=stepCircuit(pulse,{state,inputs});
    const remote=await bridge.step({cpu:TAPEOUT_PULSE_CIRCUIT.cpu,id:4n,state,inputs});
    if(!sameBytes(local.outputs,remote.outputs)||!sameBytes(local.newState,remote.newState))throw Error(`LATCH第${tick+1}拍的链上状态或输出不一致`);
    state=local.newState;onProgress({phase:'latch',completed:++completed,total:7});
  }
  return Object.freeze({status:'verified',chainId:196,factory:deployment.factory,cpu:deployment.cpu,blockNumber:deployment.blockNumber,rpcUrl:deployment.rpcUrl,
    circuitIds:['1','4'],reference:{cpu:TAPEOUT_PULSE_SOURCE.cpu,id:'102'},vectors:completed,checkedAt:new Date().toISOString(),runtime:'fixed-netlists-local-step'});
}
