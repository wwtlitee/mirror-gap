import { createMirrorCoopClient } from './mirror-coop-client.mjs';
import { createHomeScene } from './scene.mjs';
import { deriveCoopPresentation,derivePairingPresentation } from './coop-presentation.mjs';

const $ = selector => document.querySelector(selector);
const signalButtons = [...document.querySelectorAll('[data-signal]')];
const menuFeedback = document.createElement('p'); menuFeedback.className = 'muted'; menuFeedback.setAttribute('role', 'status'); $('#menu-dialog form').append(menuFeedback);
const soundButton=document.createElement('button');soundButton.type='button';soundButton.textContent='声音 · 开启';soundButton.setAttribute('aria-pressed','true');$('#menu-dialog .button-row').append(soundButton);
const verificationSection=document.createElement('section');verificationSection.className='circuit-verification';
const verificationButton=document.createElement('button');verificationButton.type='button';verificationButton.textContent='核对电路来源';
const verificationStatus=document.createElement('p');verificationStatus.className='muted';verificationStatus.setAttribute('role','status');verificationStatus.textContent='本地电路运行 · 本次尚未联网核验';
const receiptButton=document.createElement('button');receiptButton.type='button';receiptButton.textContent='下载核验收据';receiptButton.hidden=true;
verificationSection.append(verificationButton,verificationStatus,receiptButton);$('#menu-dialog .button-row').before(verificationSection);
const trialSection=document.createElement('section');trialSection.className='trial-menu';trialSection.hidden=true;
const trialDescription=document.createElement('p');trialDescription.textContent='室友继续生活，这一段另记成绩。';
const trialHistory=document.createElement('p');trialHistory.className='muted';
const trialButtons=document.createElement('div');trialButtons.className='button-row';
const courierButton=document.createElement('button');courierButton.type='button';courierButton.textContent='搬运试炼';
const signalTrialButton=document.createElement('button');signalTrialButton.type='button';signalTrialButton.textContent='信号试炼';
const exitTrialButton=document.createElement('button');exitTrialButton.type='button';exitTrialButton.textContent='结束本次试炼';exitTrialButton.hidden=true;
trialButtons.append(courierButton,signalTrialButton,exitTrialButton);trialSection.append(trialDescription,trialButtons,trialHistory);verificationSection.before(trialSection);
const keys = new Set(), touch = { move: [0, 0], up: false, down: false };
let client = null, scene = null, state = null, subscription = null;
let ready = false, entered = false, disposed = false, booting = false, actionPending = false;
let lastInput = '', selectedSignal = 'off', view = 'follow', followActor = 'mechanical';
let endingDismissed = false, lastStage = '', menuWasPaused = false, noticeSerial = -1;
let milestoneWasOpen = false;
let noticeTimer = null, frameId = 0, previousFrame = performance.now(), inputClock = 0, labelClock = 0;
let soundEnabled=true,audioContext=null,motorOscillator=null,motorGain=null,lastCargo=null,lastCleared=false,lastDiscoveries=0;
let verificationBusy=false,verificationReceipt=null,verificationError=null;
const round = value => Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
const roundPosition = value => Array.isArray(value) ? value.map(round) : null;
const playing = () => entered && ready && !actionPending && !state?.coop?.paused && $('#milestone').hidden && !$('#menu-dialog').open && !$('#new-game-dialog').open;

