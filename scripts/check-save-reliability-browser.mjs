import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createCompanion,adoptCompanion} from '../public/companion-identity.mjs';
import {companionCheckpoint} from '../public/companion-checkpoint.mjs';
import {VERSION} from '../public/world-spec.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'file:///C:/Users/39215/.codex/skills/develop-web-game/node_modules/playwright/index.mjs');
const url=process.env.SAVE_TEST_URL??'http://127.0.0.1:4219/';
const out=process.env.SAVE_TEST_OUTPUT??'output/save-v8.1.1/browser';
await fs.mkdir(out,{recursive:true});
// Synthetic saved identity and explicit Storage fault injection, never player data.
const s=new EmbodiedLife().state;s.companion=createCompanion();adoptCompanion(s.companion,'快照豆');s.companion.voice.enabled=false;
const fixture=companionCheckpoint(s,{revision:1});fixture.savedAt=Date.now()-120000;fixture.metadata.productVersion='8.1.0c';
const report={version:VERSION,url,fixture:'synthetic identity; snapshot-only quota injection; real worker paused using its existing API',checks:[],errors:[],consoleErrors:[]};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader']});
let page;
try{
  const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
  await context.addInitScript(cp=>{
    if(!sessionStorage.saveTestSeeded){
      localStorage.setItem('mirror-gap-companion-v2',JSON.stringify(cp));
      localStorage.setItem('mirror-gap-companion-good-v1',JSON.stringify({format:1,snapshots:[cp]}));
      sessionStorage.saveTestSeeded='1';sessionStorage.snapshotQuota='1';
    }
    window.saveTestFailure=sessionStorage.snapshotQuota==='1'?'snapshots':null;
    const native=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      const failure=window.saveTestFailure;
      if(this===localStorage&&((failure==='snapshots'&&key==='mirror-gap-companion-good-v1')||(failure==='backup'&&key==='mirror-gap-companion-backup-v2')))
        throw new DOMException('Injected auxiliary quota','QuotaExceededError');
      return native.call(this,key,value);
    };
    // Storage sequencing is tested independently from cold navigation work.
    // Use the production visibility and pause API, without replacing the worker.
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker{
      postMessage(data,...rest){
        if(data.type==='init'){
          super.postMessage({...data,hidden:true},...rest);
          super.postMessage({id:-1,path:'/api/command',body:{type:'pause',value:true}});
          super.postMessage({type:'visibility',hidden:false});return;
        }
        return super.postMessage(data,...rest);
      }
    };
  },fixture);
  page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});page.on('dialog',dialog=>dialog.accept());
  const state=()=>page.evaluate(()=>JSON.parse(window.render_game_to_text()));
  const ready=()=>page.waitForFunction(()=>document.body.dataset.scene==='ready'&&JSON.parse(window.render_game_to_text()).connected,null,{timeout:120000});
  const settings=async()=>{await page.click('#settings-toggle');await page.click('#settings-tab-backup');};
  await page.goto(url);await ready();
  await page.waitForFunction(()=>{const s=JSON.parse(window.render_game_to_text());return s.paused&&s.server.persistence.status==='degraded';});
  const initial=await state();
  check('previous delivered version restores the same identity in the new runtime',initial.version===VERSION&&initial.companion.identity.id===fixture.companion.identity.id);
  check('real worker stays ready after auxiliary quota failure',initial.server.persistence.runtimeStatus==='ready'&&initial.server.persistence.revision>1);
  check('primary actually persists while snapshot revision remains old',await page.evaluate(()=>JSON.parse(localStorage.getItem('mirror-gap-companion-v2')).metadata.revision>1&&JSON.parse(localStorage.getItem('mirror-gap-companion-good-v1')).snapshots[0].metadata.revision===1));
  check('Chinese main status confirms saved primary and stale recovery',await page.locator('#save-status').innerText()==='生活已保存，恢复快照暂未更新');
  await settings();await page.click('#companion-snapshots summary');
  check('backup pane lists only the one existing recovery copy',await page.locator('.companion-snapshot').count()===1&&(await page.locator('.companion-snapshot').innerText()).includes('r1'));
  check('details distinguish successful save from recovery warning',(await page.locator('#companion-persistence-detail').innerText()).includes('已保存于')&&(await page.locator('#companion-persistence-detail').innerText()).includes('恢复快照暂未更新'));
  await page.screenshot({path:out+'/saved-primary-warning-zh.png'});
  const downloadPromise=page.waitForEvent('download');await page.click('#companion-export');const download=await downloadPromise;
  await download.saveAs(out+'/exported-companion.json');const exported=JSON.parse(await fs.readFile(out+'/exported-companion.json','utf8'));
  check('backup export contains the latest living identity',exported.companion.identity.id===fixture.companion.identity.id&&exported.metadata.revision>1);
  await page.click('#settings-close');await page.click('#companion-toggle');await page.fill('#companion-name','已存快照豆');await page.locator('#companion-rename button').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('名字已保存；恢复快照'));
  check('rename is persisted despite failed snapshots',await page.evaluate(()=>JSON.parse(localStorage.getItem('mirror-gap-companion-v2')).companion.identity.name==='已存快照豆'));
  await page.click('#companion-close');await settings();await page.click('#settings-tab-display');
  await page.click('[data-language="en"]');await page.click('#settings-tab-backup');
  await page.waitForFunction(()=>document.querySelector('#save-status').textContent==='Life saved; recovery snapshots have not updated');
  check('English main and detailed status describe degraded recovery',(await page.locator('#companion-persistence-detail').innerText()).includes('Recovery snapshots have not updated'));
  await page.screenshot({path:out+'/saved-primary-warning-en.png'});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/saved-primary-warning-mobile.png'});
  check('mobile backup controls remain visible',await page.locator('#companion-export').isVisible()&&await page.locator('#settings-close').isVisible());
  await page.setViewportSize({width:1280,height:900});

  const incoming=structuredClone(exported);incoming.companion.identity.name='拒绝替换豆';
  await fs.writeFile(out+'/incoming-companion.json',JSON.stringify(incoming));
  await page.evaluate(()=>{window.saveTestFailure='backup';});
  await page.setInputFiles('#companion-file',out+'/incoming-companion.json');
  await page.waitForFunction(()=>document.querySelector('#companion-backup-status').textContent.includes('Injected auxiliary quota'));
  check('failed pre-import backup refuses identity replacement and reload',(await state()).companion.identity.name==='已存快照豆'&&await page.evaluate(()=>JSON.parse(localStorage.getItem('mirror-gap-companion-v2')).companion.identity.name==='已存快照豆'));
  await page.evaluate(()=>{window.saveTestFailure=null;sessionStorage.removeItem('snapshotQuota');});
  await page.evaluate(async()=>{const api=await import('/browser-life.mjs');await api.exportCompanion();});
  await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).server.persistence.status==='saved');
  check('storage recovery refreshes actual snapshots and clears warning',(await state()).server.persistence.snapshotError===null&&await page.evaluate(()=>JSON.parse(localStorage.getItem('mirror-gap-companion-good-v1')).snapshots[0].metadata.revision>1));
  await page.waitForFunction(()=>document.querySelector('#companion-raw-snapshots').hidden);
  check('healthy save hides the recovery warning export control',await page.locator('#companion-raw-snapshots').isHidden());
  await page.click('#settings-close');await page.reload();await ready();
  check('reload restores the persisted name and exact identity',(await state()).companion.identity.id===fixture.companion.identity.id&&(await state()).companion.identity.name==='已存快照豆');
  await page.screenshot({path:out+'/recovered-room.png'});
  await fs.writeFile(out+'/final-state.json',JSON.stringify(await state(),null,2));
  check('no uncaught page or console errors',report.errors.length===0&&report.consoleErrors.length===0);report.passed=true;
}catch(error){report.passed=false;report.failure=error.stack;process.exitCode=1;if(page){report.failureState=await page.evaluate(()=>({scene:document.body.dataset.scene,state:window.render_game_to_text?.(),text:document.body.innerText})).catch(()=>null);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}}
finally{await browser.close();await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,errors:report.errors,consoleErrors:report.consoleErrors,failure:report.failure??null,out}));
