import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {loadPlaywright} from './playwright-module.mjs';
import {MirrorCoopSession} from '../src/mirror-coop-session.mjs';

const [rehearsal,out]=process.argv.slice(2);
if(!rehearsal||!out)throw Error('Usage: node scripts/record-coop-entry.mjs <native rehearsal directory> <new output directory>');
await fs.mkdir(out);
const {chromium}=await loadPlaywright();
const context=await chromium.launchPersistentContext(path.resolve(out,'browser-profile'),{
 headless:true,executablePath:process.env.COOP_CHROME_EXE??'C:/Program Files/Google/Chrome/Application/chrome.exe',
 args:['--use-angle=d3d11'],viewport:{width:1920,height:1080},deviceScaleFactor:1,
 recordVideo:{dir:path.resolve(out,'raw'),size:{width:1920,height:1080}},timeout:45000
});
const page=context.pages()[0]??await context.newPage(),video=page.video();
const report={productVersion:'8.5.0',kind:'actual isolated browser checkpoint replay',createdAt:new Date().toISOString(),segments:[],errors:[],error:null};
page.on('pageerror',e=>report.errors.push(String(e)));page.setDefaultTimeout(15000);
const state=async()=>JSON.parse(await page.evaluate(()=>window.render_game_to_text()));
async function pause(){if(!(await state()).paused)await page.keyboard.press('p');}
async function importNative(file){
 for(const selector of ['#end-trial','#free-life','#continue'])if(await page.locator(selector).isVisible()){await page.locator(selector).click();await page.waitForTimeout(150);break;}
 await pause();const raw=JSON.parse(await fs.readFile(path.join(rehearsal,file),'utf8'));
 const session=new MirrorCoopSession({saved:raw});session.command('pause',true);const saved=session.serialize();session.dispose();
 assert.deepEqual(saved.body.actor,raw.body.actor);assert.deepEqual(saved.body.synapticMemory,raw.body.synapticMemory);
 const input=path.resolve(out,file);await fs.writeFile(input,JSON.stringify(saved));
 await page.locator('#menu').click();await page.locator('#save-file').setInputFiles(input);
 await page.waitForFunction(target=>{const s=JSON.parse(window.render_game_to_text());return s.paused&&Math.abs(s.simSeconds-target)<.002;},saved.body.simSeconds);
 if(await page.locator('#free-life').isVisible()){await page.locator('#free-life').click();await page.waitForFunction(()=>!JSON.parse(window.render_game_to_text()).paused);await pause();}
}
async function segment(name,action){const start=Date.now();const before=await state();await action();report.segments.push({name,start,end:Date.now(),before,after:await state()});}
async function release(){for(const key of ['w','s','a','d','Space','Shift'])await page.keyboard.up(key);}
async function flyTo(target){
 for(let n=0;n<110;n++){
  const s=await state(),d=target.map((v,i)=>v-s.mechanical.position[i]);
  if(Math.hypot(...d)<.14){await release();await page.waitForTimeout(120);return;}
  const pair=a=>[a[0],a.length===3?a[2]:a[1]],right=pair(s.controls.right),forward=pair(s.controls.forward),u=d[0]*right[0]+d[2]*right[1],v=d[0]*forward[0]+d[2]*forward[1];
  const keys=new Set([...(u>.06?['d']:u<-.06?['a']:[]),...(v>.06?['w']:v<-.06?['s']:[]),...(d[1]>.07?['Space']:d[1]<-.07?['Shift']:[])]);
  for(const key of ['w','s','a','d','Space','Shift'])if(keys.has(key))await page.keyboard.down(key);else await page.keyboard.up(key);
  await page.waitForTimeout(120);
 }
 await release();throw Error('Recording flight did not reach target');
}
try{
 await page.goto(process.env.COOP_URL??'http://127.0.0.1:4255/coop.html',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).ready,{},{timeout:60000});
 if(process.env.COOP_CAPTURE_OVERVIEW==='1'){
 await page.locator('#start').click();await importNative('final-checkpoint.json');
 await page.locator('#view-toggle').click();await page.keyboard.press('p');await page.waitForTimeout(1800);
 await segment('home-overview',async()=>{await page.waitForTimeout(7500);});
 }else{
 await segment('arrival',async()=>{await page.waitForTimeout(2500);await page.locator('#start').click();await page.keyboard.press('e');await page.keyboard.down('Space');await page.waitForTimeout(1300);await release();await page.waitForTimeout(2500);});
 await importNative('final-checkpoint.json');
 await page.locator('#menu').click();await page.getByRole('button',{name:'信号试炼',exact:true}).click();
 await page.waitForFunction(()=>{const s=JSON.parse(window.render_game_to_text());return s.trial?.kind==='signal'&&!s.paused;});
 await segment('circuit',async()=>{await page.keyboard.press('1');await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).trial?.decodedPhases.includes(0));const phase=(await state()).objects.find(o=>o.id==='phase');await flyTo(phase.position);await page.keyboard.press('e');await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).trial?.status==='complete',{},{timeout:15000});await page.waitForTimeout(2500);});
 await importNative('08-paired-scent-after-checkpoint.json');
 await segment('training-result',async()=>{await page.waitForTimeout(3000);await page.locator('#continue').click();await page.waitForTimeout(4500);});
 await importNative('10-independent-choice-before-checkpoint.json');
 await page.keyboard.press('p');
 await segment('withdrawal-probe',async()=>{await page.locator('#start-probe').click();await page.waitForFunction(()=>JSON.parse(window.render_game_to_text()).probe?.result?.completed,{},{timeout:35000});await page.waitForTimeout(2500);});
 await importNative('final-checkpoint.json');await page.keyboard.press('p');
 await segment('home',async()=>{await page.locator('#actor-toggle').click();await page.waitForTimeout(7000);});
 }
}catch(error){report.error=error.stack??String(error);report.lastState=await state().catch(()=>null);}
finally{await release().catch(()=>{});report.captureEnd=Date.now();report.video=await video.path();await context.close();}
await fs.writeFile(path.join(out,'capture.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({out,segments:report.segments.map(({name,start,end})=>({name,seconds:(end-start)/1000})),error:report.error?.split('\n')[0]??null,pageErrors:report.errors.length}));
process.exitCode=report.error?1:0;