function startAudio(){
  if(!soundEnabled)return;
  try{
    if(!audioContext){
      const Audio=window.AudioContext??window.webkitAudioContext;if(!Audio)return;
      audioContext=new Audio();motorOscillator=audioContext.createOscillator();motorGain=audioContext.createGain();
      motorOscillator.type='sine';motorOscillator.frequency.value=90;motorGain.gain.value=0;
      motorOscillator.connect(motorGain);motorGain.connect(audioContext.destination);motorOscillator.start();
    }
    void audioContext.resume().catch(()=>{});
  }catch{soundEnabled=false;soundButton.textContent='声音 · 关闭';soundButton.setAttribute('aria-pressed','false');}
}
function tone(frequencies,volume=.035,duration=.16){
  if(!soundEnabled||audioContext?.state!=='running')return;
  const now=audioContext.currentTime;
  frequencies.forEach((frequency,index)=>{
    const oscillator=audioContext.createOscillator(),gain=audioContext.createGain(),at=now+index*.045;
    oscillator.type='sine';oscillator.frequency.value=frequency;gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(volume,at+.012);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
    oscillator.connect(gain);gain.connect(audioContext.destination);oscillator.start(at);oscillator.stop(at+duration+.01);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
  });
}
function updateMotorSound(){
  if(!audioContext||!motorGain)return;
  const speed=Math.hypot(...(state?.coop?.mechanical?.velocity??[0,0,0]));
  const active=soundEnabled&&playing()&&state?.coop?.mechanical?.battery>0&&speed>.01;
  motorGain.gain.setTargetAtTime(active ? .007 : 0,audioContext.currentTime,.06);
  motorOscillator.frequency.setTargetAtTime(90+Math.min(speed,1)*95,audioContext.currentTime,.08);
}
soundButton.addEventListener('click',()=>{soundEnabled=!soundEnabled;soundButton.textContent=`声音 · ${soundEnabled?'开启':'关闭'}`;soundButton.setAttribute('aria-pressed',String(soundEnabled));if(soundEnabled)startAudio();else updateMotorSound();});
function downloadJson(value,filename){
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
verificationButton.addEventListener('click',async()=>{
  if(verificationBusy)return;
  verificationBusy=true;verificationError=null;verificationReceipt=null;verificationButton.disabled=true;receiptButton.hidden=true;
  verificationStatus.textContent='正在联网核对固定电路来源…';
  try{
    const {verifyFrozenTapeout}=await import('./tapeout-verification.mjs');
    const receipt=await verifyFrozenTapeout({onProgress:progress=>{
      const phase={deployment:'处理器与固定网表',xor:'信号身份',latch:'节奏状态'}[progress.phase]??'固定电路';
      verificationStatus.textContent=`正在核对${phase} · ${progress.completed} / ${progress.total}`;
    }});
    if(receipt?.status!=='verified')throw Error('电路来源核验没有完成');
    verificationReceipt=receipt;
    let block;try{block=BigInt(receipt.blockNumber).toString(10);}catch{block=String(receipt.blockNumber??'未知');}
    verificationStatus.textContent=`X Layer 电路来源已核对 · 区块 ${block}`;receiptButton.hidden=false;
  }catch(error){verificationError=(error instanceof Error?error.message:String(error)).slice(0,300);verificationStatus.textContent='联网核验未完成 · 固定电路继续运行';}
  finally{verificationBusy=false;verificationButton.disabled=false;verificationButton.textContent=verificationReceipt?'再次核对来源':'核对电路来源';}
});
receiptButton.addEventListener('click',()=>{if(verificationReceipt)downloadJson(verificationReceipt,'镜隙_TapeOut_来源核验_v8.5.0.json');});

function reportError(error, fatal = false) {
  const message = error instanceof Error ? error.message : String(error);
  $('#error-message').textContent = message;
  $('#failure').hidden = false;
  $('#retry-connection').hidden = !fatal;
  if (fatal) { ready = false; $('#start').disabled = true; }
  if ($('#menu-dialog').open) menuFeedback.textContent = message;
}

async function command(action, payload) {
  if (!client || client.status !== 'ready' || disposed) return null;
  try { return await client.command(action, payload); }
  catch (error) { reportError(error, client.status === 'failed'); return null; }
}

function currentInput() {
  let x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + touch.move[0];
  let z = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) + touch.move[1];
  const length = Math.hypot(x, z); if (length > 1) { x /= length; z /= length; }
  const lift = Number(keys.has('Space') || touch.up) - Number(keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.down);
  const basis=scene?.getMovementBasis?.()??{right:[1,0],forward:[0,-1]};
  const world=[basis.right[0]*x-basis.forward[0]*z,basis.right[1]*x-basis.forward[1]*z],magnitude=Math.max(1,Math.hypot(...world));
  return { move: world.map(value=>Math.max(-1,Math.min(1,value/magnitude))), lift, emit: selectedSignal };
}

