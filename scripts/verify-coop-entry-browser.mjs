import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {loadPlaywright} from './playwright-module.mjs';
import {MirrorCoopSession} from '../src/mirror-coop-session.mjs';

const [checkpointFile,out]=process.argv.slice(2);
if(!checkpointFile||!out||process.argv.length!==4)throw Error('Usage: node scripts/verify-coop-entry-browser.mjs <actual completed checkpoint> <new output directory>');
await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(out);
const original=JSON.parse(await fs.readFile(checkpointFile,'utf8'));
assert.equal(original.coop.campaign.status,'complete');
const preparation=new MirrorCoopSession({saved:original});preparation.command('pause',true);
const prepared=preparation.serialize();preparation.dispose();
assert.deepEqual(prepared.body.actor,original.body.actor);assert.deepEqual(prepared.body.synapticMemory,original.body.synapticMemory);
const preparedPath=path.resolve(out,'native-paused-input.json');await fs.writeFile(preparedPath,JSON.stringify(prepared));
const {chromium}=await loadPlaywright(),context=await chromium.launchPersistentContext(path.resolve(out,'browser-profile'),{headless:true,executablePath:process.env.COOP_CHROME_EXE??'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-angle=d3d11'],timeout:45000,viewport:{width:1365,height:768},deviceScaleFactor:1,acceptDownloads:true}),page=context.pages()[0]??await context.newPage();
page.setDefaultTimeout(15000);
const report={productVersion:'8.5.0',inputCheckpoint:path.resolve(checkpointFile),preparedVia:'public pause command only',checks:[],consoleErrors:[],pageErrors:[],httpErrors:[],requestFailures:[],error:null};
page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push({text:m.text(),location:m.location()});});
page.on('pageerror',e=>report.pageErrors.push(String(e)));
page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({url:r.url(),status:r.status()});});
page.on('requestfailed',r=>report.requestFailures.push({url:r.url(),error:r.failure()?.errorText}));
const text=async()=>JSON.parse(await page.evaluate(()=>window.render_game_to_text()));
const wait=async predicate=>page.waitForFunction(predicate,{},{timeout:15000});
async function pause(){if(!(await text()).paused)await page.keyboard.press('p');await wait(()=>JSON.parse(window.render_game_to_text()).paused);}
async function dismissEnding(){if(await page.locator('#free-life').isVisible()){await page.locator('#free-life').click();await wait(()=>!JSON.parse(window.render_game_to_text()).paused);}}
async function openMenu(){if(!await page.locator('#menu-dialog').evaluate(e=>e.open))await page.locator('#menu').click();await page.locator('#menu-dialog').waitFor({state:'visible'});}
async function leaveCurrentTrial(){await openMenu();await page.getByRole('button',{name:'结束本次试炼',exact:true}).click();await wait(()=>{const s=JSON.parse(window.render_game_to_text());return s.phase!=='trial'&&!s.paused;});await pause();}
async function releaseKeys(){for(const key of ['w','s','a','d','Space','Shift'])await page.keyboard.up(key);}
async function flyTo(target){
 const pair=v=>Array.isArray(v)?{x:v[0],z:v.length===3?v[2]:v[1]}:v;
 for(let iteration=0;iteration<90;iteration++){
  const s=await text(),p=s.mechanical.position,d=target.map((v,i)=>v-p[i]);
  if(Math.hypot(...d)<.15){await releaseKeys();await page.waitForTimeout(100);return;}
  const right=pair(s.controls.right),forward=pair(s.controls.forward),u=d[0]*right.x+d[2]*right.z,v=d[0]*forward.x+d[2]*forward.z;
  const keys=new Set([...(u>.06?['d']:u<-.06?['a']:[]),...(v>.06?['w']:v<-.06?['s']:[]),...(d[1]>.07?['Space']:d[1]<-.07?['Shift']:[])]);
  for(const key of ['w','s','a','d','Space','Shift'])if(keys.has(key))await page.keyboard.down(key);else await page.keyboard.up(key);
  await page.waitForTimeout(120);
 }
 await releaseKeys();throw Error('Visible keyboard flight did not reach the phase node');
}
try{
 const started=Date.now();await page.goto(process.env.COOP_URL??'http://127.0.0.1:4255/coop.html',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).ready,{},{timeout:45000});
 report.coldSeconds=(Date.now()-started)/1000;const cold=await text();assert.equal(cold.entered,false);assert.equal(cold.paused,true);
 await page.locator('#start').click();await page.locator('#menu').click();
 const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#import-save').click()]);await chooser.setFiles(preparedPath);
 await wait(()=>JSON.parse(window.render_game_to_text()).stage?.status==='complete');
 const imported=await text();assert.equal(imported.paused,true);report.checks.push('actual completed campaign imported while paused');
 const importedAutosave=JSON.parse(await page.evaluate(()=>localStorage.getItem('mirror-gap-coop-save-v1')));
 await fs.writeFile(path.join(out,'native-import-autosave.json'),JSON.stringify(importedAutosave));assert.deepEqual(importedAutosave.body,prepared.body);
 report.checks.push('native import and autosave preserve complete body and q');
 await page.waitForTimeout(1000);const importedHold=await text();
 report.importHold={before:imported.simSeconds,after:importedHold.simSeconds,paused:importedHold.paused};
 assert.equal(importedHold.paused,true,'a paused imported checkpoint must not resume when the import menu closes');
 assert.equal(importedHold.simSeconds,imported.simSeconds);report.checks.push('paused import remains stopped after its menu closes');
 if(await page.locator('#menu-dialog').evaluate(e=>e.open))await page.locator('#menu-dialog .close').click();
 await dismissEnding();await pause();
 await page.locator('#menu').click();
 await page.locator('#menu-dialog').waitFor({state:'visible'});
 const beforeExport=await text();
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export-save').click()]);const exportedPath=path.resolve(out,'native-ui-export.json');await download.saveAs(exportedPath);
 const exported=JSON.parse(await fs.readFile(exportedPath,'utf8'));
 assert.equal(exported.body.paused,true);assert.ok(Math.abs(exported.body.simSeconds-beforeExport.simSeconds)<.001);
 assert.ok(exported.body.actor.position.every((value,i)=>Math.abs(value-beforeExport.companion.position[i])<.001));
 await page.waitForTimeout(750);assert.equal((await text()).simSeconds,beforeExport.simSeconds);
 const [secondDownload]=await Promise.all([page.waitForEvent('download'),page.locator('#export-save').click()]);const secondPath=path.resolve(out,'native-ui-export-paused-repeat.json');await secondDownload.saveAs(secondPath);
 assert.deepEqual(JSON.parse(await fs.readFile(secondPath,'utf8')).body,exported.body);report.checks.push('visible menu exports a stable current paused body and q');
 assert.equal(await page.getByRole('button',{name:'搬运试炼',exact:true}).isVisible(),true);assert.equal(await page.getByRole('button',{name:'信号试炼',exact:true}).isVisible(),true);
 report.checks.push('both trials unlock from actual completion');
 await page.getByRole('button',{name:'搬运试炼',exact:true}).click();await wait(()=>{const s=JSON.parse(window.render_game_to_text());return s.trial?.kind==='courier'&&!s.paused;});
 await page.keyboard.press('e');await wait(()=>Boolean(JSON.parse(window.render_game_to_text()).mechanical?.cargo));await pause();
 report.courier=await text();report.checks.push('courier trial accepts a real keyboard pickup');
 await leaveCurrentTrial();
 const history=(await text()).completedTrials;
 await openMenu();await page.getByRole('button',{name:'信号试炼',exact:true}).click();await wait(()=>{const s=JSON.parse(window.render_game_to_text());return s.trial?.kind==='signal'&&!s.paused;});
 await page.keyboard.press('1');await wait(()=>JSON.parse(window.render_game_to_text()).trial.decodedPhases.includes(0));
 const target=(await text()).objects.find(o=>o.id==='phase');assert.ok(target);await flyTo(target.position);await page.keyboard.press('e');
 await wait(()=>JSON.parse(window.render_game_to_text()).trial?.status==='complete');await pause();
 report.signal=await text();assert.equal(report.signal.completedTrials,history+1);assert.deepEqual(report.signal.trial.decodedPhases,[0,1]);
 assert.ok(report.signal.trial.signalSeconds>=2);report.checks.push('signal trial completes through real keyboard flight, phase interaction and circuit pulses');
 report.imagePurpose='Check completed signal trial score, controls and room composition for clipping or overlap';
 await page.screenshot({path:path.join(out,'trial-score-original.png')});
 await page.locator('#retry-stage').click();await wait(()=>JSON.parse(window.render_game_to_text()).trial?.attempt===2);
 assert.equal((await text()).paused,true);
 assert.equal((await text()).completedTrials,history+1);report.checks.push('trial retry retains earned history');
 await leaveCurrentTrial();
 assert.equal((await text()).completedTrials,history+1);report.checks.push('leaving trial returns to free life with history');
 assert.equal(report.httpErrors.length,0);assert.equal(report.consoleErrors.length,0);assert.equal(report.pageErrors.length,0);assert.equal(report.requestFailures.length,0);
}catch(error){report.error=error.stack??String(error);report.lastState=await text().catch(()=>null);}
finally{await releaseKeys().catch(()=>{});await context.close();}
report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(out,'receipt.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({out,checks:report.checks.length,error:report.error?.split('\n')[0]??null,coldSeconds:report.coldSeconds,httpErrors:report.httpErrors.length,pageErrors:report.pageErrors.length,consoleErrors:report.consoleErrors.length}));
process.exitCode=report.error?1:0;
