import {browserLife,localApi,subscribeLife,retryLife,getPersistence} from './browser-life.mjs';
import {setupCompanionUi} from './companion-ui.mjs';
import {setupPetCareUi} from './pet-care-ui.mjs';
import {setupHomeAtmosphere} from './home-atmosphere.mjs';
import {setupLocalization} from './localization.mjs';
import {setupHud} from './hud-controls.mjs';
import {setupUiOrganization} from './ui-organization.mjs';
import {setupHomeOnboarding} from './home-onboarding.mjs';
import {NEED_METERS, needScore} from './need-display.mjs';
import {collisionInfo} from './collision-world.mjs';
import { CARTRIDGES, drawArcade } from './arcade.mjs';
import { ZONES, ZONE_BY_ID, VERSION } from './world-spec.mjs';
import { createHomeScene } from './scene.mjs';
import { createBrainView } from './brain-view.mjs';
import { createNeuralPanel } from './neural-panel.mjs';
const $ = selector => document.querySelector(selector);
setupHud();
setupLocalization();
let snapshot = null, homeScene = null, connected = false, events = null, updateRequired = false;
let selectedZone = 'flight', currentView = 'follow', toastTimer, lastHistorySignature = '';
const commandBusy = new Set();
let nextSenseSummaryAt=0;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const brainView = createBrainView($('#brain-canvas'));
const neuralPanel = createNeuralPanel();
const companionUi=setupCompanionUi({api,getState:()=>snapshot,command,toast});
const atmosphere=setupHomeAtmosphere({api,command});
function updateControlStates() {
  document.querySelectorAll('[data-command]').forEach(button => {
    const remaining = finite(snapshot?.cooldowns?.[button.dataset.command]);
    button.disabled = !connected || commandBusy.has(button.dataset.command) || remaining > 0;
    button.title = remaining > 0 ? `请稍等 ${Math.ceil(remaining)} 秒` : '留一点小惊喜';
  });
  document.querySelectorAll('[data-speed],#pause-button').forEach(button => {
    button.disabled = !connected || commandBusy.has('speed') || commandBusy.has('pause');
  });
  document.querySelectorAll('#daytime,#screen-toggle,#leave-game,[data-disturbance]').forEach(el => { el.disabled = !connected || ['daytime','screen','leave-game','disturbance'].some(k => commandBusy.has(k)); });
  $('#game-cartridge').disabled = !connected || commandBusy.has('game');
  if (!connected) { brainView.disconnect(); neuralPanel.disconnect(); }
}
async function api(path, body, timeout = 15000) {
  if(browserLife)return localApi(path,body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
      cache: 'no-store', signal: controller.signal,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    let result;
    try { result = await response.json(); }
    catch { throw Object.assign(new Error('服务响应尚未确认，请稍后重试。'), { uncertain: true }); }
    if (!response.ok) throw Object.assign(new Error(typeof result?.error === 'string' ? result.error : '操作未完成'),
      { status: response.status, uncertain: response.status >= 500 });
    return result;
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error('等待服务超时，操作结果尚未确认。'), { uncertain: true });
    if (error instanceof TypeError) throw Object.assign(new Error('无法连接本地服务，操作结果尚未确认。'), { uncertain: true });
    throw error;
  } finally { clearTimeout(timer); }
}