function submitInput(force = false) {
  if (!client || client.status !== 'ready' || (!force && !playing())) return Promise.resolve(null);
  const input = currentInput(), encoded = JSON.stringify(input);
  if (!force && encoded === lastInput) return Promise.resolve(null);
  lastInput = encoded;
  return client.flushInput(input).catch(error => { reportError(error, client.status === 'failed'); return null; });
}

function stopInput() {
  keys.clear(); touch.move = [0, 0]; touch.up = false; touch.down = false;
  $('#joystick-thumb').style.transform = '';
  return submitInput(true);
}

async function selectSignal(signal) {
  if (!playing()) return;
  selectedSignal = signal;
  await submitInput(true);
}

function observationText(coop) {
  const result = coop?.probe?.result;
  if (!result) return '你们留下了真实的共同经历；尚未完成本次撤食观察。';
  const pi = result.preferenceIndex;
  const choice = !Number.isFinite(pi) || Math.abs(pi) <= .08 ? '这次没有明显偏向' : `这次更靠近气味 ${pi > 0 ? 'A' : 'B'}`;
  return `${result.completed ? '观察完成' : '观察提前结束'}，${choice}。这次轨迹不代替稳定追随验证。`;
}

function render() {
  if (!state?.coop) return;
  const coop = state.coop, mechanical = coop.mechanical, campaign = coop.campaign ?? {};
  if (coop.stage?.id !== lastStage) { lastStage = coop.stage?.id ?? ''; endingDismissed = false; }
  const presentation=deriveCoopPresentation(coop,{entered,endingDismissed});
  const pairing=derivePairingPresentation(coop);
  const {cleared,campaignComplete:complete,trialActive,trialComplete,milestone}=presentation;
  trialSection.hidden=!presentation.trialsUnlocked;
  courierButton.disabled=signalTrialButton.disabled=actionPending||trialActive;
  exitTrialButton.hidden=!trialActive;exitTrialButton.disabled=actionPending;
  const completedTrials=Array.isArray(coop.trialHistory)?coop.trialHistory.length:0;
  trialHistory.textContent=completedTrials?`已保留 ${completedTrials} 次完成记录。`:'完成后的用时、能耗与失误会单独记录。';
  if(milestone&&!milestoneWasOpen){milestoneWasOpen=true;void stopInput();}
  else if(!milestone)milestoneWasOpen=false;
  $('#arrival').hidden = entered;
  $('#mission').hidden = !entered;
  $('#player-state').hidden = !entered;
  $('#companion').hidden = !entered;
  $('#signals').hidden = !entered || milestone;
  $('#touch-controls').hidden = !entered || milestone;
  $('#keyboard-guide').hidden = !entered || milestone;
  $('#chapter-title').textContent = trialActive ? `自由试炼 · ${presentation.trialTitle}` : `${coop.chapter?.title ?? '共同的家'} · ${String((Number.isInteger(campaign.stage) ? Math.floor(campaign.stage / 2) : 0) + 1).padStart(2, '0')} / 06`;
  $('#stage-title').textContent = coop.stage?.title ?? '共同生活';
  $('#instruction').textContent = coop.stage?.instruction ?? '观察彼此，继续探索这个家。';
  $('#pairing-progress').hidden=!pairing;
  $('#pairing-progress').textContent=pairing?.text??'';
  $('#game').classList.toggle('is-pairing',Boolean(pairing));
  $('#trial-progress').hidden=!trialActive;
  $('#trial-progress').textContent=trialActive?`第 ${coop.trial?.attempt??'—'} 次 · ${Number.isFinite(coop.trial?.elapsed)?coop.trial.elapsed.toFixed(1):'—'} 秒 · 独立记分`:'';
  $('#energy').textContent = `${Math.round(mechanical?.battery ?? 0)}%`;
  $('#energy-meter').value = mechanical?.battery ?? 0;
  $('#cargo').textContent = mechanical?.cargo ? '已携带补给 · 待投递' : '货槽空闲';
  $('#recovery').hidden = !(mechanical?.battery === 0 || mechanical?.recoveredThisStep);
  $('#recovery').textContent = mechanical?.recoveredThisStep ? '已回到最近充能点，补给仍在。' : mechanical?.recoveryLatched ? '回收完成 · 等待充能' : `电量耗尽 · ${Math.max(0, 3 - (mechanical?.emptySeconds ?? 0)).toFixed(1)} 秒后回收`;
  $('#pause').textContent = coop.paused ? '继续' : '暂停';
  $('#pause').setAttribute('aria-label', coop.paused ? '继续游戏，快捷键 P' : '暂停游戏，快捷键 P');
  const actual = coop.circuit?.actual ?? mechanical?.emit ?? 'off';
  const selected = coop.circuit?.selected ?? selectedSignal;
  for (const button of signalButtons) { const active = button.dataset.signal === selected; button.dataset.active = String(active); button.setAttribute('aria-pressed', String(active)); }
  $('#actual-signal').textContent = `实际输出 · ${actual === 'off' ? '关闭' : actual}`;
  const learning = campaign.progress?.learning;
  $('#companion-state').textContent = pairing?.hint??(learning?.changedSynapses > 0 ? '真实进食后，内部突触发生了改变。' : coop.paused ? '此刻休息，身体与记忆保留。' : '它正在自己探索。');
  $('#interact').hidden = !entered || milestone || !coop.interaction || coop.paused;
  $('#interact-label').textContent = coop.interaction?.label ?? '交互';
  $('#touch-interact').disabled = !coop.interaction || coop.paused;
  const probe = coop.probe ?? {}, observing = probe.running === true;
  const probeAvailable = !trialActive&&(coop.stage?.rule?.kind === 'probe' || coop.phase === 'probe' || observing);
  $('#probe-progress').hidden = !entered || !probeAvailable;
  $('#probe-clock').textContent = `撤食观察 ${Number(probe.elapsed ?? 0).toFixed(1)} / ${probe.duration ?? 20} 秒`;
  $('#probe-meter').value = probe.elapsed ?? 0;
  $('#start-probe').hidden = observing;
  $('#end-probe').hidden = !observing;
  $('#swap-probe').hidden = observing || !probe.result;
  $('#milestone').hidden = !milestone;
  $('#milestone-kicker').textContent = trialActive ? `${presentation.trialTitle} · 本次完成` : complete ? '六章共同生活 · 未完待续' : coop.chapter?.title ?? '共同生活';
  $('#milestone-title').textContent = trialActive ? '这一段，留下了成绩。' : complete ? '共同的家，还在继续。' : '一起，又向前一点。';
  const discoveries=Number.isFinite(campaign.stats?.discoveries)?Math.max(0,Math.floor(campaign.stats.discoveries)):0;
  const cargoId=mechanical?.cargo?.id??null;
  if(entered&&cargoId!==lastCargo)tone(cargoId?[523,659]:[440],.025);
  if(entered&&(cleared||trialComplete)&&!lastCleared)tone([392,494,587],.035,.23);
  if(entered&&discoveries>lastDiscoveries)tone([659,784],.03);
  lastCargo=cargoId;lastCleared=cleared||trialComplete;lastDiscoveries=discoveries;
  $('#milestone-detail').textContent = trialActive ? presentation.trialRecord : complete ? `${observationText(coop)} 你还找到了 ${discoveries} 处房间微光。` : `${coop.stage?.title ?? '这一段'}，已完成。${coop.chapter?.subtitle ?? ''}`;
  $('#ending-evidence').hidden = !complete&&!trialActive;
  $('#ending-evidence').textContent = trialActive ? '室友继续生活，这一段另记成绩。重试会重新计分，已完成的共同生活仍被保留。' : '你完成了机械任务，生命同伴保留自己的选择。只有真实摄食才产生教学；内部变化与稳定追随分别记录。';
  $('#continue').hidden = complete||trialActive;
  $('#continue').disabled = actionPending;
  $('#free-life').hidden = !complete;
  $('#retry-stage').hidden = complete;
  $('#retry-stage').textContent=trialActive?'再试一次':'重试这一段';
  $('#retry-stage').disabled=actionPending;
  $('#end-trial').hidden=!trialActive;$('#end-trial').disabled=actionPending;
  if (coop.notice?.serial !== undefined && coop.notice.serial !== noticeSerial) {
    noticeSerial = coop.notice.serial;
    if (coop.notice.text && entered) {
      $('#notice').textContent = coop.notice.text; $('#notice').dataset.tone = coop.notice.tone ?? 'info'; $('#notice').hidden = false;
      clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 4200);
    }
  }
}

