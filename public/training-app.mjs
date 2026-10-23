import {createHomeScene} from './scene.mjs';
import {createCueTrainingClient} from './cue-training-client.mjs';
import {VERSION} from './world-spec.mjs';

const $=selector=>document.querySelector(selector),lab=createCueTrainingClient();
let scene=null,state=null,frame=0,lastFrame=0,disposed=false,pending=false,failed=false,view='follow',subscription;
const views=[...document.querySelectorAll('[data-view]')];
const number=(value,digits=2)=>Number.isFinite(value)?value.toFixed(digits):'—';
function chooseView(next){
  if(!scene)return;
  view=next;if(next==='feed')scene.focusZone('feed');else scene.setView(next);
  for(const button of views)button.setAttribute('aria-pressed',String(button.dataset.view===next));
}
function setError(error,fatal=false){
  $('#error').hidden=false;$('#error-text').textContent=error?.message??String(error);
  $('#retry').hidden=!fatal;
  if(fatal){failed=true;$('#loading').hidden=true;$('#room-message').textContent='实验线程已停止';$('#phase-badge').textContent='已停止';}
  renderControls();
}
function renderControls(){
  const experiment=state?.experiment,ready=lab.status==='ready'&&!failed&&!pending;
  for(const button of document.querySelectorAll('.cue-buttons button,#emit-off'))button.disabled=!ready||!experiment?.canEmit;
  for(const cue of ['A','B'])$('#emit-'+cue.toLowerCase()).setAttribute('aria-pressed',String(experiment?.emission===cue));
  $('#start-probe').disabled=!ready||!experiment?.canProbe||experiment.phase==='probing';
  $('#swap-probe').disabled=!ready||!experiment?.canProbe||experiment.phase==='probing';
  $('#end-probe').disabled=!ready||experiment?.phase!=='probing';
  $('#pause').disabled=!ready;$('#new-experiment').disabled=!ready;$('#retry').disabled=pending;
  if(failed){$('#phase-badge').textContent='已停止';$('#room-message').textContent='本次实验已停止，请查看错误提示';return;}
  if(!experiment)return;
  const probing=experiment.phase==='probing',probe=experiment.probe;
  $('#phase-badge').textContent=experiment.paused?'已暂停':probing?'撤食观察':'气味训练';
  $('#room-message').textContent=experiment.paused?'继续后，身体与观察计时才会推进':probing?'观察 A / B 两侧的选择':'让它自己寻找食物并进食';
  $('#pause').textContent=experiment.paused?'继续':'暂停';
  $('#signal-state').textContent=probing?'A / B 分别在两侧释放':experiment.emission==='off'?'餐台气味已关闭':'气味 '+experiment.emission+' 正在餐台释放';
  $('#feeding-time').replaceChildren(document.createTextNode(number(experiment.actualFeedingSeconds)+' '),Object.assign(document.createElement('small'),{textContent:'秒'}));
  $('#feeding-label').textContent=experiment.actualFeedingSeconds>0?'本次实际进食':'等待实际进食';
  const evidence=experiment.cueTraining??{},paired=['A','B'].filter(cue=>evidence[cue]?.actualFeedingSeconds>0);
  $('#training-evidence').textContent=paired.length?paired.map(cue=>cue+' 伴随进食 '+number(evidence[cue].actualFeedingSeconds)+' 秒').join(' · '):'气味在餐台释放。食物仍由它自己寻找。';
  $('#probe-hint').textContent=probing?'观察期间不再学习；结束后食物自动恢复。':experiment.canProbe?'已有气味伴随真实进食的突触变化，可以撤食观察。':'发出气味并实际进食后，就可以开始。';
  $('#start-probe').hidden=probing;$('#probe-progress').hidden=!probing;
  $('#probe-clock').textContent=number(probe?.elapsed??0,1)+' / 20 秒';$('#probe-meter').value=probe?.elapsed??0;
  const result=probe?.result;
  $('#result').hidden=!result||probing;$('#swap-probe').hidden=!result||probing;
  if(result){
    const pi=result.preferenceIndex,valid=Number.isFinite(pi),different=valid&&Math.abs(pi)>.08;
    $('#result-title').textContent=!result.completed?'观察提前结束':!different?'这次没有明显偏向':'这次更靠近气味 '+(pi>0?'A':'B');
    $('#result-detail').textContent='观察 '+number(result.elapsed,1)+' 秒，距 A 平均 '+number(result.meanDistanceA)+' 米，距 B 平均 '+number(result.meanDistanceB)+' 米。';
    $('#result .result-note').textContent=result.inventoryRestored?'食物已恢复，身体与突触记忆继续保留。这是当次轨迹记录，换位复测会沿用当前位置。':'食物恢复未确认，请重新建立实验个体。';
  }
  $('#technical-state').textContent='实验种子 '+experiment.seed+' · 实际教学事件 '+experiment.teachingEvents+' 次。刷新会结束本次实验。';
}
async function act(action,payload){
  if(pending||disposed||failed)return;
  pending=true;$('#error').hidden=true;$('#action-message').textContent='';renderControls();
  try{
    state=await lab.command(action,payload);
    if(action==='emit')$('#action-message').textContent=payload==='off'?'气味已关闭。':'气味 '+payload+' 已释放，等它自己找到食物。';
    if(action==='probe'||action==='swap'){chooseView('feed');$('#action-message').textContent='食物已撤去，开始记录它的移动。';}
    if(action==='endProbe')$('#action-message').textContent='已结束观察，继续训练。';
    if(action==='reset'){$('#action-message').textContent='新的实验个体已准备好。';chooseView('follow');}
  }catch(error){setError(error,lab.status==='failed');}
  finally{pending=false;renderControls();}
}
for(const cue of ['a','b'])$('#emit-'+cue).addEventListener('click',()=>act('emit',cue.toUpperCase()));
$('#emit-off').addEventListener('click',()=>act('emit','off'));
$('#start-probe').addEventListener('click',()=>act('probe'));
$('#swap-probe').addEventListener('click',()=>act('swap'));
$('#end-probe').addEventListener('click',()=>act('endProbe'));
$('#pause').addEventListener('click',()=>act('pause',!state?.experiment.paused));
$('#new-experiment').addEventListener('click',()=>{const dialog=$('#reset-dialog');dialog.returnValue='';dialog.showModal();});
$('#reset-dialog').addEventListener('cancel',()=>{$('#reset-dialog').returnValue='cancel';});
$('#reset-dialog').addEventListener('close',()=>{if($('#reset-dialog').returnValue==='confirm')act('reset',{newExperiment:true});});
views.forEach(button=>button.addEventListener('click',()=>chooseView(button.dataset.view)));
document.addEventListener('keydown',event=>{
  if(event.repeat||event.ctrlKey||event.metaKey||event.altKey||event.target.closest('input,textarea,select,button,a,summary,dialog')||$('#reset-dialog').open)return;
  const key={'1':'#emit-a','2':'#emit-b','0':'#emit-off',' ':'#pause'}[event.key];
  if(key&&!$(key).disabled){event.preventDefault();$(key).click();}
});
async function start(){
  pending=true;renderControls();
  try{failed=false;$('#error').hidden=true;$('#loading').hidden=false;state=await lab.start();$('#loading').hidden=true;}
  catch(error){setError(error,true);}
  finally{pending=false;renderControls();}
}
$('#retry').addEventListener('click',start);
const observer=new ResizeObserver(()=>scene?.resize());observer.observe($('.room-panel'));
function dispose(){
  if(disposed)return;disposed=true;cancelAnimationFrame(frame);observer.disconnect();subscription?.close();lab.dispose();scene?.dispose();
}
window.addEventListener('pagehide',dispose,{once:true});
window.render_game_to_text=()=>JSON.stringify({version:VERSION,connected:lab.status==='ready'&&!failed,status:lab.status,view,...state,rendering:scene?.getDiagnostics()??null});
window.advanceTime=milliseconds=>{if(scene&&state)scene.update(state,Math.min(Math.max(Number(milliseconds)||0,0)/1000,.5));return window.render_game_to_text();};
try{
  scene=await createHomeScene($('#home-canvas'),{trainingCues:true});
  if(disposed){scene.dispose();throw Error('训练室已经关闭');}
  chooseView('follow');document.body.dataset.scene='ready';
  subscription=lab.subscribe(next=>{state=next;renderControls();},error=>setError(error,true));
  function render(now){
    if(disposed)return;
    try{if(state)scene.update(state,Math.min((now-lastFrame)/1000,.1));lastFrame=now;frame=requestAnimationFrame(render);}
    catch(error){lab.dispose();setError(error,true);$('#retry').hidden=true;}
  }
  frame=requestAnimationFrame(render);await start();
}catch(error){lab.dispose();if(!disposed){setError(error,true);$('#retry').hidden=true;}}
