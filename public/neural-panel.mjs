import {browserLife,localApi} from './browser-life.mjs';
import { ZONES } from './world-spec.mjs';
import { REGION_PURPOSES } from './region-life.mjs';
const format=(value,digits=1)=>Number.isFinite(value)?value.toFixed(digits):'—';
const percent=value=>`${format(value*100,0)}%`;
const roleNames={input:'感觉输入',motor:'运动读出',behavior:'行为读出',candidate:'功能候选',support:'连接支持'};

function rows(container,items){
  const refs=new Map();container.replaceChildren();
  for(const item of items){
    const row=document.createElement('div');row.className='circuit-row';
    const label=document.createElement('span');label.textContent=item.label;
    const note=document.createElement('small');note.textContent=item.note??'';label.append(note);
    const value=document.createElement('output');row.append(label,value);container.append(row);refs.set(item.id,value);
  }
  return refs;
}

export function createNeuralPanel(){
  const $=id=>document.getElementById(id),dialog=$('neuron-dialog');
  let lastUpdate=0,inputRows,groupRows,latest=null,online=false,disposed=false;
  const regionRows=rows($('region-life-values'),ZONES.filter(z=>!z.decorative).map(z=>({id:z.id,label:z.name,note:REGION_PURPOSES[z.id]})));
  const bodyRows=rows($('neural-body-values'),[
    {id:'drive',label:'运动推力',note:'工程读出 · 0–1.4'},
    {id:'side',label:'左右 / 升降 / 前进',note:'身体坐标 · −1 至 +1'},
    {id:'feeding',label:'进食启动',note:'MN9 响应换算 · 0–1'},
    {id:'grooming',label:'触角梳理',note:'下行响应换算 · 0–1'},
    {id:'alert',label:'惊扰 / 湿润',note:'身体与环境模型'},
    {id:'gust',label:'微风 / 阴影',note:'环境信号'},
    {id:'contact',label:'本次落脚',note:'实际接触时间'},
    {id:'arousal',label:'运动输入基准',note:'工程感觉强度 · 0–1'},
    {id:'attention',label:'屏幕关注 / 冷却',note:'进入关注需 2.5 秒'},
  ]);

  function update(state,connected){
    latest=state;online=connected;
    const n=state?.neural,available=connected&&n?.available;
    $('neuron-open').disabled=!available;
    $('circuit-status').textContent=!connected?'连接断开 · 保留最后采样':!n?.available?'神经数据不可用':state.paused?'生活暂停 · 保留最后采样':n.metrics?.sampled?'实际放电 · 实时采样':'等待第一帧采样';
    $('neural-details').classList.toggle('stale',!available||state?.paused);
    if(!available||!n.metrics)return;
    const life=state.living,context=n.sensory.context??{},duration=Math.floor(life.contactSeconds);
    const reason=state.paused?'生活已暂停':life.workstation.phase==='playing'?'正在用神经输出操作电脑'
      :context.holdReason==='approach'?'正在接近落脚面':context.holdReason==='screen'?'正在关注屏幕，等待接入'
      :context.holdReason==='toilet'?'正在厕所解决排泄需求':context.holdReason==='bathing'?'正在浅水边清洁':context.holdReason==='drinking'?(state.actor.drinkingTarget?`口器正在接触${state.actor.consumingResource?.label??'水面'}`:'正在朝向水面，准备饮水'):context.holdReason==='feeding'?(state.actor.action==='eat'?`口器正在接触${state.actor.consumingResource?.label??'食物'}`:'正在朝向食物，准备进食')
      :context.holdReason==='recovery'?'正在休息恢复精力'
      :context.holdReason==='sampling'?'正在接触取样，随后继续探索':context.holdReason==='grooming'?'正在梳理身体':context.takeoffIntent?'地面探索无进展，正在产生离开感觉':context.holdReason==='settling'?'刚落脚，短暂感受周围'
      :state.actor.contact?(n.motor.drive>.05?'已经有运动输出，正在落脚处调整':'当前运动回路安静，持续接收环境信号'):'正在自由移动';
    $('motion-explanation').textContent=reason+(state.actor.contact?` · 已停留 ${duration} 秒`:'');
    if($('neural-drawer')?.hidden)return;
    if(performance.now()-lastUpdate<450&&!state.paused)return;
    lastUpdate=performance.now();
    if(!inputRows)inputRows=rows($('neural-input-values'),n.metrics.inputs.map(i=>({id:i.id,label:i.label,note:`${i.count} 个细胞 · 输入强度 / 平均放电`}))); 
    if(!groupRows){
      groupRows=rows($('neural-group-values'),n.metrics.groups.map(g=>({id:g.id,label:g.label,note:`${g.id} · ${g.count} 个 · ${roleNames[g.role]}`})));
      $('circuit-group-count').textContent=String(n.metrics.groups.length);
    }
    for(const i of n.metrics.inputs)inputRows.get(i.id).textContent=`${percent(i.strength)} · ${format(i.hz)} Hz`;
    for(const g of n.metrics.groups){
      const sides=g.leftHz!==null||g.rightHz!==null;
      groupRows.get(g.id).textContent=sides?`左 ${format(g.leftHz)} / 右 ${format(g.rightHz)} Hz`:`${format(g.hz)} Hz`;
    }
    bodyRows.get('drive').textContent=format(n.motor.drive,2);
    bodyRows.get('side').textContent=n.motor.local.map(v=>format(v,2)).join(' / ');
    for(const key of ['feeding','grooming'])bodyRows.get(key).textContent=format(n.behavior[key],3);
    bodyRows.get('alert').textContent=`${percent(life.alert)} / ${percent(life.wetness)}`;
    bodyRows.get('gust').textContent=`${percent(life.gust)} / ${percent(life.shadow)}`;
    bodyRows.get('contact').textContent=`${format(life.contactSeconds)} s`;
    bodyRows.get('arousal').textContent=format(context.arousal,3);
    bodyRows.get('attention').textContent=`${format(life.workstation.attention)} / ${format(life.workstation.cooldown)} s`;
    for(const zone of ZONES.filter(z=>!z.decorative)){
      const r=life.regions?.[zone.id],output=regionRows.get(zone.id);
      if(!r){output.textContent='等待新版本数据';continue;}
      const settled=Math.max(0,Math.round(r.settled)),duration=settled>=3600?`${Math.floor(settled/3600)}小时${Math.floor(settled%3600/60)}分`:settled>=60?`${Math.floor(settled/60)}分${settled%60}秒`:`${settled}秒`;
      const values=[`需求 ${Math.round(r.need*100)}`,`停留 ${duration}`,`走动 ${(life.surface?.stats?.[zone.id]?.walked??0).toFixed(2)}m`,`${Object.keys(life.surface?.stats?.[zone.id]?.actions??{}).filter(k=>!['flight','perch'].includes(k)).length}种活动`];
      output.replaceChildren(...values.map(text=>{const span=document.createElement('span');span.className='region-stat';span.textContent=text;return span;}));
    }
    $('circuit-window').textContent=`放电按 ${n.metrics.windowMs||40} ms 神经时间窗口计算；不把神经活动当作额外情绪值。`;
  }

  let page=0,pages=1,request=null,requestId=0,searchTimer=null;
  function clearRequest(){requestId++;request?.abort();request=null;}
  async function loadCells(){
    if(disposed||!dialog.open||document.hidden)return;
    clearRequest();const id=requestId;request=new AbortController();const controller=request;
    const timer=setTimeout(()=>controller.abort(),5000);
    try{
      const params=new URLSearchParams({q:$('neuron-search').value,role:$('neuron-role').value,page:String(page)});
      const data=browserLife?await localApi(`/api/neural/cells?${params}`):await (async()=>{const response=await fetch(`/api/neural/cells?${params}`,{signal:request.signal,cache:'no-store'});if(!response.ok)throw Error('读取细胞失败');return response.json();})();
      if(id!==requestId||!dialog.open)return;
      page=data.page;pages=data.pages;
      $('neuron-page').textContent=`${data.total.toLocaleString()} 个 · ${page+1} / ${pages} 页`;
      $('neuron-prev').disabled=page===0;$('neuron-next').disabled=page+1>=pages;
      $('neuron-sample').textContent=`${data.paused?'暂停，最后采样':data.status==='starting'?'等待采样':'实时读取'} · ${data.windowMs||0} ms 神经窗口`;
      const fragment=document.createDocumentFragment();
      for(const cell of data.cells){
        const tr=document.createElement('tr');
        const values=[`${cell.type} · ${{left:'左',right:'右'}[cell.side]??'未定侧'}`,cell.root,roleNames[cell.role],format(cell.hz),format(cell.voltage,2),format(cell.synapticDrive,3),format(cell.refractoryMs,1)];
        for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td);}fragment.append(tr);
      }
      $('neuron-cells').replaceChildren(fragment);
    }catch(error){if(id===requestId&&dialog.open)$('neuron-sample').textContent='读取失败，显示上次结果';}
    finally{clearTimeout(timer);if(id===requestId)request=null;}
  }
  $('neuron-open').addEventListener('click',()=>{dialog.showModal();void loadCells();});
  $('neuron-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',clearRequest);
  $('neuron-search').addEventListener('input',()=>{page=0;clearRequest();clearTimeout(searchTimer);searchTimer=setTimeout(()=>void loadCells(),250);});
  $('neuron-role').addEventListener('change',()=>{page=0;void loadCells();});
  $('neuron-prev').addEventListener('click',()=>{page=Math.max(0,page-1);void loadCells();});
  $('neuron-next').addEventListener('click',()=>{page=Math.min(pages-1,page+1);void loadCells();});
  const poll=setInterval(()=>{if(!request)void loadCells();},1500);
  return {update,disconnect(){update(latest,false);},dispose(){disposed=true;clearRequest();clearTimeout(searchTimer);clearInterval(poll);},
    diagnostics:()=>({online,groups:groupRows?.size??0,inputs:inputRows?.size??0,cellsOpen:dialog.open})};
}