async function boot() {
  if (booting || disposed) return;
  booting = true; ready = false; entered = false;
  render();
  $('#failure').hidden = true; $('#start').disabled = true; $('#start').textContent = '正在准备房间';
  $('#loading-status').textContent = '机械与生命，正在连接同一个世界。';
  subscription?.close(); client?.dispose(); scene?.dispose(); scene = null;
  client = createMirrorCoopClient({ storage: localStorage, initPaused: true });
  subscription = client.subscribe(next => { state = next; render(); }, error => reportError(error, client?.status === 'failed'));
  try {
    // Initial pause is part of the worker init protocol, independent of scene
    // compilation and main-thread acknowledgement timing.
    const results = await Promise.allSettled([createHomeScene($('#room'), { cooperative: true, trainingCues: true }), client.start()]);
    if (results[0].status === 'fulfilled') scene = results[0].value;
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    if (disposed) { scene?.dispose(); client?.dispose(); return; }
    state = client.state; selectedSignal = state?.coop?.circuit?.selected ?? 'off';
    ready = true; scene.setFollowActor('mechanical'); scene.setView('overview');
    $('#start').disabled = false; $('#start').textContent = state?.coop?.campaign?.stage > 0 ? '继续共同生活' : '进入共同的家';
    $('#loading-status').textContent = 'WASD 移动 · 空格上升 · E 交互。也支持触屏。';
    render();
  } catch (error) { reportError(error, true); $('#loading-status').textContent = '准备尚未完成。进度保留，可重新连接。'; }
  finally { booting = false; }
}

