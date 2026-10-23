import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {EmbodiedLife} from '../src/embodied-life.mjs';
import {createCompanion,adoptCompanion} from '../public/companion-identity.mjs';
import {companionCheckpoint} from '../public/companion-checkpoint.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'file:///C:/Users/39215/.codex/skills/develop-web-game/node_modules/playwright/index.mjs');
const url=process.env.RECOVERY_TEST_URL??'http://127.0.0.1:4217/',out=process.env.RECOVERY_TEST_OUTPUT??'output/natural-home-v8.1.0/recovery';await fs.mkdir(out,{recursive:true});
const s=new EmbodiedLife().state;s.companion=createCompanion();adoptCompanion(s.companion,'恢复豆');s.companion.voice.enabled=false;const fixture=companionCheckpoint(s);
const report={url,checks:[],errors:[]},check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
const browser=await chromium.launch({headless:true,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']});
const ready=page=>page.waitForFunction(()=>document.body.dataset.scene==='ready'&&JSON.parse(window.render_game_to_text()).connected,null,{timeout:120000});
async function pageFor(init){const context=await browser.newContext({viewport:{width:1280,height:900}});await context.addInitScript(init,fixture);const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.accept());await page.goto(url);return {context,page};}
try{
  {const {context,page}=await pageFor(cp=>{localStorage.setItem('mirror-gap-companion-v2',JSON.stringify(cp));const NativeWorker=window.Worker;let failed=false;window.Worker=class extends NativeWorker{constructor(url,options){if(String(url).includes('browser-life-worker')&&!failed){failed=true;throw Error('Injected startup failure');}super(url,options);}};});
   await page.waitForFunction(()=>document.querySelector('#life-retry')&&!document.querySelector('#life-retry').hidden);await page.click('#settings-toggle');await page.click('#settings-tab-about');
   check('startup failure exposes retry without erasing identity',await page.evaluate(()=>JSON.parse(localStorage.getItem('mirror-gap-companion-v2')).companion.identity.name==='恢复豆'));
   await page.click('#life-retry');await ready(page);check('retry starts real worker and preserves identity',await page.evaluate(()=>JSON.parse(window.render_game_to_text()).companion.identity.name==='恢复豆'));await context.close();}
  {const {context,page}=await pageFor(cp=>{if(!sessionStorage.recoverySeeded){localStorage.setItem('mirror-gap-companion-v2','corrupt primary');localStorage.setItem('mirror-gap-companion-good-v1',JSON.stringify({format:1,snapshots:[cp]}));sessionStorage.recoverySeeded='1';}});
   await page.waitForFunction(()=>document.querySelector('#life-retry')&&!document.querySelector('#life-retry').hidden);await page.click('#settings-toggle');await page.click('#settings-tab-backup');
   check('damaged primary is preserved while valid recovery is offered',await page.evaluate(()=>localStorage.getItem('mirror-gap-companion-v2')==='corrupt primary')&&await page.locator('.companion-snapshot').count()===1);
   await page.click('#companion-snapshots summary');await Promise.all([page.waitForNavigation(),page.locator('.companion-snapshot button').nth(1).click()]);await ready(page);
   check('explicit recovery restores identity and preserves damaged raw backup',await page.evaluate(()=>JSON.parse(window.render_game_to_text()).companion.identity.name==='恢复豆'&&localStorage.getItem('mirror-gap-companion-backup-v2')==='corrupt primary'));await context.close();}
  {const {context,page}=await pageFor(cp=>{localStorage.setItem('mirror-gap-companion-v2',JSON.stringify(cp));const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('mirror-gap-companion'))throw new DOMException('Injected quota','QuotaExceededError');return original.call(this,key,value);};});await ready(page);await page.click('#companion-toggle');await page.fill('#companion-name','新名字');await page.locator('#companion-rename button').click();
   await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('自动保存异常'));
   check('rename reports memory-only change when save fails',await page.evaluate(()=>JSON.parse(window.render_game_to_text()).companion.identity.name==='新名字'&&JSON.parse(localStorage.getItem('mirror-gap-companion-v2')).companion.identity.name==='恢复豆'));
   await page.screenshot({path:out+'/quota-rename.png'});await context.close();}
  {const {context,page}=await pageFor(()=>{const NativeWorker=window.Worker;window.Worker=class extends NativeWorker{postMessage(data,...rest){if(data.path==='/api/companion'&&data.body?.type==='voice'){queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:{id:data.id,type:'error',error:'Injected voice failure'}})));return;}return super.postMessage(data,...rest);}};});await ready(page);await page.fill('#adoption-name','初养豆');await page.click('#adoption-submit');
   await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).companion.identity.adoptedAt&&!document.querySelector('#adoption-dialog').open);
   check('partial voice failure leaves the successfully adopted companion usable',await page.evaluate(()=>JSON.parse(window.render_game_to_text()).companion.identity.name==='初养豆'&&!document.querySelector('#adoption-dialog').open));await context.close();}
  check('no uncaught page errors',report.errors.length===0);
}catch(error){report.failure=error.stack;process.exitCode=1;}finally{await browser.close();await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
