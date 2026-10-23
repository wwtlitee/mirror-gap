import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {VERSION} from '../public/world-spec.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'file:///C:/Users/39215/.codex/skills/develop-web-game/node_modules/playwright/index.mjs');
const url=process.env.ACCEPTANCE_URL??'http://127.0.0.1:4229/';
const out=process.env.ACCEPTANCE_OUTPUT??'output/acceptance-v8.1.1/browser-runtime';await fs.mkdir(out,{recursive:true});
const fixture=JSON.parse(await fs.readFile('output/save-v8.1.1/browser-final/exported-companion.json','utf8'));
const report={version:VERSION,url,fixture:'Original failed synthetic checkpoint; real production Worker; unpaused initial phase; paused storage phase',checks:[],apiTimings:[],errors:[],consoleErrors:[]};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader']});let page;
try{
 const context=await browser.newContext({viewport:{width:960,height:720}});
 await context.addInitScript(cp=>{
  window.acceptanceWrites=[];
  const nativeSetItem=Storage.prototype.setItem;
  Storage.prototype.setItem=function(key,value){if(this===localStorage)window.acceptanceWrites.push(key);return nativeSetItem.call(this,key,value);};
  if(!sessionStorage.acceptanceSeeded&&!localStorage.getItem('mirror-gap-companion-v2'))localStorage.setItem('mirror-gap-companion-v2',JSON.stringify(cp));
  sessionStorage.acceptanceSeeded='1';
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker{
   postMessage(data,...args){
    if(data.type==='init'&&sessionStorage.acceptancePause==='1'){
     super.postMessage({...data,hidden:true},...args);
     super.postMessage({id:-1,path:'/api/command',body:{type:'pause',value:true}});
     super.postMessage({type:'visibility',hidden:false});return;
    }
    if(data.path==='/api/state'&&sessionStorage.acceptanceHoldState==='1')return;
    return super.postMessage(data,...args);
   }
  };
 },fixture);
 page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 const state=()=>page.evaluate(()=>JSON.parse(render_game_to_text()));
 const ready=()=>page.waitForFunction(()=>document.body.dataset.scene==='ready'&&JSON.parse(render_game_to_text()).connected,null,{timeout:120000});
 const api=async(path,body)=>{
  const result=await page.evaluate(async({path,body})=>{const life=await import('/browser-life.mjs'),start=performance.now();const result=await life.localApi(path,body);return {ms:performance.now()-start,result};},{path,body});
  report.apiTimings.push({path,type:body?.type,ms:result.ms});return result.result;
 };
 await page.goto(url);await ready();
 check('same failed checkpoint restores its exact identity without pausing',!(await state()).paused&&(await state()).companion.identity.id===fixture.companion.identity.id);
 await page.waitForFunction(()=>JSON.parse(render_game_to_text()).simSeconds>=.4,null,{timeout:30000});
 for(let i=1;i<=3;i++){
  await api('/api/state');await api('/api/companion',{type:'rename',value:'连续响应豆'+i});
  const exported=await page.evaluate(async()=>JSON.parse(await(await import('/browser-life.mjs')).exportCompanion()));
  check('unpaused rename/export '+i+' completes and persists exact identity',exported.companion.identity.name==='连续响应豆'+i&&exported.companion.identity.id===fixture.companion.identity.id);
 }
 await page.waitForFunction(()=>JSON.parse(render_game_to_text()).neural.status==='live'&&JSON.parse(render_game_to_text()).simSeconds>=2,null,{timeout:45000});
 const running=await state();await fs.writeFile(out+'/unpaused-state.json',JSON.stringify(running,null,2));
 check('real neural readout and body continue beyond the formerly blocked step',running.simSeconds>=2&&!running.paused&&running.neural.frame.steps>=400);
 check('all sampled state and rename APIs reply inside their original 15-second deadline',report.apiTimings.every(x=>x.ms<15000));
 await page.screenshot({path:out+'/unpaused-running.png'});

 await api('/api/command',{type:'pause',value:true});await page.evaluate(()=>{sessionStorage.acceptancePause='1';});
 const captured=await page.evaluate(async()=>JSON.parse(await(await import('/browser-life.mjs')).exportCompanion()));
 for(let i=1;i<=2;i++){
  const incoming=structuredClone(captured);incoming.companion.identity.name='重复导入豆'+i;
  const before=await page.evaluate(()=>localStorage.getItem('mirror-gap-companion-v2'));
  const loaded=page.waitForEvent('load');
  await page.evaluate(async text=>{await(await import('/browser-life.mjs')).importCompanion(text);},JSON.stringify(incoming)).catch(e=>{if(!/context was destroyed|navigation/i.test(e.message))throw e;});
  await loaded;await ready();await page.waitForFunction(()=>JSON.parse(render_game_to_text()).paused);
  check('repeated import '+i+' reloads the exact identity and preserves preceding primary backup',(await state()).companion.identity.id===captured.companion.identity.id&&(await state()).companion.identity.name===incoming.companion.identity.name&&await page.evaluate(()=>localStorage.getItem('mirror-gap-companion-backup-v2'))===before);
 }
 const firstPrimary=await page.evaluate(()=>JSON.parse(localStorage.getItem('mirror-gap-companion-v2')));
 const second=await context.newPage();
 await second.route('**/acceptance-lock-probe',route=>route.fulfill({contentType:'text/html',body:'<script>window.MIRROR_BROWSER_LIFE=true</script><script type="module">const life=await import("/browser-life.mjs");life.subscribeLife(s=>window.state=s,e=>window.failure=e.message);</script>'}));
 await second.goto(url+'acceptance-lock-probe');await second.waitForFunction(()=>window.failure,null,{timeout:15000});
 check('a second real tab is refused by the existing writer lock',(await second.evaluate(()=>window.failure)).includes('另一个标签页'));
 const afterRefusal=await page.evaluate(()=>JSON.parse(localStorage.getItem('mirror-gap-companion-v2')));
 const refusedWrites=await second.evaluate(()=>window.acceptanceWrites);report.refusedTabWrites=refusedWrites;
 check('the refused tab performs no primary write and preserves the active identity',!refusedWrites.includes('mirror-gap-companion-v2')&&afterRefusal.companion.identity.id===firstPrimary.companion.identity.id&&afterRefusal.companion.identity.name===firstPrimary.companion.identity.name);
 await second.close();
 await api('/api/companion',{type:'rename',value:'中断恢复豆'});
 await page.evaluate(async()=>{
  sessionStorage.acceptanceHoldState='1';
  const life=await import('/browser-life.mjs');window.interrupted=life.localApi('/api/state').then(()=>({unexpected:true}),e=>({error:e.message}));
 });
 await page.waitForTimeout(30);
 await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide')));
 check('pagehide rejects the pending API and keeps the last acknowledged save',await page.evaluate(async()=>{const result=await window.interrupted;return result.error?.includes('停止')&&JSON.parse(localStorage.getItem('mirror-gap-companion-v2')).companion.identity.name==='中断恢复豆';}));
 await page.evaluate(()=>sessionStorage.removeItem('acceptanceHoldState'));await page.reload();await ready();
 check('reload after interruption restores the last acknowledged identity and name',(await state()).companion.identity.id===captured.companion.identity.id&&(await state()).companion.identity.name==='中断恢复豆');
 check('repeated import keeps at most three individually valid recovery snapshots',await page.evaluate(async()=>{const life=await import('/browser-life.mjs');return life.goodCompanionBackups().length<=3&&life.goodCompanionBackups().length>0;}));
 await page.screenshot({path:out+'/interruption-recovered.png'});
 await fs.writeFile(out+'/final-state.json',JSON.stringify(await state(),null,2));
 check('no uncaught page or console errors',!report.errors.length&&!report.consoleErrors.length);report.passed=true;
}catch(error){report.passed=false;report.failure=error.stack;process.exitCode=1;if(page){report.failureState=await page.evaluate(()=>({state:window.render_game_to_text?.(),text:document.body.innerText})).catch(()=>null);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}}
finally{await browser.close();await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,maxApiMs:Math.max(...report.apiTimings.map(x=>x.ms)),failure:report.failure??null,out}));