function gameToText() {
  const coop = state?.coop, m = coop?.mechanical, campaign = coop?.campaign;
  const pairing=derivePairingPresentation(coop);
  return JSON.stringify({
    ready, entered, connected: client?.status === 'ready', paused: coop?.paused ?? true,
    coordinates: 'metres; +x right, +y up, +z toward room entrance; WASD/joystick follow current camera horizontal axes',
    controls:scene?.getMovementBasis?.()??null,
    audio:{enabled:soundEnabled,state:audioContext?.state??'uninitialized'},
    verification:{status:verificationBusy?'checking':verificationReceipt?'verified':verificationError?'unverified':'not_checked',blockNumber:verificationReceipt?.blockNumber??null,error:verificationError},
    phase: coop?.phase ?? 'loading', simSeconds: round(state?.simSeconds), view, followActor,
    stage: coop?.stage ? { id: coop.stage.id, title: coop.stage.title, instruction: coop.stage.instruction, status: campaign?.status } : null,
    mechanical: m ? { position: roundPosition(m.position), velocity: roundPosition(m.velocity), yaw: round(m.yaw), battery: round(m.battery), cargo: m.cargo, recoveredCount: m.recoveredCount } : null,
    interaction: coop?.interaction ?? null,
    circuit: coop?.circuit ? { selected: coop.circuit.selected, actual: coop.circuit.actual, phase: coop.circuit.phase, steps: coop.circuit.steps } : null,
    objects: (coop?.objects ?? []).filter(item => item.active).slice(0, 16).map(item => ({ id: item.id, kind: item.kind, label: item.label, position: roundPosition(item.position) })),
    learning: campaign?.progress?.learning ? { teachingEvents: campaign.progress.learning.teachingEvents, changedSynapses: campaign.progress.learning.changedSynapses } : null,
    ...(pairing?{pairing:pairing.summary}:{}),
    companion: state?.actor ? { position: roundPosition(state.actor.position), behavior: state.actor.behavior, target: state.living?.navigation?.targetId, remainingDistance: round(state.living?.navigation?.route?.remainingDistance) } : null,
    probe: coop?.probe ? { running: coop.probe.running, elapsed: round(coop.probe.elapsed), result: coop.probe.result ? { completed: coop.probe.result.completed, preferenceIndex: round(coop.probe.result.preferenceIndex) } : null } : null,
    trial: coop?.phase==='trial'&&coop.trial ? { id:coop.trial.id,kind:coop.trial.kind,status:coop.trial.status,attempt:coop.trial.attempt,elapsed:round(coop.trial.elapsed),route:Array.isArray(coop.trial.route)?coop.trial.route.slice(0,4):null,decodedPhases:Array.isArray(coop.trial.decodedPhases)?coop.trial.decodedPhases.slice(0,2):null,signalSeconds:round(coop.trial.signalSeconds),stats:coop.trial.stats??null } : null,
    completedTrials: Array.isArray(coop?.trialHistory)?coop.trialHistory.length:0,
    notice: coop?.notice?.text ?? null,
    overlay: !$('#arrival').hidden ? 'arrival' : !$('#milestone').hidden ? 'milestone' : $('#menu-dialog').open ? 'menu' : null,
    error: $('#failure').hidden ? null : $('#error-message').textContent
  });
}
window.render_game_to_text = gameToText;
// Presentation hook only: authoritative simulation remains inside the real worker.
window.advanceTime = async ms => {
  if (!Number.isFinite(ms) || ms < 0 || ms > 2000) throw new RangeError('Rendering interval must be within 0..2000 ms');
  if (scene && state) scene.update(state, Math.min(.1, ms / 1000));
  return { simulationAdvanced: false, simSeconds: state?.simSeconds ?? null };
};