const needNames = Object.fromEntries(Object.entries(NEED_METERS).map(([key,meter])=>[key,meter.label]));
for (const [key, label] of Object.entries(needNames)) {
  const element = document.createElement('div');
  element.className = 'need';
  element.title=NEED_METERS[key].hint;
  element.tabIndex=0; element.setAttribute('aria-label',label+'：'+NEED_METERS[key].hint);
  element.innerHTML = `<div class="need-header"><label for="need-${key}">${label}</label><output id="need-${key}">—</output></div><div class="need-track"><div class="need-fill" data-need="${key}"></div></div><small class="need-help">${NEED_METERS[key].hint}</small>`;
  $('#care-needs').append(element);
}
const petCareUi=setupPetCareUi(command,()=>!connected||commandBusy.has('care'));
setupUiOrganization();
const onboarding=browserLife?setupHomeOnboarding():null;
const lifeRetry=document.createElement('button');lifeRetry.id='life-retry';lifeRetry.type='button';lifeRetry.dataset.noLocale='';lifeRetry.textContent='重新连接生活 / Retry';lifeRetry.hidden=true;$('#settings-connection').after(lifeRetry);
lifeRetry.addEventListener('click',async()=>{lifeRetry.disabled=true;try{await retryLife();}catch(error){toast(error.message);}finally{lifeRetry.disabled=false;}});
// Refresh custom button labels immediately, including while life is paused.
document.querySelectorAll('[data-language]').forEach(button=>button.addEventListener('click',()=>{if(snapshot)petCareUi.update(snapshot);companionUi.refresh?.();}));
for (const zone of ZONES.filter(z=>!z.decorative)) {
  const button = document.createElement('button');
  button.className = 'zone-button';
  button.dataset.zone = zone.id;
  button.textContent = zone.name;
  button.addEventListener('click', () => selectZone(zone.id));
  $('#zone-grid').append(button);
}
function selectZone(id, focus = true) {
  const zone = ZONE_BY_ID[id];
  if (!zone) return;
  selectedZone = id;
  $('#zone-caption span').textContent = zone.name;
  $('#zone-caption p').textContent = zone.description;
  document.querySelectorAll('[data-zone]').forEach(button => {
    button.classList.toggle('active', button.dataset.zone === id);
    button.setAttribute('aria-pressed', String(button.dataset.zone === id));
  });
  if (focus) { homeScene?.focusZone(id); setViewButtons(null); }
}
function setViewButtons(mode) {
  currentView = mode || 'zone';
  $('.room-panel').dataset.cameraView = currentView;
  $('.orbit-hint').textContent = mode === 'first' ? '镜隙的视线' : mode === 'follow' ? '自动跟随 · 拖动可自由观察' : '拖动环顾 · 滚轮靠近';
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  homeScene?.setView(button.dataset.view); setViewButtons(button.dataset.view);
}));
window.addEventListener('companion-focus',()=>{homeScene?.setView('follow');setViewButtons('follow');});
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}
function showConnection(value) {
  connected = value && !updateRequired;
  $('#connection').classList.toggle('offline', !connected);
  $('#connection').replaceChildren(document.createElement('i'), document.createTextNode(updateRequired ? '页面待更新' : connected ? '镜隙在家' : '连接中断 · 重连中'));
  updateControlStates();
  if(snapshot)petCareUi.update(snapshot);
  lifeRetry.hidden=!browserLife||connected||!getPersistence().canRetry;
  if (!value) {$('#save-status').textContent = '连接中断，存档已保留；可在设置中重试';companionUi.refresh?.();}
}
function clockText(clock) {
  const hour = Number(clock?.hour || 0);
  const whole = Math.floor(hour) % 24;
  const minute = clock?.minute ?? Math.floor((hour - Math.floor(hour)) * 60 + 1e-6);
  return `${String(whole).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
function historyTime(item) {
  if (typeof item.at === 'string') return item.at;
  if (typeof item.at === 'object' && item.at) return clockText(item.at);
  return clockText({ hour: (9 + Number(item.at || 0) / 60) % 24 });
}
function applyState(state) {
  if(state?.version!==VERSION||state.collision?.digest!==collisionInfo.digest){
    if(snapshot)snapshot={...snapshot,paused:true};
    updateRequired=true;showConnection(false);
    $('#update-notice').hidden=false;$('#activity-title').textContent='新版已就绪，刷新后继续';return;
  }
  updateRequired=false;
  $('#update-notice').hidden=true;
  $('#home-canvas').style.visibility='';
  if (!state?.actor || !state?.needs || !state?.activity || !state?.clock) throw new Error('生活状态不完整。');
  snapshot = state;
  companionUi.update(state);
  showConnection(true);
  $('#daytime').hidden = !state.server?.testing;
  $('.speed-switch').hidden = !state.server?.testing;
  const work = state.living?.workstation;
  if (work) {
    $('#screen-toggle').textContent = work.enabled ? '关闭屏幕' : '打开屏幕';
    $('#leave-game').hidden = work.phase !== 'playing';
    $('#game-cartridge').value=work.gameId;
    $('#game-cartridge').disabled=!connected||commandBusy.has('game');
    const title=CARTRIDGES[work.gameId]??work.gameId;
    $('#desk-state').textContent = !work.enabled ? '屏幕已关，屋里安静了一点。' : ({ idle: `${title} · 等他停下来发现`, attention: '镜隙正在关注屏幕', playing: `${title} · 第 ${work.arcade?.round??1} 局 · ${work.arcade?.score??0} 分`, resting: '暂时离开屏幕，休息一会儿' })[work.phase];
    $('#arcade-preview').hidden=!work.enabled;
    // The actual desk screen is rendered by the scene; this second canvas is
    // useful only while the environment drawer is open and the tab is visible.
    if (work.enabled && !document.hidden && !$('#habitat-tools').hidden) {
      drawArcade($('#arcade-preview').getContext('2d'),work.arcade,{idle:work.phase!=='playing',title:({racer:'PIXEL ROAD',breakout:'BRICK & BOUNCE',invaders:'STAR PATROL'})[work.gameId]});
    }
    const c = state.living.clock;
    $('#daytime').value = c.mode === 'preview' ? ({ 0: 'night', 6: 'dawn', 12: 'day', 18: 'dusk' })[c.hour] : c.mode;
    const names = { odor: '果香', light: '光线', shelter: '安静角落', humidity: '水汽', water: '水源', space: '开阔空间', contrast: '屏幕', vibration: '振动', texture: '落脚处', airflow: '微风', threat: '惊扰', touch: '接触', 'visual-error': '屏幕光点',sanitation:'厕所气味' };
    const signals = [...(state.neural?.sensory?.signals ?? [])].filter(s => s.intensity > .04).sort((a,b)=>b.intensity-a.intensity).slice(0,3);
    if(performance.now()>=nextSenseSummaryAt){
      nextSenseSummaryAt=performance.now()+2000;
      const focusNames={eat:'吃东西',drink:'喝水',rest:'休息',clean:'清洁',toilet:'上厕所',play:'想玩一会儿',observe:'想看看窗外',explore:'自由探索'};
      const target=state.neural?.sensory?.signals?.find(s=>s.id===state.living.navigation?.targetId);
      const attention=focusNames[state.living.focus?.action];
      $('#sense-summary').textContent=attention?[attention,target?.label??(target?names[target.kind]:null)].filter(Boolean).join(' · ')
        :(signals.map(s=>s.label??names[s.kind]??s.kind).join(' · ')||'安静的空气');
    }
  }
  petCareUi.update(state);
  brainView.update(state.neural, connected);
  neuralPanel.update(state,connected);
  $('#demo-time-controls > span').textContent=state.clock.mode==='cycle'?'自主昼夜 · 1×':'北京时间 · 1×';
  document.querySelector('label[for=daytime]').textContent=state.clock.mode==='cycle'?'自主昼夜':'北京时间 · 现实昼夜';
  $('#house-clock').textContent = state.clock.mode==='cycle'?`第 ${Math.floor((snapshot.simSeconds/60+9)/24)+1} 天 · ${clockText(state.clock)} 自主昼夜`:`${state.clock.date} · ${clockText(state.clock)}`;
  $('#activity-title').textContent = state.paused ? '生活已暂停' : state.activity.title;
  $('#activity-reason').textContent = state.activity.reason;
  $('#live-action').textContent = state.paused ? '时间暂停在这一刻' : `镜隙 · ${state.activity.title}`;
  for (const key of Object.keys(needNames)) {
    const number = needScore(state,key);
    $(`#need-${key}`).textContent = number===null?'—':`${number}`;
    $(`[data-need="${key}"]`).style.width = `${number??0}%`;
    $(`#need-${key}`).closest(".need").dataset.level=number===null?"unknown":number<25?"low":"normal";
  }
  document.querySelectorAll('[data-zone]').forEach(button => button.classList.toggle('occupied', button.dataset.zone === state.actor.zoneId));
  document.querySelectorAll('[data-speed]').forEach(button => {
    const active = Number(button.dataset.speed) === state.speed;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('#pause-button').textContent = state.paused ? '继续生活' : '暂停生活';
  updateControlStates();
  const history = state.history || [];
  const signature = history.map(item => item.id).join(',');
  if (signature !== lastHistorySignature) {
    lastHistorySignature = signature;
    $('#journal').replaceChildren();
    for (const item of [...history].reverse().slice(0, 12)) {
      const line = document.createElement('li');
      const time = document.createElement('time');
      time.textContent = historyTime(item);
      const description = document.createElement('p');
      description.textContent = item.text;
      line.append(time, description); $('#journal').append(line);
    }
  }
  $('#save-status').textContent = browserLife&&state.server?.persistence?.status==='degraded' ? '生活已保存，恢复快照暂未更新' : state.server?.persistenceError ? (browserLife ? '自动保存失败，请立即导出备份' : '存档失败，请检查服务日志') : state.server?.lastSavedAt ? '生活已自动保存' : '等待保存';
}
async function command(type, value) {
  if (!connected || commandBusy.has(type)) return;
  commandBusy.add(type); updateControlStates();
  try {
    applyState(await api('/api/command', { type, value }));
    if (type === 'feed') toast('补给台添上了食物。');
    if (type === 'mist') toast('花园落下一阵细雾。');
    if (type === 'chime') toast('风铃轻轻响了一声。');
  } catch (error) { toast(error.message); }
  finally { commandBusy.delete(type); updateControlStates(); }
}
document.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => { void command(button.dataset.command); }));
document.querySelectorAll('[data-speed]').forEach(button => button.addEventListener('click', () => { void command('speed', Number(button.dataset.speed)); }));
document.querySelectorAll('[data-disturbance]').forEach(button => button.addEventListener('click', () => { void command('disturbance', button.dataset.disturbance); }));
$('#daytime').addEventListener('change', e => { void command('daytime', e.target.value); });
$('#screen-toggle').addEventListener('click', () => { void command('screen', !snapshot?.living?.workstation.enabled); });
$('#game-cartridge').addEventListener('change',event=>{void command('game',event.target.value);});
$('#leave-game').addEventListener('click', () => { void command('leave-game'); });
$('#pause-button').addEventListener('click', () => { void command('pause', !snapshot?.paused); });
function openStateStream() {
  events?.close();
  if(browserLife){events=subscribeLife(applyState,error=>{showConnection(false);toast(error.message);});return;}
  events = new EventSource('/api/stream');
  events.onmessage = event => {
    try { const state = JSON.parse(event.data); applyState(state); }
    catch (error) { console.error('Invalid home state', error); showConnection(false); }
  };
  events.onerror = () => showConnection(false);
}
async function fullscreen() {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { toast('当前浏览器不支持全屏，可以拖动和缩放查看。'); }
}
$('#reload-home').addEventListener('click',()=>location.reload());
$('#fullscreen-button').addEventListener('click', fullscreen);
document.addEventListener('keydown', event => { if (event.key.toLowerCase() === 'f' && !event.ctrlKey && !event.metaKey && !document.querySelector('dialog[open]') && !['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) { event.preventDefault(); void fullscreen(); } });
function openAbout() { if (!$('#about-dialog').open) $('#about-dialog').showModal(); }
$('#about-button').addEventListener('click', openAbout);
$('#close-dialog').addEventListener('click', () => $('#about-dialog').close());
const exportButton = document.createElement('button');
exportButton.id = 'export-character';
exportButton.className = 'pause-button';
exportButton.textContent = '导出果蝇三维模型 · GLB';
$('#settings-about-links').append(exportButton);
const exportStatus=document.createElement('p');
exportStatus.id='export-model-status';exportStatus.setAttribute('role','status');exportStatus.className='section-description';
$('#settings-about-links').after(exportStatus);
exportButton.addEventListener('click', async () => {
  if (!homeScene?.exportCharacter) {exportStatus.textContent='房间还未加载完成。';return;}
  exportButton.disabled = true;
  exportStatus.textContent='正在准备三维模型…';
  try {
    const result = await homeScene.exportCharacter();
    const objectUrl = URL.createObjectURL(result instanceof Blob ? result : new Blob([result], { type:'model/gltf-binary' }));
    const link = document.createElement('a');
    link.href = objectUrl; link.download = `mirror-gap-v${VERSION}.glb`; link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    exportStatus.textContent='已导出分件三维模型。生活动作由应用驱动。';
  } catch (error) { exportStatus.textContent=`模型导出未完成：${error.message}`; }
  finally { exportButton.disabled = false; }
});
$('#about-dialog').addEventListener('click', event => { if (event.target === $('#about-dialog')) { const rect = event.target.getBoundingClientRect(); if(event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });

selectZone(selectedZone, false);
showConnection(false);
openStateStream();
window.render_game_to_text = () => JSON.stringify({ version:VERSION, connected, view:currentView, selectedZone,
  coordinateSystem:'origin room center; x right, y up, z front; units scene metres', ...(snapshot || {}),
  neuralView:brainView.diagnostics(), neuralPanel:neuralPanel.diagnostics(), companionUi:companionUi.diagnostics(), atmosphere:atmosphere.diagnostics(), rendering:homeScene?.getDiagnostics?.() ?? null });
// Renderer stepping only: authoritative life is tested directly in simulation.test.mjs.
window.advanceTime = async ms => {
  try { const state = await api('/api/state'); applyState(state); }
  catch (error) { toast(error.message); }
  if (snapshot) homeScene?.update(snapshot, Math.min(Math.max(finite(ms) / 1000, 0), .5));
};
let previous = performance.now();
let frame = 0, rateFrames=0, rateStarted=performance.now();
try {
  homeScene = await createHomeScene($('#home-canvas'), { onZoneSelect:id => selectZone(id, false), onViewChange:setViewButtons });
  homeScene.setView('follow'); setViewButtons('follow');
  $('#loading').hidden = true;
  document.body.dataset.scene = 'ready';
  const resize = new ResizeObserver(() => homeScene.resize());
  resize.observe($('.room-panel'));
  function animate(now) {
    const dt = Math.min((now - previous) / 1000, .5); previous = now;
    if (snapshot && !document.hidden) {const weather=atmosphere.update(snapshot,companionUi.diagnostics()?.playing);homeScene.update({...snapshot,weather}, dt);}
    rateFrames++;if(now-rateStarted>=1000){const r=homeScene.getDiagnostics();$('#render-rate').textContent=`${Math.round(rateFrames*1000/(now-rateStarted))} FPS · ${r.softwareRenderer?'轻量渲染':'硬件渲染'}`;$('#render-rate').title=`当前窗口实测 · ${r.gpuName} · P95 ${r.frameP95Ms.toFixed(1)}ms`;rateFrames=0;rateStarted=now;}
    frame = requestAnimationFrame(animate);
  }
  frame = requestAnimationFrame(animate);
  window.addEventListener('pagehide', () => { events?.close(); onboarding?.dispose(); brainView.dispose(); neuralPanel.dispose(); companionUi.dispose(); atmosphere.dispose(); cancelAnimationFrame(frame); resize.disconnect(); homeScene.dispose(); }, { once:true });
} catch (error) {
  $('#loading').hidden = true;
  $('#scene-error').hidden = false;
  $('#scene-error-text').textContent = `请确认浏览器已开启硬件加速。${error.message}`;
  document.body.dataset.scene = 'error';
  console.error(error);
}
