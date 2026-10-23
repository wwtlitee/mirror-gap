import {browserLife,exportCompanion,importCompanion,recoveryBackup,rawCompanionBackup,rawGoodCompanionBackup,getPersistence,goodCompanionBackups,exportGoodCompanionBackup,restoreGoodCompanionBackup} from './browser-life.mjs';
import {appearanceLabels} from './companion-appearance.mjs';
import {MEMORY_LABELS,validName} from './companion-identity.mjs';
import {createCompanionVoice,voiceBankFor} from './companion-voice.mjs';
import {createCompanionPreview} from './companion-preview.mjs';
import {createGrowthPortrait,exportGrowthCard} from './companion-growth-card.mjs';
import {growthSummary} from './companion-growth.mjs';
import {developmentSummary} from './companion-development.mjs';
import {habitEvidence} from './companion-evidence.mjs';
const $=s=>document.querySelector(s);
const english=()=>document.documentElement.lang==='en';
const t=(zh,en)=>english()?en:zh;
function download(text,name){const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function child(tag,text,cls){const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;return el;}
export function setupCompanionUi({api,getState,command,toast}) {
  if(!browserLife)return {update(){},diagnostics(){return null;},dispose(){}};
  const button=child('button','我的果蝇','companion-trigger');button.id='companion-toggle';button.type='button';button.setAttribute('aria-haspopup','dialog');$('.masthead').append(button);
  const host=document.createElement('div');host.className='companion-ui';
  host.innerHTML=`<dialog id="adoption-dialog" aria-labelledby="adoption-title" data-no-locale>
    <div class="adoption-visual"><canvas id="adoption-preview" aria-label="Your fruit fly"></canvas><span class="companion-stamp">ONE SMALL LIFE · YOURS</span></div>
    <div class="adoption-copy"><span class="companion-eyebrow" data-zh="初次见面" data-en="A FIRST HELLO"></span><h2 id="adoption-title" data-zh="这只小家伙，等你取个名字。" data-en="A little life, waiting for a name."></h2>
    <p class="companion-muted" data-zh="外形、声音和初始气质已经准备好。接下来的日子，会慢慢留下它自己的习惯。" data-en="A look, a voice and a little temperament. The days ahead will give it habits of its own."></p>
    <div id="adoption-traits" class="companion-traits"></div><p id="adoption-temperament"></p><p id="adoption-voice-name"></p>
    <form id="adoption-form"><label for="adoption-name" data-zh="给它取名" data-en="Give it a name"></label><input id="adoption-name" maxlength="24" required autocomplete="off" placeholder="例如，小豆 / e.g. Bean">
    <label class="companion-check"><input id="adoption-voice" type="checkbox" checked><span data-zh="让它说话 · 固定中文语音" data-en="Let it speak · prerecorded Chinese voice"></span></label>
    <p id="adoption-error" class="companion-error" role="alert"></p><button class="companion-primary" id="adoption-submit" type="submit" data-zh="领养，开始一起生活" data-en="Adopt and begin"></button></form>
    <button id="adoption-import" class="companion-link" data-zh="已有果蝇？导入备份" data-en="Already have a companion? Import a backup"></button>
    <p class="companion-fine" data-zh="身份与经历保存在此浏览器。备份后可以搬家到另一台设备。" data-en="Identity and memories stay in this browser. Export a backup to move to another device."></p></div>
  </dialog>
  <dialog id="companion-dialog" aria-labelledby="companion-title" data-no-locale><header class="companion-heading"><div><span class="companion-eyebrow" data-zh="它的小档案" data-en="A LITTLE LIFE"></span><h2 id="companion-title"></h2></div><button id="companion-close" aria-label="Close / 关闭">×</button></header>
    <p id="companion-age" class="companion-muted"></p><p id="companion-id" class="companion-fine"></p>
    <section class="companion-growth" aria-labelledby="companion-growth-title"><div class="companion-growth-heading"><h3 id="companion-growth-title" data-zh="看着它长大" data-en="Watch it grow"></h3><span id="companion-growth-stage" class="companion-stage"></span></div>
    <figure class="companion-growth-figure"><canvas id="companion-growth-portrait" role="img" aria-label="初领与现在的同尺度体型对照"></canvas><figcaption><span data-zh="刚领养" data-en="At adoption"></span><span data-zh="现在" data-en="Now"></span></figcaption></figure>
    <p id="companion-growth-size" class="companion-growth-size"></p><p id="companion-growth-note" class="companion-fine"></p>
    <div class="companion-actions"><button id="companion-focus" type="button" data-zh="近看它" data-en="Look closer"></button><button id="companion-growth-export" type="button" data-zh="保存成长卡" data-en="Save growth card"></button></div><p id="companion-growth-status" class="companion-error" role="status"></p></section>
    <div class="companion-development"><section><h3 data-zh="相处的变化" data-en="Growing familiar"></h3><p id="companion-relationship" class="companion-development-label"></p><p id="companion-relationship-note" class="companion-fine"></p></section><section><h3 data-zh="越玩越熟" data-en="Practice makes progress"></h3><p id="companion-toy" class="companion-development-label"></p><p id="companion-toy-note" class="companion-fine"></p></section></div>
    <div id="companion-traits" class="companion-traits"></div>
    <form id="companion-rename"><label for="companion-name" data-zh="名字" data-en="Name"></label><div class="companion-inline"><input id="companion-name" maxlength="24" required><button type="submit" data-zh="保存名字" data-en="Save name"></button></div></form>
    <section><h3 data-zh="慢慢形成的习惯" data-en="Habits taking shape"></h3><p id="companion-temperament" class="companion-muted"></p><div id="companion-preferences"></div></section>
    <section><h3 data-zh="值得记住的时刻" data-en="Milestones to keep"></h3><ol id="companion-milestones"></ol><details id="companion-milestone-history" class="companion-recent" hidden><summary id="companion-milestone-history-label"></summary><ol id="companion-milestones-older"></ol></details><details class="companion-recent"><summary data-zh="最近的小事与感受" data-en="Recent moments and impressions"></summary><ol id="companion-memories"></ol></details></section>
    <section><h3 data-zh="它的声音" data-en="A voice of its own"></h3><p id="companion-voice-name"></p><div class="companion-inline"><label class="companion-check"><input id="companion-voice-enabled" type="checkbox"><span data-zh="生活语音" data-en="Life sounds"></span></label><button id="companion-listen" type="button" data-zh="听听它的声音" data-en="Hear its voice"></button></div><label for="companion-volume" data-zh="音量" data-en="Volume"></label><input id="companion-volume" type="range" min="0" max="100" step="5"><p class="companion-fine" data-zh="Fish Audio 合成预录语音，由真实生活事件触发。没有聊天接口，也不会实时生成台词。" data-en="Prerecorded synthetic Fish Audio voices respond to actual life events. No chat service or live text generation."></p><p id="companion-audio-status" role="status"></p></section>
    <section><h3 data-zh="陪它待一会儿" data-en="Spend a little time together"></h3><div class="companion-actions"><button type="button" data-companion-action="mist" data-zh="喷一点雾" data-en="A little mist"></button><button type="button" data-companion-action="chime" data-zh="轻摇风铃" data-en="Ring the chime"></button></div></section>
    <section class="companion-backup"><h3 data-zh="带它去别处" data-en="Take it with you"></h3><p class="companion-fine" data-zh="清除浏览器数据会丢失存档，请定期备份。导入会保留当前存档的恢复副本。" data-en="Clearing browser data removes your companion. Back up regularly. Import keeps a recovery copy of the current save."></p><div class="companion-actions"><button id="companion-export" data-zh="导出备份" data-en="Export backup"></button><button id="companion-import" data-zh="导入备份" data-en="Import backup"></button><button id="companion-recover" data-zh="恢复上一次导入前存档" data-en="Restore pre-import save"></button></div></section>
    <div class="companion-actions companion-settings-links"><button type="button" data-open-settings="sound" data-zh="声音设置 ↗" data-en="Voice settings ↗"></button><button type="button" data-open-settings="backup" data-zh="存档与备份 ↗" data-en="Save & backup ↗"></button></div>
    <p id="companion-status" class="companion-error" role="status"></p>
  </dialog><input id="companion-file" type="file" accept=".json,application/json" hidden>
  <div id="companion-caption" class="companion-caption" role="status" data-no-locale hidden><span></span><p></p></div>`;
  document.body.append(host);
  const voiceSection=$('#companion-voice-enabled').closest('section');
  const backupSection=$('#companion-export').closest('section');
  const interactionSection=host.querySelector('[data-companion-action]').closest('section');
  const identity=$('#companion-id'),settingsDialog=$('#settings-dialog');
  const ownedRoots=[host,voiceSection,backupSection,interactionSection,identity];
  // Move the existing controls so their state and event handlers have one owner.
  for(const [node,target]of [[voiceSection,'#settings-voice'],[backupSection,'#settings-backup'],[identity,'#settings-identity'],[interactionSection,'#room-interactions']]){
    node.dataset.noLocale='';$(target).append(node);
  }
  const backupStatus=child('p','','companion-error');backupStatus.id='companion-backup-status';backupStatus.setAttribute('role','status');backupSection.append(backupStatus);
  const snapshots=child('details','','companion-recent');snapshots.id='companion-snapshots';snapshots.append(child('summary',t('最近的有效存档','Recent valid saves')));
  const rawSnapshots=child('button',t('导出快照原文','Export snapshot data'));rawSnapshots.type='button';rawSnapshots.id='companion-raw-snapshots';rawSnapshots.hidden=true;backupSection.append(rawSnapshots);
  rawSnapshots.addEventListener('click',()=>{try{const raw=rawGoodCompanionBackup();if(!raw)throw Error(t('没有可导出的快照原文。','No snapshot data to export.'));download(raw,'fruit-fly-snapshot-recovery-raw.json');backupStatus.textContent=t('快照原文已导出，供恢复检查。','Snapshot data exported for recovery inspection.');}catch(error){backupStatus.textContent=error.message;}});
  const snapshotList=child('div','','companion-snapshot-list');snapshots.append(snapshotList);backupSection.append(snapshots);
  const persistenceDetail=child('p','','companion-fine');persistenceDetail.id='companion-persistence-detail';$('#settings-save').after(persistenceDetail);
  let snapshotSignature='';
  function renderPersistence(){
    const p=getPersistence();rawSnapshots.hidden=!p.snapshotError;rawSnapshots.textContent=t('导出快照原文','Export snapshot data');
    const savedDetail=p.lastSavedAt?t(`已保存于 ${new Date(p.lastSavedAt).toLocaleTimeString()} · 修订 ${p.revision} · v${p.productVersion??'旧存档'}`,`Saved at ${new Date(p.lastSavedAt).toLocaleTimeString()} · revision ${p.revision} · v${p.productVersion??'legacy save'}`):t('等待第一次有效保存。','Waiting for the first valid save.');
    persistenceDetail.textContent=p.status==='degraded'?savedDetail+t('。恢复快照暂未更新，请导出备份，并检查已有快照。','. Recovery snapshots have not updated. Export a backup and check available snapshots.'):p.error?t(`保存异常：${p.error}。可以导出备份以便恢复检查。`,`Save error: ${p.error}. Export a backup for recovery inspection.`):savedDetail;
    snapshots.firstChild.textContent=t('最近的有效存档','Recent valid saves');
    let copies;try{copies=goodCompanionBackups();}catch(error){snapshotSignature='';snapshotList.textContent=error.message;return;}
    const signature=JSON.stringify(copies)+english();if(signature===snapshotSignature)return;snapshotSignature=signature;
    snapshotList.replaceChildren();
    if(!copies.length)snapshotList.append(child('p',t('暂时没有恢复快照。成功保存后会逐步保留最近 3 份。','No recovery snapshots yet. Successful saves gradually keep the latest 3.'),'companion-fine'));
    for(const copy of copies){
      const row=child('div','','companion-snapshot');row.append(child('p',`${copy.identityName||t('未取名','Unnamed')} · ${new Date(copy.savedAt).toLocaleString()} · r${copy.revision}`,'companion-fine'));
      const exportButton=child('button',t('导出这份存档','Export this save'));exportButton.type='button';
      exportButton.addEventListener('click',()=>{try{download(exportGoodCompanionBackup(copy.key),`fruit-fly-snapshot-r${copy.revision}.json`);backupStatus.textContent=t('恢复快照已导出。','Recovery snapshot exported.');}catch(error){backupStatus.textContent=error.message;}});
      const restore=child('button',t('恢复这份存档','Restore this save'));restore.type='button';
      restore.addEventListener('click',async()=>{try{if(!confirm(t('恢复将回到这份存档的生活进度，当前存档会保留为恢复副本。继续？','Restore this save’s life progress and keep a recovery copy of the current save?')))return;restore.disabled=true;await restoreGoodCompanionBackup(copy.key);}catch(error){backupStatus.textContent=error.message;}finally{restore.disabled=false;}});
      row.append(exportButton,restore);snapshotList.append(row);
    }
  }
  const interactionButtons=[...interactionSection.querySelectorAll('[data-companion-action]')];
  let state=null,preview=null,previewSeed=null,portrait=null,portraitSeed=null,growthNotice=null,renderAt=0,lang='',disposed=false;
  const voice=createCompanionVoice({onCaption(line){const el=$('#companion-caption');el.hidden=!line;if(line){el.querySelector('span').textContent=line.name||t('小家伙','Little one');el.querySelector('p').textContent=english()?line.english:line.text;}},onError:message=>{$('#companion-audio-status').textContent=message;}});
  function localize(){for(const root of ownedRoots)for(const el of root.querySelectorAll('[data-zh]'))el.textContent=english()?el.dataset.en:el.dataset.zh;button.textContent=t('我的果蝇','My companion');backupStatus.setAttribute('aria-label',t('存档与备份状态','Backup status'));}
  function updateInteractions(){for(const el of interactionButtons){const remaining=state?.cooldowns?.[el.dataset.companionAction]??0;el.disabled=getPersistence().runtimeStatus!=='ready'||!state?.companion?.identity.adoptedAt||Boolean(state?.paused)||remaining>0;el.title=remaining>0?`${Math.ceil(remaining)}s`:'';}}
  function temperament(c){const v=c.temperament;return t(`${v.curiosity>.5?'爱探索':'慢慢熟悉'} · ${v.caution>.5?'谨慎一些':'更大胆'} · ${v.sociability>.5?'喜欢热闹':'偏爱安静'}`,`${v.curiosity>.5?'Curious':'Unhurried'} · ${v.caution>.5?'Cautious':'Adventurous'} · ${v.sociability>.5?'Sociable':'Quiet'}`);}
  function habitName(habit){
    if(!english())return habit.label??MEMORY_LABELS[habit.kind]?.[habit.target]??habit.target;
    if(habit.kind==='sound'){const [sound,context]=habit.target.split(':');return `${{rain:'Rain',wind:'Wind',footstep:'Footsteps',chime:'Chime'}[sound]??sound} ${context==='rest'?'while resting':'while active'}`;}
    return {racer:'Pixel Road',breakout:'Brick Bounce',invaders:'Star Patrol',rest:'Resting pod',feed:'Food station',work:'Workstation',garden:'Window',flight:'Open space',entry:'Shallow pool',perch:'Canopy',nook:'Bookshelf nook',toilet:'Toilet',fig:'Fig',chime:'Chime'}[habit.target]??habit.target.replace(/^./,letter=>letter.toUpperCase());
  }
  function milestoneText(m){
    if(!english())return m.text;
    if(m.kind==='growth')return m.target==='mature'?'Reached its mature size through real meals, rest and active life.':'Its body has noticeably grown since adoption.';
    if(m.kind==='relationship')return 'Repeated care led to real recovery, making familiar care cues more reassuring.';
    if(m.kind==='toy')return 'Became more practiced at Pixel Road through real play sessions.';
    if(m.kind==='cue')return 'Several chimes were followed by real, comfortable experiences; the connection is becoming familiar.';
    if(m.kind==='habit'){const [kind,...target]=m.target.split(':');return `${m.id.endsWith('negative')?'Became more cautious around':'Developed a lasting preference for'} ${habitName({kind,target:target.join(':')})} after spaced experiences.`;}
    return `First real experience with ${habitName({kind:m.id.includes('-food-')?'food':'game',target:m.target})}.`;
  }
  function renderGrowth(c){
    const g=growthSummary(c),d=c.developmentSummary??developmentSummary(c);
    const stage={newborn:t('初养','New arrival'),growing:t('成长中','Growing'),mature:t('成熟','Mature')}[g.stage];
    $('#companion-growth-stage').textContent=stage;
    $('#companion-growth-size').textContent=t(`体长是初领时的 ${g.relativeSize.toFixed(2)} 倍`,`Body length: ${g.relativeSize.toFixed(2)}× at adoption`);
    $('#companion-growth-note').textContent=g.stage==='mature'?t('已经长到成熟体型。接下来的日子，继续积累自己的习惯。','At its mature size. The days ahead still bring new habits.')
      :t('同样的参照，同样的镜头。吃到食物、好好休息，才会慢慢长大；离线时暂停。','The same reference and camera. Real meals and rest support gradual growth; offline time is paused.');
    $('#companion-growth-portrait').setAttribute('aria-label',t(`初领与现在的同尺度体型对照，当前为初领体长的 ${g.relativeSize.toFixed(2)} 倍`,`Size comparison at a fixed scale. Current body length is ${g.relativeSize.toFixed(2)} times its adoption length.`));
    const relationship=d.relationship;
    $('#companion-relationship').textContent=english()?{new:'Getting acquainted',familiar:'Growing familiar',trusted:'Comfortable together'}[relationship.stage]:relationship.label;
    $('#companion-relationship-note').textContent=relationship.encounters?t(`${relationship.encounters} 次产生真实结果的相处，留在了记忆里。`,`${relationship.encounters} interactions with real outcomes are remembered.`):t('让照顾带来真实的恢复，熟悉感会慢慢留下。','Care that leads to real recovery gradually builds familiarity.');
    const toy=d.toy;
    $('#companion-toy').textContent=t('像素公路 · ','Pixel Road · ')+(english()?{new:'First explorations',exploring:'Getting practiced',practiced:'Practiced player'}[toy.stage]:toy.label);
    $('#companion-toy-note').textContent=toy.sessions?t(`${toy.sessions} 次分散游玩，实际操作 ${Math.floor(toy.practiceSeconds/60)} 分钟。`,`${toy.sessions} spaced sessions, ${Math.floor(toy.practiceSeconds/60)} minutes of actual play.`):t('到了工作台，自己上手玩过，才会积累熟练。','Practice grows only when it actually plays at the workstation.');
    const expanded=new Set([...$('#companion-preferences').querySelectorAll('details[open]')].map(el=>el.dataset.habit));
    const habitRows=d.habits.map(h=>{
      const e=habitEvidence(h,c.activeSeconds),row=child('details','','companion-habit');row.dataset.habit=`${h.kind}:${h.target}`;row.open=expanded.has(row.dataset.habit);
      row.append(child('summary',`${habitName(h)} · ${e.established?(e.direction==='preference'?t('形成偏好','A lasting preference'):t('学会谨慎','Learned caution')):t('正在形成','Taking shape')} · ${e.count} ${t('次','experiences')}`));
      row.append(child('p',t(`倾向：${e.direction==='preference'?'偏爱':e.direction==='caution'?'谨慎':'尚不明确'} · 证据积累 ${e.confidence}%`,`Direction: ${e.direction} · evidence coverage ${e.confidence}%`),'companion-fine'));
      row.append(child('p',t(`首次：生活第 ${e.firstMinute} 分钟；最近：第 ${e.lastMinute} 分钟。每次有效记录至少间隔 ${e.spacing/60} 分钟。`,`First: active minute ${e.firstMinute}; latest: ${e.lastMinute}. Experiences are recorded at least ${e.spacing/60} active minutes apart.`),'companion-fine'));
      row.append(child('p',e.established?t('多次分散经历已经形成倾向；新的体验仍可能逐渐改变它。','Spaced experiences established a tendency; future experiences may gradually change it.'):
        t(`稳定习惯需要至少 3 次有效经历、跨越 4 分钟并保持明确倾向。目前还需 ${e.neededCount} 次，时间跨度还差 ${Math.ceil(e.neededSpan/60)} 分钟。`,`A lasting habit needs at least 3 spaced experiences over 4 active minutes and a clear tendency. Still needs ${e.neededCount} experiences and ${Math.ceil(e.neededSpan/60)} minutes of span.`),'companion-fine'));
      return row;
    });
    $('#companion-preferences').replaceChildren(...(habitRows.length?habitRows:[child('p',t('还没有有效习惯记录。实际活动留下感受，再由多次经历慢慢形成习惯。','No habit evidence yet. Actual activity leaves impressions that can grow into habits.'),'companion-muted')]));
    const milestones=[...d.milestones].reverse();
    $('#companion-milestones').replaceChildren(...(milestones.length?milestones.slice(0,12).map(m=>child('li',`${Math.floor(m.at/60)} ${t('分钟','min')} · ${milestoneText(m)}`)):[child('li',t('第一次相遇，也是故事的开始。','A first hello is where the story begins.'))]));
    $('#companion-milestone-history').hidden=milestones.length<=12;
    $('#companion-milestone-history-label').textContent=t(`更早的 ${Math.max(0,milestones.length-12)} 个重要时刻`,`${Math.max(0,milestones.length-12)} earlier milestones`);
    $('#companion-milestones-older').replaceChildren(...milestones.slice(12).map(m=>child('li',`${Math.floor(m.at/60)} ${t('分钟','min')} · ${milestoneText(m)}`)));
    if($('#companion-dialog').open){
      if(!portrait||portraitSeed!==c.identity.seed){portrait?.dispose();portrait=null;try{portrait=createGrowthPortrait($('#companion-growth-portrait'),c.identity.seed);portraitSeed=c.identity.seed;$('#companion-growth-status').textContent='';}catch{$('#companion-growth-status').textContent=t('体型对照暂不可用，可以继续近看它。','Size portrait is temporarily unavailable. You can still look closer.');}}
      portrait?.update(c);
    }
    $('#companion-growth-export').disabled=!portrait;
    if(growthNotice==='saved')$('#companion-growth-status').textContent=t('成长卡已保存。','Growth card saved.');
  }
  function render(){
    const c=state?.companion;localize();renderPersistence();if(!c)return;
    const bank=voiceBankFor(c.identity.seed,c.voice.bank),bankName=english()?bank.en:bank.name;
    for(const id of ['adoption-traits','companion-traits'])$('#'+id).replaceChildren(...appearanceLabels(c.identity.seed,english()).map(v=>child('span',v)));
    $('#adoption-temperament').textContent=temperament(c);$('#adoption-voice-name').textContent=t('声音：','Voice: ')+bankName;
    $('#companion-title').textContent=c.identity.name||t('等待取名','Waiting for a name');
    $('#companion-age').textContent=t('一起生活了 ','Together for ')+Math.floor(c.activeSeconds/3600)+t(' 小时 ',' h ')+Math.floor(c.activeSeconds/60)%60+t(' 分钟',' min');
    $('#companion-id').textContent='ID '+c.identity.id;
    if(document.activeElement!==$('#companion-name'))$('#companion-name').value=c.identity.name;
    $('#companion-temperament').textContent=temperament(c);
    renderGrowth(c);
    $('#companion-memories').replaceChildren(...(c.memories.length?[...c.memories].reverse().slice(0,8).map(m=>child('li',english()?`${Math.floor(m.at/60)} min · ${m.target} · ${m.reward>=0?'A comfortable experience':'An uneasy experience'}`:`${Math.floor(m.at/60)} 分钟 · ${m.text}`)):[child('li',t('第一次相遇，也是故事的开始。','A first hello is where the story begins.'))]));
    $('#companion-voice-name').textContent=bankName+' · '+(english()?bank.personaEn:bank.persona);$('#companion-voice-enabled').checked=c.voice.enabled;
    if(document.activeElement!==$('#companion-volume'))$('#companion-volume').value=String(Math.round(c.voice.volume*100));
    try{$('#companion-recover').disabled=!recoveryBackup();}catch(error){$('#companion-recover').disabled=true;backupStatus.textContent=error.message;}
    updateInteractions();
  }
  function refresh(){state=getState()??state;render();}
  settingsDialog.addEventListener('settings-open',refresh);
  button.addEventListener('click',()=>{$('#companion-dialog').showModal();render();});
  $('#companion-close').addEventListener('click',()=>$('#companion-dialog').close());
  $('#companion-focus').addEventListener('click',()=>{$('#companion-dialog').close();window.dispatchEvent(new CustomEvent('companion-focus'));});
  $('#companion-growth-export').addEventListener('click',async()=>{const control=$('#companion-growth-export');control.disabled=true;try{if(!portrait||!state?.companion)throw Error(t('请先打开体型对照。','Open the size portrait first.'));portrait.update(state.companion);await exportGrowthCard(state.companion,portrait,{english:english()});growthNotice='saved';$('#companion-growth-status').textContent=t('成长卡已保存。','Growth card saved.');}catch(error){growthNotice=null;$('#companion-growth-status').textContent=error.message;}finally{control.disabled=!portrait;}});
  $('#adoption-dialog').addEventListener('cancel',event=>event.preventDefault());
  $('#adoption-form').addEventListener('submit',async event=>{
    event.preventDefault();const submit=$('#adoption-submit');submit.disabled=true;
    try{const name=validName($('#adoption-name').value);state=await api('/api/companion',{type:'adopt',value:name});
      state=await api('/api/companion',{type:'voice',value:{enabled:$('#adoption-voice').checked,volume:.7}});
      $('#adoption-dialog').close();preview?.dispose();preview=null;
      window.dispatchEvent(new CustomEvent('companion-adopted',{detail:{id:state.companion.identity.id}}));
      if(state.companion.voice.enabled)await voice.preview(state);render();
    }catch(error){$('#adoption-error').textContent=error.message;if(state?.companion?.identity.adoptedAt)toast(t('已经领养，声音设置暂未完成。可在设置中调整。','Adopted successfully; voice setup is incomplete. Adjust it in Settings.'));}finally{submit.disabled=false;}
  });
  $('#companion-rename').addEventListener('submit',async event=>{event.preventDefault();try{state=await api('/api/companion',{type:'rename',value:validName($('#companion-name').value)});render();const p=getPersistence();toast(p.status==='degraded'?t('名字已保存；恢复快照暂未更新，请导出备份。','Name saved; recovery snapshots have not updated. Export a backup.'):p.error?t('名字已修改；自动保存异常，请导出备份。','Name changed; automatic save failed. Export a backup.'):t('名字已保存。','Name saved.'));}catch(e){$('#companion-status').textContent=e.message;}});
  const saveVoice=async event=>{try{$('#companion-audio-status').textContent='';state=await api('/api/companion',{type:'voice',value:{enabled:$('#companion-voice-enabled').checked,volume:Number($('#companion-volume').value)/100}});if(!state.companion.voice.enabled)voice.stop();else if(event.target.id==='companion-voice-enabled')await voice.preview(state);else voice.setVolume(state.companion.voice.volume);}catch(e){$('#companion-audio-status').textContent=e.message;}};
  $('#companion-voice-enabled').addEventListener('change',saveVoice);$('#companion-volume').addEventListener('change',saveVoice);
  $('#companion-listen').addEventListener('click',async()=>{if(!state)return;try{if(voice.diagnostics().playing){$('#companion-audio-status').textContent=t('它还在说话，等这句说完。','Let this sentence finish.');return;}$('#companion-audio-status').textContent=await voice.preview(state)?t('正在播放这只果蝇的声音。','Playing this companion’s voice.'):t('点按试听以启用声音，或检查音频资源。','Tap to enable sound, or check the audio files.');}catch(e){$('#companion-audio-status').textContent=e.message;}});
  for(const el of interactionButtons)el.addEventListener('click',()=>{void command(el.dataset.companionAction);});
  $('#companion-export').addEventListener('click',async()=>{try{backupStatus.textContent='';let text;try{text=await exportCompanion();}catch{text=rawCompanionBackup();}if(!text)throw Error(t('没有可导出的存档。','No save to export.'));download(text,'fruit-fly-'+(state?.companion?.identity.id??'recovery')+'.json');backupStatus.textContent=t('备份已导出。','Backup exported.');}catch(e){backupStatus.textContent=e.message;}});
  for(const id of ['companion-import','adoption-import'])$('#'+id).addEventListener('click',()=>$('#companion-file').click());
  $('#companion-file').addEventListener('change',async event=>{try{const file=event.target.files[0];if(!file)return;backupStatus.textContent='';$('#adoption-error').textContent='';if(file.size>256000)throw Error(t('备份文件过大。','Backup file is too large.'));const text=await file.text();
    if(state?.companion?.identity.adoptedAt&&!confirm(t('导入将替换当前果蝇，原存档会保留为恢复副本。继续？','Import will replace this companion and keep a recovery copy. Continue?')))return;
    await importCompanion(text);
  }catch(e){backupStatus.textContent=e.message;$('#adoption-error').textContent=e.message;toast(e.message);}finally{event.target.value='';}});
  $('#companion-recover').addEventListener('click',async()=>{try{backupStatus.textContent='';const backup=recoveryBackup();if(backup&&confirm(t('恢复上一次导入前的果蝇？','Restore the companion saved before the last import?')))await importCompanion(backup);}catch(e){backupStatus.textContent=e.message;}});
  localize();
  return {update(next){
    if(disposed||!next.companion)return;state=next;
    const c=next.companion;
    if(c.identity.adoptedAt&&$('#adoption-dialog').open){$('#adoption-dialog').close();preview?.dispose();preview=null;}
    for(const el of document.querySelectorAll('.resident-name')){el.dataset.noLocale='';el.textContent=c.identity.name||t('小家伙','Little one');}
    voice.update(next);updateInteractions();
    if(!c.identity.adoptedAt&&!$('#adoption-dialog').open){$('#adoption-dialog').showModal();render();
      if(previewSeed!==c.identity.seed||!preview){preview?.dispose();try{preview=createCompanionPreview($('#adoption-preview'),c.identity.seed);previewSeed=c.identity.seed;}catch{toast(t('三维预览暂不可用，仍可领养。','Preview unavailable; adoption still works.'));}}
    }
    if(performance.now()>renderAt||lang!==document.documentElement.lang){renderAt=performance.now()+1000;lang=document.documentElement.lang;if($('#companion-dialog').open||$('#adoption-dialog').open||settingsDialog.open)render();else localize();}
  },refresh,diagnostics:()=>({id:state?.companion?.identity.id,adopted:Boolean(state?.companion?.identity.adoptedAt),adoptionOpen:$('#adoption-dialog').open,growth:state?.companion?growthSummary(state.companion):null,portraitReady:Boolean(portrait),...voice.diagnostics()}),dispose(){disposed=true;settingsDialog.removeEventListener('settings-open',refresh);preview?.dispose();portrait?.dispose();voice.dispose();}};
}