function frame(now) {
  if (disposed) return;
  const delta = Math.max(0, Math.min(.1, (now - previousFrame) / 1000)); previousFrame = now;
  if (scene && state) scene.update(state, delta);
  updateMotorSound();
  labelClock+=delta;
  if(labelClock>=.12){
    labelClock=0;const fragment=document.createDocumentFragment();
    if(entered&&$('#milestone').hidden)for(const label of scene?.getCooperativeLabels?.()??[]){
      if(label.y<.24||label.y>.76||(label.kind==='charge'&&label.distance<.15))continue;
      const element=document.createElement('span');element.className='world-label';element.style.left=`${label.x*100}%`;element.style.top=`${label.y*100}%`;
      element.dataset.projectedX=String(label.x);element.textContent=`${label.label} · ${label.distance.toFixed(1)}m${Math.abs(label.altitude)>.2?` ${label.altitude>0?'↑':'↓'}`:''}`;fragment.append(element);
    }
    $('#world-labels').replaceChildren(fragment);
    for(const element of $('#world-labels').children){const sourceX=Number(element.dataset.projectedX)*innerWidth,half=element.offsetWidth/2;const safeX=Math.max(half+12,Math.min(innerWidth-half-12,sourceX));element.style.left=`${safeX}px`;element.style.setProperty('--target-x',`${sourceX-safeX}px`);}
  }
  inputClock += delta;
  if (inputClock >= .08) { inputClock = 0; void submitInput(); }
  frameId = requestAnimationFrame(frame);
}
frameId = requestAnimationFrame(frame);

async function transact(action, payload) {
  if (!ready || actionPending) return null;
  actionPending = true;
  await stopInput();
  const result=await command(action, payload);
  selectedSignal = state?.coop?.circuit?.selected ?? 'off'; lastInput = '';
  actionPending = false; render();
  return result;
}

async function launchTrial(kind){
  if(state?.coop?.campaign?.status!=='complete'||state?.coop?.phase==='trial')return;
  const result=await transact('trial',{kind});
  if(!result||state?.coop?.phase!=='trial')return;
  endingDismissed=false;entered=true;menuWasPaused=true;$('#menu-dialog').close();
  followActor='mechanical';view='follow';scene?.update(state,0);scene?.setFollowActor('mechanical');
  $('#actor-toggle').textContent='看同伴';$('#view-toggle').textContent='俯瞰';
  await command('pause',false);render();$('#room').focus({preventScroll:true});
}
async function leaveTrial(){
  if(state?.coop?.phase!=='trial')return;
  const result=await transact('endTrial');
  if(!result||state?.coop?.phase==='trial')return;
  endingDismissed=true;
  if($('#menu-dialog').open){menuWasPaused=true;$('#menu-dialog').close();}
  await command('pause',false);render();$('#room').focus({preventScroll:true});
}
courierButton.addEventListener('click',()=>void launchTrial('courier'));
signalTrialButton.addEventListener('click',()=>void launchTrial('signal'));
exitTrialButton.addEventListener('click',()=>void leaveTrial());
$('#end-trial').addEventListener('click',()=>void leaveTrial());

$('#start').addEventListener('click', async () => {
  if (!ready || entered) return;
  startAudio();
  $('#start').disabled=true;
  const result=await command('pause', false);
  if(!result||client.status!=='ready'){ $('#start').disabled=false;return; }
  entered = true; scene.setView('follow'); view = 'follow'; render();$('#room').focus({preventScroll:true});
});
$('#retry-connection').addEventListener('click', () => void boot());
$('#pause').addEventListener('click', async () => {
  if (!ready || !entered) return;
  await stopInput(); await command('pause', !state.coop.paused); render();$('#room').focus({preventScroll:true});
});
$('#view-toggle').addEventListener('click', () => {
  if (!scene) return;
  view = view === 'follow' ? 'overview' : 'follow'; scene.setView(view);
  $('#view-toggle').textContent = view === 'follow' ? '俯瞰' : '跟随';
});
$('#actor-toggle').addEventListener('click', () => {
  if (!scene) return;
  followActor = followActor === 'mechanical' ? 'neural' : 'mechanical';
  scene.setFollowActor(followActor); view = 'follow';
  $('#actor-toggle').textContent = followActor === 'mechanical' ? '看同伴' : '看机械蝇';
  $('#view-toggle').textContent = '俯瞰';
});
for (const button of signalButtons) button.addEventListener('click', () => void selectSignal(button.dataset.signal));
for (const id of ['interact', 'touch-interact']) $(`#${id}`).addEventListener('click', () => { if (playing()) void command('interact'); });
$('#continue').addEventListener('click', () => void transact('continue'));
$('#retry-stage').addEventListener('click', () => void transact('retry'));
$('#start-probe').addEventListener('click', () => void transact('probe'));
$('#swap-probe').addEventListener('click', () => void transact('probe', { swapped: true }));
$('#end-probe').addEventListener('click', () => void transact('endProbe'));
$('#free-life').addEventListener('click', () => { endingDismissed = true; void command('pause', false); render();$('#room').focus({preventScroll:true}); });

$('#menu').addEventListener('click', async () => {
  if (!ready) return;
  menuWasPaused = Boolean(state?.coop?.paused);
  await stopInput(); await command('pause', true); $('#menu-dialog').showModal();
});
$('#menu-dialog').addEventListener('close', async () => {
  if (!menuWasPaused && entered && !$('#new-game-dialog').open) await command('pause', false);
  if(entered&&!$('#new-game-dialog').open)$('#room').focus({preventScroll:true});
});
$('#export-save').addEventListener('click', async () => {
  try {
    const result = await client.export();
    const checkpoint = result?.checkpoint ?? result;
    downloadJson(checkpoint,`镜隙_共同之家_v8.5.0_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  } catch (error) { reportError(error); }
});
$('#import-save').addEventListener('click', () => $('#save-file').click());
$('#save-file').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw Error('存档超过 8 MiB，请选择导出的同住存档。');
    await stopInput(); await client.import(JSON.parse(await file.text()));
    state = client.state; selectedSignal = state?.coop?.circuit?.selected ?? 'off'; lastInput = ''; endingDismissed = false;
    menuWasPaused = Boolean(state?.coop?.paused);
    if(scene&&state){scene.update(state,0);scene.setFollowActor(followActor);view='follow';$('#view-toggle').textContent='俯瞰';}
    $('#failure').hidden = true; render(); $('#menu-dialog').close();
  } catch (error) { reportError(error); }
  finally { event.target.value = ''; }
});
$('#new-game').addEventListener('click', () => { $('#new-game-dialog').showModal(); $('#menu-dialog').close(); });
$('#cancel-new-game').addEventListener('click', () => $('#new-game-dialog').close('cancel'));
$('#new-game-dialog').addEventListener('close', () => {
  if ($('#new-game-dialog').returnValue !== 'confirm' && !menuWasPaused && entered) void command('pause', false);
});
$('#confirm-new-game').addEventListener('click', async () => {
  if (actionPending) return;
  await transact('newGame', { confirm: true });
  endingDismissed = false; entered = true; selectedSignal = 'off'; lastInput = '';
  $('#new-game-dialog').close('confirm'); await command('pause', false);if(scene&&state)scene.update(state,0);scene?.setFollowActor('mechanical');
  followActor = 'mechanical'; view = 'follow'; render();$('#room').focus({preventScroll:true});
});

const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight']);
document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,textarea,select,[contenteditable="true"]') || $('#menu-dialog').open || $('#new-game-dialog').open) return;
  if (event.code === 'KeyP' && entered && !event.repeat) { event.preventDefault(); $('#pause').click(); return; }
  if (event.code === 'KeyF' && !event.repeat) {
    event.preventDefault();
    const fullscreen = document.fullscreenElement ? document.exitFullscreen() : $('#game').requestFullscreen?.();
    Promise.resolve(fullscreen).catch(error => reportError(error)); return;
  }
  if (!playing()) return;
  if (movementKeys.has(event.code)) {
    if (event.code === 'Space' && event.target.closest('button')) return;
    event.preventDefault(); keys.add(event.code); void submitInput();
  } else if (!event.repeat && ['Digit1', 'Digit2', 'Digit0'].includes(event.code)) {
    event.preventDefault(); void selectSignal({ Digit1: 'A', Digit2: 'B', Digit0: 'off' }[event.code]);
  } else if (event.code === 'KeyE' && !event.repeat) { event.preventDefault(); void command('interact'); }
});
document.addEventListener('keyup', event => {
  if (!movementKeys.has(event.code)) return;
  event.preventDefault(); keys.delete(event.code); void submitInput();
});
window.addEventListener('blur', () => void stopInput());
document.addEventListener('visibilitychange', () => { if (document.hidden) void stopInput(); });

let joystickPointer = null;
function updateJoystick(event) {
  if (joystickPointer !== event.pointerId) return;
  const rect = $('#joystick').getBoundingClientRect();
  const dx = event.clientX - rect.left - rect.width / 2, dy = event.clientY - rect.top - rect.height / 2;
  const scale = Math.max(36, Math.hypot(dx, dy));
  touch.move = [dx / scale, dy / scale];
  $('#joystick-thumb').style.transform = `translate(${touch.move[0] * 31}px,${touch.move[1] * 31}px)`;
  void submitInput();
}
$('#joystick').addEventListener('pointerdown', event => {
  if (!playing() || joystickPointer !== null) return;
  event.preventDefault(); joystickPointer = event.pointerId; $('#joystick').setPointerCapture(event.pointerId); updateJoystick(event);
});
$('#joystick').addEventListener('pointermove', updateJoystick);
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) $('#joystick').addEventListener(name, event => {
  if (joystickPointer !== event.pointerId) return;
  joystickPointer = null; touch.move = [0, 0]; $('#joystick-thumb').style.transform = ''; void submitInput();
});
for (const [id, flag] of [['touch-up', 'up'], ['touch-down', 'down']]) {
  const button = $(`#${id}`);
  button.addEventListener('pointerdown', event => {
    if (!playing()) return;
    event.preventDefault(); button.setPointerCapture(event.pointerId); touch[flag] = true; void submitInput();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, () => { touch[flag] = false; void submitInput(); });
}
$('#room').tabIndex = 0;
$('#menu-dialog .muted').textContent='你驾驶机械果蝇；室友由果蝇连接组约束的神经仿真自主行动。真实进食才触发教学信号；内部变化与稳定追随分别记录。20秒观察可能没有偏好，也会保留结果。信号身份与节奏由 TapeOut 电路输出决定。';
for (const id of ['start', 'view-toggle', 'actor-toggle', 'interact', 'touch-interact', 'continue', 'retry-stage']) $(`#${id}`).addEventListener('click', () => $('#room').focus({ preventScroll: true }));
for (const button of signalButtons) button.addEventListener('click', () => $('#room').focus({ preventScroll: true }));

function dispose() {
  if (disposed) return;
  disposed = true; cancelAnimationFrame(frameId); clearTimeout(noticeTimer); subscription?.close(); client?.dispose(); scene?.dispose();
  if(audioContext){motorOscillator?.stop();motorOscillator?.disconnect();motorGain?.disconnect();void audioContext.close().catch(()=>{});}
}
window.addEventListener('pagehide', event => { if (event.persisted) void stopInput(); else dispose(); });
window.addEventListener('pageshow', () => { previousFrame = performance.now(); });
void boot();
